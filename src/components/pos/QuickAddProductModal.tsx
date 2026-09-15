import React, { useState } from 'react';
import { Product } from '../../types';
import { addQuickProduct } from '../../db/roomDatabase';
import { Plus, X, Sparkles, Package, DollarSign, Layers, Tag, Check } from 'lucide-react';

interface QuickAddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  onProductCreated: (product: Product) => void;
}

export const QuickAddProductModal: React.FC<QuickAddProductModalProps> = ({
  isOpen,
  onClose,
  initialName = '',
  onProductCreated,
}) => {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('50');
  const [category, setCategory] = useState('General Merchandise');
  const [unit, setUnit] = useState('Each');
  const [error, setError] = useState<string | null>(null);

  // When initialName changes, update state
  React.useEffect(() => {
    if (initialName) {
      setName(initialName);
    }
  }, [initialName]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Please enter a valid product name');
      return;
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Please enter a valid selling price greater than $0.00');
      return;
    }

    const parsedCost = costPrice ? parseFloat(costPrice) : Math.round(parsedPrice * 0.7 * 100) / 100;
    const parsedStock = stockQuantity ? parseInt(stockQuantity, 10) : 50;

    try {
      const newProduct = addQuickProduct({
        name: cleanName,
        price: parsedPrice,
        costPrice: isNaN(parsedCost) ? undefined : parsedCost,
        stockQuantity: isNaN(parsedStock) ? 50 : parsedStock,
        category: category.trim() || 'General Merchandise',
        unit: unit.trim() || 'Each',
      });

      onProductCreated(newProduct);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create quick product.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-white/20 text-white shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Quick Add &amp; Sell Product</h3>
              <p className="text-xs text-emerald-100">
                Instantly save as inventory item &amp; add directly to counter cart
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-2xl">
              {error}
            </div>
          )}

          {/* Product Name */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              Product Name *
            </label>
            <div className="relative">
              <Package className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                className="w-full py-2.5 pl-10 pr-3 rounded-2xl bg-slate-50 border border-slate-300 text-sm font-bold text-slate-950 outline-none focus:border-emerald-500 focus:bg-white transition"
                placeholder="e.g. Moss, Solar Bracket, Custom Cable"
              />
            </div>
          </div>

          {/* Selling Price & Cost Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                Selling Price ($) *
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setError(null);
                  }}
                  className="w-full py-2.5 pl-9 pr-3 rounded-2xl bg-slate-50 border border-slate-300 text-sm font-mono-num font-black text-slate-950 outline-none focus:border-emerald-500 focus:bg-white transition"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Cost Price ($)
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="w-full py-2.5 pl-9 pr-3 rounded-2xl bg-slate-50 border border-slate-300 text-sm font-mono-num font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white transition"
                  placeholder="Optional (70%)"
                />
              </div>
            </div>
          </div>

          {/* Stock Qty & Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Opening Stock
              </label>
              <input
                type="number"
                min="1"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="w-full py-2.5 px-3 rounded-2xl bg-slate-50 border border-slate-300 text-xs font-mono-num font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition"
                placeholder="50"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Selling Unit
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full py-2.5 px-3 rounded-2xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition"
              >
                <option value="Each">Each (Piece)</option>
                <option value="Meter">Meter</option>
                <option value="Kg">Kilogram (kg)</option>
                <option value="Pack">Pack</option>
                <option value="Box">Box</option>
                <option value="Roll">Roll</option>
                <option value="Bag">Bag</option>
                <option value="Set">Set</option>
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
              Category
            </label>
            <div className="relative">
              <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full py-2.5 pl-9 pr-3 rounded-2xl bg-slate-50 border border-slate-300 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition"
                placeholder="General Merchandise"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-2 py-3 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-black shadow-lg shadow-emerald-600/30 flex items-center justify-center space-x-2 transition transform active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Save &amp; Add to Cart</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
