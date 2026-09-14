import React, { useState } from 'react';
import {
  Boxes,
  Sparkles,
  Layers,
  X,
  Check,
  ArrowRight,
  Info,
  RefreshCw,
  PlusCircle,
  HelpCircle,
} from 'lucide-react';
import { InventoryItem } from '../../types';

interface PackagingRatioModalProps {
  isOpen: boolean;
  item: InventoryItem | null;
  currentUnitsPerCase: number;
  newUnitsPerCase: number;
  invoicePricePerCase?: number;
  onClose: () => void;
  onCreateVariant: (variantItemName: string, newUnitsPerCase: number) => void;
  onRecalculateStock: (newUnitsPerCase: number) => void;
}

export const PackagingRatioModal: React.FC<PackagingRatioModalProps> = ({
  isOpen,
  item,
  currentUnitsPerCase,
  newUnitsPerCase,
  invoicePricePerCase,
  onClose,
  onCreateVariant,
  onRecalculateStock,
}) => {
  const [selectedOption, setSelectedOption] = useState<'variant' | 'recalculate'>('variant');

  if (!isOpen || !item) return null;

  const totalUnitsInStock =
    item.totalUnits !== undefined
      ? item.totalUnits
      : item.stockCases * currentUnitsPerCase + item.stockSingles;

  // Calculation for Option B: Recalculate
  const simulatedNewCases = Math.floor(totalUnitsInStock / newUnitsPerCase);
  const simulatedNewSingles = totalUnitsInStock % newUnitsPerCase;

  return (
    <div
      id="modal-packaging-ratio-handler"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
    >
      <div className="bg-slate-850 border border-slate-700 rounded-3xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="shrink-0 p-5 bg-slate-800 border-b border-slate-700 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Units Per Case Changed</h3>
              <p className="text-xs text-slate-400">
                You changed packaging ratio for <span className="text-white font-semibold">{item.itemName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current State vs New Ratio Comparison */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Current Catalog Ratio
              </span>
              <span className="text-base font-bold font-mono text-slate-200 mt-0.5 block">
                Case of {currentUnitsPerCase} units
              </span>
              <span className="text-xs text-slate-400">
                Current Stock: {item.stockCases} cs, {item.stockSingles} un ({totalUnitsInStock} total units)
              </span>
            </div>

            <div className="flex items-center gap-2 text-amber-400">
              <ArrowRight className="w-5 h-5" />
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-amber-400 block tracking-wider">
                Invoice Ratio Entered
              </span>
              <span className="text-base font-bold font-mono text-amber-300 mt-0.5 block">
                Case of {newUnitsPerCase} units
              </span>
              <span className="text-xs text-amber-400/80">
                New delivery configuration
              </span>
            </div>
          </div>

          {/* Strategy Selection */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-slate-300 block">
              How would you like the system to handle this change?
            </span>

            {/* Option 1: Create Packaging Variant (Recommended) */}
            <div
              onClick={() => setSelectedOption('variant')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                selectedOption === 'variant'
                  ? 'bg-blue-950/40 border-blue-500 text-white shadow-lg ring-1 ring-blue-500'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      selectedOption === 'variant'
                        ? 'border-blue-400 bg-blue-500'
                        : 'border-slate-500'
                    }`}
                  >
                    {selectedOption === 'variant' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-white">
                      Create New Product Variant (Recommended for Distinct Pack Sizes)
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-900 text-blue-300 border border-blue-700">
                      Safe & Non-Destructive
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Creates <span className="text-slate-200 font-semibold">{item.itemName} (Case of {newUnitsPerCase})</span> as a new variant item in the inventory catalog.
                  </p>
                  <p className="text-[11px] text-emerald-400 pt-1">
                    ✓ Existing {item.stockCases} case(s) of {currentUnitsPerCase} remain 100% untouched.
                  </p>
                </div>
              </div>
            </div>

            {/* Option 2: Recalculate Existing Stock */}
            <div
              onClick={() => setSelectedOption('recalculate')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                selectedOption === 'recalculate'
                  ? 'bg-amber-950/40 border-amber-500 text-white shadow-lg ring-1 ring-amber-500'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      selectedOption === 'recalculate'
                        ? 'border-amber-400 bg-amber-500'
                        : 'border-slate-500'
                    }`}
                  >
                    {selectedOption === 'recalculate' && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-white">
                      Recalculate Existing Inventory Stock into Cases of {newUnitsPerCase}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Updates catalog ratio to <span className="font-mono text-slate-200">{newUnitsPerCase} un/cs</span> and mathematically redistributes the existing <span className="font-mono text-slate-200">{totalUnitsInStock} total units</span>.
                  </p>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-amber-300 font-mono space-y-0.5 mt-1.5">
                    <div>
                      • New Case Count: {simulatedNewCases} case(s) of {newUnitsPerCase}
                    </div>
                    <div>
                      • Remaining Loose Singles: {simulatedNewSingles} single unit(s)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 p-4 bg-slate-800 border-t border-slate-700 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Keep Original ({currentUnitsPerCase})
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedOption === 'variant') {
                onCreateVariant(`${item.itemName} (Case of ${newUnitsPerCase})`, newUnitsPerCase);
              } else {
                onRecalculateStock(newUnitsPerCase);
              }
              onClose();
            }}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-lg flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            {selectedOption === 'variant'
              ? `Create Variant (Case of ${newUnitsPerCase})`
              : `Recalculate Stock to Case of ${newUnitsPerCase}`}
          </button>
        </div>
      </div>
    </div>
  );
};
