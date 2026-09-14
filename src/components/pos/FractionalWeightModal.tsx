import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Scale,
  DollarSign,
  ArrowDownUp,
  Sparkles,
  Calculator,
  Info,
  Trash2,
  Tag,
} from 'lucide-react';
import { Product, CartItem } from '../../types';

export interface FractionalWeightModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  existingCartItem?: CartItem | null;
  initialQuantity?: number;
  initialPrice?: number;
  onConfirm: (quantity: number, customPrice?: number, notes?: string) => void;
  onRemove?: (productId: string) => void;
  canEditPrice?: boolean;
}

export const FractionalWeightModal: React.FC<FractionalWeightModalProps> = ({
  isOpen,
  onClose,
  product,
  existingCartItem,
  initialQuantity,
  initialPrice,
  onConfirm,
  onRemove,
  canEditPrice = true,
}) => {
  const unit = product.fractionUnit || product.unit || 'kg';
  const isKg = unit.toLowerCase() === 'kg' || unit.toLowerCase() === 'kilogram';
  
  // Base unit price ($/kg or $/unit)
  const baseUnitPrice = existingCartItem?.customPrice !== undefined
    ? existingCartItem.customPrice
    : (initialPrice !== undefined
        ? initialPrice
        : (product.sellPriceUnit !== undefined && product.sellPriceUnit > 0
            ? product.sellPriceUnit
            : product.price));

  const [unitPriceInput, setUnitPriceInput] = useState<string>(baseUnitPrice.toFixed(2));
  const [qtyInput, setQtyInput] = useState<string>('1.000');
  const [priceInput, setPriceInput] = useState<string>(baseUnitPrice.toFixed(2));
  const [lastChanged, setLastChanged] = useState<'qty' | 'price'>('qty');
  const [notes, setNotes] = useState<string>('');

  // Initial synchronization when modal opens or item changes
  useEffect(() => {
    if (!isOpen) return;
    
    const activeUnitPrice = existingCartItem?.customPrice !== undefined
      ? existingCartItem.customPrice
      : (initialPrice !== undefined
          ? initialPrice
          : (product.sellPriceUnit !== undefined && product.sellPriceUnit > 0
              ? product.sellPriceUnit
              : product.price));

    const initQty = existingCartItem
      ? existingCartItem.quantity
      : (initialQuantity !== undefined && initialQuantity > 0 ? initialQuantity : 1.000);
    const calculatedInitialPrice = initQty * activeUnitPrice;

    setUnitPriceInput(activeUnitPrice.toFixed(2));
    setQtyInput(initQty % 1 === 0 ? initQty.toFixed(3) : String(Number(initQty.toFixed(4))));
    setPriceInput(calculatedInitialPrice.toFixed(2));
    setLastChanged('qty');
    setNotes(existingCartItem?.notes || '');
  }, [isOpen, product, existingCartItem, initialQuantity, initialPrice]);

  if (!isOpen) return null;

  const currentUnitPrice = Math.max(0.0001, parseFloat(unitPriceInput) || baseUnitPrice);

  // When operator types in Quantity / Weight input
  const handleQtyChange = (val: string) => {
    setQtyInput(val);
    setLastChanged('qty');
    const parsedQty = parseFloat(val);
    if (!isNaN(parsedQty) && parsedQty >= 0) {
      const calculatedPrice = parsedQty * currentUnitPrice;
      setPriceInput(calculatedPrice.toFixed(2));
    }
  };

  // When operator types in Total Price input
  const handlePriceChange = (val: string) => {
    setPriceInput(val);
    setLastChanged('price');
    const parsedPrice = parseFloat(val);
    if (!isNaN(parsedPrice) && parsedPrice >= 0 && currentUnitPrice > 0) {
      const calculatedQty = parsedPrice / currentUnitPrice;
      // Format to 3 or 4 decimal places for clean scale readout (e.g. 0.300 or 1.250)
      setQtyInput(calculatedQty.toFixed(3));
    }
  };

  // When operator changes unit price (if allowed)
  const handleUnitPriceChange = (val: string) => {
    setUnitPriceInput(val);
    const newUnitPrice = parseFloat(val);
    if (!isNaN(newUnitPrice) && newUnitPrice > 0) {
      if (lastChanged === 'qty') {
        const parsedQty = parseFloat(qtyInput) || 0;
        setPriceInput((parsedQty * newUnitPrice).toFixed(2));
      } else {
        const parsedPrice = parseFloat(priceInput) || 0;
        setQtyInput((parsedPrice / newUnitPrice).toFixed(3));
      }
    }
  };

  // Quick Preset Handlers
  const handleSelectWeightPreset = (weightInUnits: number) => {
    setQtyInput(weightInUnits.toFixed(3));
    setLastChanged('qty');
    const calculatedPrice = weightInUnits * currentUnitPrice;
    setPriceInput(calculatedPrice.toFixed(2));
  };

  const handleSelectPricePreset = (dollarAmount: number) => {
    setPriceInput(dollarAmount.toFixed(2));
    setLastChanged('price');
    if (currentUnitPrice > 0) {
      const calculatedQty = dollarAmount / currentUnitPrice;
      setQtyInput(calculatedQty.toFixed(3));
    }
  };

  // Confirmation submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalQty = parseFloat(qtyInput);
    const finalUnitPrice = parseFloat(unitPriceInput);

    if (isNaN(finalQty) || finalQty <= 0) {
      if (existingCartItem && onRemove) {
        onRemove(product.id);
        onClose();
        return;
      }
      return;
    }

    const customPrice = !isNaN(finalUnitPrice) && finalUnitPrice !== product.price
      ? finalUnitPrice
      : undefined;

    onConfirm(finalQty, customPrice, notes.trim() || undefined);
    onClose();
  };

  const parsedQty = parseFloat(qtyInput) || 0;
  const parsedPrice = parseFloat(priceInput) || 0;

  return (
    <div
      id="modal-fractional-weight"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150 select-none"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm shadow-inner">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-white">
                  {existingCartItem ? `Edit ${product.name}` : `Add ${product.name}`}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-white/25 text-[11px] font-black uppercase tracking-wider">
                  By {unit}
                </span>
              </div>
              <p className="text-xs text-emerald-100 font-medium mt-0.5">
                Rate: <span className="font-bold text-white">${currentUnitPrice.toFixed(2)}</span> / {unit}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Unit Price Bar (Rate per factor) */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                Price per {unit}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={unitPriceInput}
                onChange={(e) => handleUnitPriceChange(e.target.value)}
                disabled={!canEditPrice}
                className="w-24 px-2.5 py-1 text-right text-sm font-mono font-black text-emerald-700 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-600"
              />
              <span className="text-xs font-bold text-slate-500">/{unit}</span>
            </div>
          </div>

          {/* Interactive Dual Entry: Quantity / Weight vs Total Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
            {/* Left Box: Weight / Factor (Quantity) */}
            <div
              className={`p-4 rounded-2xl border-2 transition-all ${
                lastChanged === 'qty'
                  ? 'bg-emerald-50/70 border-emerald-500 shadow-sm ring-2 ring-emerald-200'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Weight / Quantity</span>
                </label>
                <span className="text-[11px] font-bold px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded-md uppercase">
                  {unit}
                </span>
              </div>
              <div className="relative mt-1">
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={qtyInput}
                  onChange={(e) => handleQtyChange(e.target.value)}
                  placeholder="e.g. 0.300 or 1.250"
                  className="w-full py-2.5 px-3 text-lg font-mono font-black text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner"
                  autoFocus
                />
              </div>

              {/* Weight Presets */}
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                  Quick Weight Presets
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {isKg ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.1)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-slate-700 transition"
                      >
                        100g
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.25)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-slate-700 transition"
                      >
                        250g
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.3)}
                        className="py-1 px-1.5 bg-emerald-600 text-white rounded-lg text-xs font-black shadow-sm transition hover:bg-emerald-700"
                        title="300g (Typical meat portion)"
                      >
                        300g ⭐
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.5)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-slate-700 transition"
                      >
                        500g
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(1.0)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-slate-700 transition"
                      >
                        1.0 kg
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(1.25)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-slate-700 transition"
                      >
                        1.25 kg
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.25)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
                      >
                        0.25 {unit}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(0.5)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
                      >
                        0.50 {unit}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeightPreset(1.0)}
                        className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
                      >
                        1.00 {unit}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Box: Total Dollar Amount */}
            <div
              className={`p-4 rounded-2xl border-2 transition-all ${
                lastChanged === 'price'
                  ? 'bg-emerald-50/70 border-emerald-500 shadow-sm ring-2 ring-emerald-200'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Total Price</span>
                </label>
                <span className="text-[11px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-md uppercase">
                  USD ($)
                </span>
              </div>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={priceInput}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  placeholder="e.g. 2.00 or 4.00"
                  className="w-full py-2.5 pl-8 pr-3 text-lg font-mono font-black text-emerald-700 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner"
                />
              </div>

              {/* Dollar Amount Presets */}
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                  Quick Cash Presets
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(1.0)}
                    className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-emerald-700 transition"
                  >
                    $1.00
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(2.0)}
                    className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-emerald-700 transition"
                  >
                    $2.00
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(3.0)}
                    className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-emerald-700 transition"
                  >
                    $3.00
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(4.0)}
                    className="py-1 px-1.5 bg-emerald-600 text-white rounded-lg text-xs font-black shadow-sm transition hover:bg-emerald-700"
                    title="$4.00 portion (Popular request)"
                  >
                    $4.00 ⭐
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(5.0)}
                    className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-emerald-700 transition"
                  >
                    $5.00
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPricePreset(10.0)}
                    className="py-1 px-1.5 bg-white hover:bg-emerald-100 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs font-bold text-emerald-700 transition"
                  >
                    $10.00
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live Calculation Banner */}
          <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 rounded-2xl border border-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Calculation Breakdown
                </span>
                <span className="text-sm font-mono font-black text-slate-900">
                  {parsedQty.toFixed(3)} {unit} × ${currentUnitPrice.toFixed(2)}/{unit}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Total
              </span>
              <span className="text-base font-mono font-black text-emerald-700">
                = ${parsedPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Helper Note (Matching user's requested specification & screenshot prototype) */}
          <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 font-medium leading-relaxed">
              <span className="font-bold">Note:</span> Changes to either Price or Quantity will automatically update the other guided by the factor rate of <span className="font-mono font-bold">${currentUnitPrice.toFixed(2)}/{unit}</span>.
            </p>
          </div>

          {/* Optional Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Item Notes / Special Cut Instructions (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cut into stew cubes, lean trim, 6kg cylinder"
              className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Modal Actions Footer */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-100">
            {existingCartItem && onRemove ? (
              <button
                type="button"
                onClick={() => {
                  onRemove(product.id);
                  onClose();
                }}
                className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 transition flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
            )}

            <button
              type="submit"
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>{existingCartItem ? 'Update Item' : 'Add to Counter'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
