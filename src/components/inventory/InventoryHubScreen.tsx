import React, { useState } from 'react';
import {
  Boxes,
  ArrowDownRight,
  Activity,
  Settings,
  Sparkles,
  Layers,
  ShoppingBag,
  RotateCcw,
  Plus,
  FileSpreadsheet,
  Calendar,
  Truck,
} from 'lucide-react';
import { ActiveTab, Salesperson } from '../../types';
import { InventoryMasterView } from './InventoryMasterView';
import { GoodsReceivedView } from './GoodsReceivedView';
import { DirectGoodsReceivedView } from './DirectGoodsReceivedView';
import { StockMovementView } from './StockMovementView';
import { BatchTrackingView } from './BatchTrackingView';
import { InventorySetupView } from './InventorySetupView';
import { StocktakeHubScreen } from '../stocktake/StocktakeHubScreen';

interface InventoryHubScreenProps {
  currentUser: Salesperson | null;
  activeSubTab?: 'master' | 'grn' | 'direct-grv' | 'batches' | 'movement' | 'stocktake' | 'setup';
  onNavigateHome: () => void;
  onNavigateToPOS: () => void;
}

export const InventoryHubScreen: React.FC<InventoryHubScreenProps> = ({
  currentUser,
  activeSubTab = 'master',
  onNavigateHome,
  onNavigateToPOS,
}) => {
  const [currentTab, setCurrentTab] = useState<'master' | 'grn' | 'direct-grv' | 'batches' | 'movement' | 'stocktake' | 'setup'>(activeSubTab);
  const [selectedItemIdForGRN, setSelectedItemIdForGRN] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const handleTriggerGRN = (itemId?: string) => {
    if (itemId) setSelectedItemIdForGRN(itemId);
    setCurrentTab('grn');
  };

  const handleRefreshAll = () => {
    setRefreshKey((k) => k + 1);
  };

  const tabs: {
    id: 'master' | 'grn' | 'direct-grv' | 'batches' | 'movement' | 'stocktake' | 'setup';
    label: string;
    sheetName: string;
    icon: React.ComponentType<{ className?: string }>;
    tag?: string;
  }[] = [
    {
      id: 'master',
      label: 'Inventory Master',
      sheetName: 'Tab 1: InventoryMaster',
      icon: Boxes,
    },
    {
      id: 'grn',
      label: 'Goods Received (GRN)',
      sheetName: 'Manager / Supervisor',
      icon: ArrowDownRight,
      tag: 'Rule A',
    },
    {
      id: 'direct-grv',
      label: 'Direct Delivery (GRV)',
      sheetName: 'Staff / Cashier',
      icon: Truck,
      tag: 'Direct Payout',
    },
    {
      id: 'batches',
      label: 'Batch Tracking & FIFO',
      sheetName: 'Batches & Expiry',
      icon: Layers,
      tag: 'FIFO / Loss',
    },
    {
      id: 'movement',
      label: 'Stock Movement',
      sheetName: 'Tab 3: StockMovement',
      icon: Activity,
    },
    {
      id: 'stocktake',
      label: 'Stocktake & Audit',
      sheetName: 'Tab 3b: Double-Count',
      icon: Layers,
      tag: 'Double-Count',
    },
    {
      id: 'setup',
      label: 'Setup & Rules',
      sheetName: 'Tab 4: Setup',
      icon: Settings,
    },
  ];

  return (
    <div id="inventory-hub-screen" className="space-y-5 pb-28 animate-fadeIn">
      {/* Top Banner with Sheet Tab Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white">
                  Flexible Inventory & Warehouse Management
                </h1>
                <span className="hidden md:inline-block px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold border border-indigo-500/30 font-mono">
                  Cases + Singles Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Rule A (GRN auto-break) • Rule B (POS auto-break) • Core Rule 1 (Batch Tracking) • Core Rule 2 (FIFO Deduction) • Core Rule 3 (Fraud/Loss)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateToPOS}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>POS Register</span>
            </button>
            <button
              onClick={onNavigateHome}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition border border-slate-700"
            >
              Back to Home
            </button>
          </div>
        </div>

        {/* 7-Tab Navigation Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 border-t border-slate-800/80">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = currentTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setCurrentTab(t.id)}
                className={`py-3 px-3 rounded-2xl flex flex-col items-center justify-between text-center transition ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <div className="flex flex-col items-center gap-1.5 w-full">
                  <div className="flex items-center justify-center gap-1.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold truncate">{t.label}</span>
                  </div>
                  <div className={`text-[10px] font-mono ${isActive ? 'text-indigo-100' : 'text-slate-500'} truncate w-full`}>
                    {t.sheetName}
                  </div>
                </div>

                {t.tag && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase mt-1.5 ${
                      isActive ? 'bg-white/20 text-white' : 'bg-purple-500/20 text-purple-300'
                    }`}
                  >
                    {t.tag}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content Rendering */}
      <div key={refreshKey}>
        {currentTab === 'master' && (
          <InventoryMasterView
            currentUser={currentUser}
            onTriggerGRN={handleTriggerGRN}
            onOpenGRN={handleTriggerGRN}
          />
        )}

        {currentTab === 'grn' && (
          <GoodsReceivedView
            currentUser={currentUser}
            preselectedItemId={selectedItemIdForGRN}
            onGoToMaster={() => setCurrentTab('master')}
            onGoToHome={onNavigateHome}
          />
        )}

        {currentTab === 'direct-grv' && (
          <DirectGoodsReceivedView
            currentUser={currentUser}
            onGoToMaster={() => setCurrentTab('master')}
            onGoToHome={onNavigateHome}
          />
        )}

        {currentTab === 'batches' && (
          <BatchTrackingView
            currentUser={currentUser}
            onOpenGRN={handleTriggerGRN}
          />
        )}

        {currentTab === 'movement' && (
          <StockMovementView currentUser={currentUser} />
        )}

        {currentTab === 'stocktake' && (
          <StocktakeHubScreen currentUser={currentUser} />
        )}

        {currentTab === 'setup' && (
          <InventorySetupView onRefreshAll={handleRefreshAll} />
        )}
      </div>
    </div>
  );
};
