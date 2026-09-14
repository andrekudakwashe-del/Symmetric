import React, { useState } from 'react';
import { Salesperson, ActiveTab } from '../../types';
import { Form1CashCount } from './Form1CashCount';
import { Form2CashLog } from './Form2CashLog';
import { Form3SalesEntry } from './Form3SalesEntry';
import { Form4Reconciliation } from './Form4Reconciliation';
import {
  Coins,
  ReceiptText,
  ArrowLeftRight,
  Scale,
  Banknote,
  LayoutDashboard,
  CreditCard,
  ShoppingCart,
} from 'lucide-react';

interface CashBalancingModuleProps {
  currentUser: Salesperson;
  initialSubTab?: 'form1' | 'form2' | 'form3' | 'form4';
  preselectedCustomer?: string | null;
  onNavigateHome: () => void;
  onNavigateToPOS: () => void;
  onNavigateToCreditReport?: () => void;
}

export const CashBalancingModule: React.FC<CashBalancingModuleProps> = ({
  currentUser,
  initialSubTab = 'form1',
  preselectedCustomer,
  onNavigateHome,
  onNavigateToPOS,
  onNavigateToCreditReport,
}) => {
  const [subTab, setSubTab] = useState<'form1' | 'form2' | 'form3' | 'form4'>(
    initialSubTab
  );

  const isAdmin = currentUser.role === 'Admin';

  return (
    <div id="cash-balancing-module" className="space-y-4 pb-24">
      {/* Top Banner with Navigation */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Cash Balancing & Reconciliation Module
              </h1>
              <p className="text-xs text-slate-400">
                End-of-day drawer counts, cash logs, customer change/credit books, and balancing
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateToPOS}
            className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white rounded-2xl text-xs font-bold shadow-md hover:brightness-110 active:scale-95"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Open POS Register</span>
          </button>
        </div>

        {/* Form Selector Tabs (Material 3 style) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            id="subtab-form1"
            onClick={() => setSubTab('form1')}
            className={`flex items-center space-x-2 p-2.5 rounded-2xl border transition-all text-xs font-bold ${
              subTab === 'form1'
                ? 'bg-purple-950/80 border-purple-500 text-purple-200 ring-1 ring-purple-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className={`w-4 h-4 ${subTab === 'form1' ? 'text-purple-400' : 'text-slate-400'}`} />
            <div className="text-left">
              <span className="block text-[10px] text-slate-400 font-medium">Form 1</span>
              <span>Cash Count</span>
            </div>
          </button>

          <button
            type="button"
            id="subtab-form2"
            onClick={() => setSubTab('form2')}
            className={`flex items-center space-x-2 p-2.5 rounded-2xl border transition-all text-xs font-bold ${
              subTab === 'form2'
                ? 'bg-blue-950/80 border-blue-500 text-blue-200 ring-1 ring-blue-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ReceiptText className={`w-4 h-4 ${subTab === 'form2' ? 'text-blue-400' : 'text-slate-400'}`} />
            <div className="text-left">
              <span className="block text-[10px] text-slate-400 font-medium">Form 2</span>
              <span>Cash Log</span>
            </div>
          </button>

          <button
            type="button"
            id="subtab-form3"
            onClick={() => setSubTab('form3')}
            className={`flex items-center space-x-2 p-2.5 rounded-2xl border transition-all text-xs font-bold ${
              subTab === 'form3'
                ? 'bg-orange-950/80 border-orange-500 text-orange-200 ring-1 ring-orange-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowLeftRight className={`w-4 h-4 ${subTab === 'form3' ? 'text-orange-400' : 'text-slate-400'}`} />
            <div className="text-left">
              <span className="block text-[10px] text-slate-400 font-medium">Form 3</span>
              <span>Change & Credit</span>
            </div>
          </button>

          <button
            type="button"
            id="subtab-form4"
            onClick={() => {
              if (isAdmin) setSubTab('form4');
            }}
            disabled={!isAdmin}
            className={`flex items-center space-x-2 p-2.5 rounded-2xl border transition-all text-xs font-bold ${
              !isAdmin
                ? 'opacity-40 cursor-not-allowed bg-slate-950 border-slate-800 text-slate-500'
                : subTab === 'form4'
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scale className={`w-4 h-4 ${subTab === 'form4' ? 'text-emerald-400' : 'text-slate-400'}`} />
            <div className="text-left">
              <span className="block text-[10px] text-slate-400 font-medium">Form 4 {!isAdmin ? '(Admin)' : ''}</span>
              <span>Reconcile</span>
            </div>
          </button>
        </div>
      </div>

      {/* Render Active Form */}
      <div>
        {subTab === 'form1' && (
          <Form1CashCount
            currentUser={currentUser}
            onNavigateToCashLog={() => setSubTab('form2')}
            onNavigateToHome={onNavigateHome}
            onNavigateToReconcile={isAdmin ? () => setSubTab('form4') : undefined}
          />
        )}

        {subTab === 'form2' && (
          <Form2CashLog
            currentUser={currentUser}
            onNavigateToCashCount={() => setSubTab('form1')}
            onNavigateToCustomerChange={() => setSubTab('form3')}
            onNavigateToHome={onNavigateHome}
          />
        )}

        {subTab === 'form3' && (
          <Form3SalesEntry
            currentUser={currentUser}
            preselectedCustomer={preselectedCustomer}
            onNavigateToCashLog={() => setSubTab('form2')}
            onNavigateToHome={onNavigateHome}
            onNavigateToReconcile={isAdmin ? () => setSubTab('form4') : undefined}
          />
        )}

        {subTab === 'form4' && (
          isAdmin ? (
            <Form4Reconciliation
              currentUser={currentUser}
              onNavigateToCashCount={() => setSubTab('form1')}
              onNavigateToCustomerChange={() => setSubTab('form3')}
              onNavigateToHome={onNavigateHome}
            />
          ) : (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-xl font-bold">
                🔒
              </div>
              <h3 className="text-lg font-bold text-white">Administrator Access Required</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Form 4 is restricted to Administrator roles.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
};
