import React, { useState, useMemo } from 'react';
import { Product, CartItem, Salesperson, ActiveTab } from '../../types';
import { FractionalWeightModal } from './FractionalWeightModal';
import {
  Menu,
  LayoutGrid,
  List as ListIcon,
  UserPlus,
  PhoneCall,
  Search,
  ScanLine,
  Zap,
  Plus,
  Minus,
  Check,
  Package,
  ShoppingCart,
  ArrowRight,
  Filter,
  Scale,
} from 'lucide-react';

interface POSItemsViewProps {
  products: Product[];
  cart: CartItem[];
  onAddToCart: (product: Product) => void;
  onAddFractionalToCart?: (product: Product, quantity: number, customPrice?: number, notes?: string) => void;
  onRemoveOneFromCart?: (product: Product) => void;
  onGoToCounter: () => void;
  onOpenMoreMenu?: () => void;
  onOpenCustomerModal?: () => void;
  initialSearch?: string;
}

// Avatar background colors to make items distinct & appealing
const AVATAR_COLORS = [
  'bg-[#E53935]', // Vibrant coral red from screenshot
  'bg-[#D32F2F]',
  'bg-[#EF5350]',
  'bg-[#E64A19]',
  'bg-[#F4511E]',
  'bg-[#C2185B]',
];

export const POSItemsView: React.FC<POSItemsViewProps> = ({
  products,
  cart,
  onAddToCart,
  onAddFractionalToCart,
  onRemoveOneFromCart,
  onGoToCounter,
  onOpenMoreMenu,
  onOpenCustomerModal,
  initialSearch = '',
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isListView, setIsListView] = useState<boolean>(false);
  const [quickScanOpen, setQuickScanOpen] = useState<boolean>(false);
  const [fractionalModalProduct, setFractionalModalProduct] = useState<Product | null>(null);

  const handleProductClick = (product: Product) => {
    if (product.sellByFraction) {
      setFractionalModalProduct(product);
    } else {
      onAddToCart(product);
    }
  };

  // Cart helper map for O(1) lookup
  const cartMap = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach((item) => {
      map.set(item.product.id, item.quantity);
    });
    return map;
  }, [cart]);

  const totalCartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const totalCartValue = useMemo(() => {
    return cart.reduce((sum, item) => {
      const price = item.customPrice !== undefined ? item.customPrice : item.product.price;
      return sum + price * item.quantity;
    }, 0);
  }, [cart]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['All', ...Array.from(set)];
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      const q = (searchQuery || '').toLowerCase().trim();
      const matchesSearch =
        !q ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        p.sku?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.unit?.toLowerCase().includes(q) ||
        (p.barcode && String(p.barcode).includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  return (
    <div className="space-y-3 pb-28 select-none animate-fadeIn">
      {/* 1. Top Header Bar (Matching Desired 2 & Desired 4) */}
      <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white rounded-3xl p-3.5 sm:p-4 shadow-xl">
        <div className="flex items-center justify-between">
          {/* Left: Menu */}
          <button
            type="button"
            onClick={onOpenMoreMenu}
            className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Center: Title */}
          <div className="flex items-center space-x-2">
            <h2 className="text-lg sm:text-xl font-black tracking-wider text-white">
              Items
            </h2>
            <span className="bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full border border-white/30">
              {filteredProducts.length} items
            </span>
          </div>

          {/* Right: Layout Toggle + Call */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsListView(!isListView)}
              title={isListView ? 'Switch to Grid View' : 'Switch to List View'}
              className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
            >
              {isListView ? <LayoutGrid className="w-5 h-5" /> : <ListIcon className="w-5 h-5" />}
            </button>
            <a
              href="tel:+263770000000"
              title="Call Support"
              className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
            >
              <PhoneCall className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Search Bar & Barcode Scanner */}
        <div className="mt-3 flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search item, variant, SKU, barcode..."
              className="w-full bg-white text-slate-900 rounded-2xl pl-10 pr-4 py-2.5 text-xs sm:text-sm font-semibold placeholder:text-slate-400 focus:outline-none shadow-md"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setQuickScanOpen(!quickScanOpen)}
            title="Scan barcode"
            className="w-10 h-10 rounded-2xl bg-white text-[#6A4DFF] hover:bg-slate-50 flex items-center justify-center shadow-md transition transform active:scale-95 shrink-0"
          >
            <ScanLine className="w-5 h-5" />
          </button>
        </div>

        {/* Horizontal Category Filter Pills */}
        <div className="mt-3 flex items-center space-x-1.5 overflow-x-auto pb-1 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition transform active:scale-95 ${
                selectedCategory === cat
                  ? 'bg-white text-[#6A4DFF] shadow-md'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Items Display: List or Grid matching Desired 4 (Full item names, no truncation) */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Package className="w-6 h-6" />
          </div>
          <h3 className="text-sm sm:text-base font-black text-slate-800">No items match your search</h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Try adjusting your search query or select another category filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('All');
            }}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
          >
            Reset Filters
          </button>
        </div>
      ) : isListView ? (
        /* List View Mode with Full Name Display */
        <div className="space-y-2">
          {filteredProducts.map((product, idx) => {
            const qty = cartMap.get(product.id) || 0;
            const inCart = qty > 0;
            return (
              <div
                key={product.id}
                onClick={() => handleProductClick(product)}
                className={`p-3 sm:p-3.5 rounded-2xl border transition flex items-center justify-between cursor-pointer active:scale-[0.99] ${
                  inCart
                    ? 'bg-slate-50 border-[#6A4DFF] shadow-sm ring-1 ring-[#6A4DFF]/30'
                    : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0 pr-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0 shadow-sm ${
                      inCart ? 'bg-[#9E2A2B]' : AVATAR_COLORS[idx % AVATAR_COLORS.length]
                    }`}
                  >
                    {inCart ? `x ${qty}` : product.name.replace(/^[* ]+/, '').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-xs sm:text-sm text-slate-900 leading-snug break-words flex items-center gap-1.5 flex-wrap">
                      <span>{product.name}</span>
                      {product.sellByFraction && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-black flex items-center gap-0.5">
                          <Scale className="w-2.5 h-2.5" />
                          <span>By {product.fractionUnit || 'kg'}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium flex items-center space-x-2 mt-0.5">
                      <span>{product.category || 'General'}</span>
                      <span>•</span>
                      <span>{product.unit || 'Each'}</span>
                      {product.stockQuantity !== undefined && (
                        <>
                          <span>•</span>
                          <span className={product.stockQuantity === 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                            {product.stockQuantity} in stock
                          </span>
                        </>
                      )}
                    </div>

                    {/* Quick Variant Pills in List View */}
                    {product.packagingVariants && product.packagingVariants.length > 0 && !product.variantId && (
                      <div className="flex flex-wrap gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {product.packagingVariants.map((v) => {
                          const vProd = products.find((p) => p.id === `${product.id.replace(/-UNIT$|-CASE$/, '')}__${v.id}`);
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                if (vProd) onAddToCart(vProd);
                                else {
                                  onAddToCart({
                                    ...product,
                                    id: `${product.id.replace(/-UNIT$|-CASE$/, '')}__${v.id}`,
                                    name: `${product.name.replace(/ Each$/, '')} (${v.name})`,
                                    price: v.sellPrice,
                                    unit: v.name,
                                    variantId: v.id,
                                    unitsPerPack: v.unitsPerPack,
                                  });
                                }
                              }}
                              className="px-2 py-0.5 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-[10px] font-bold transition active:scale-95 flex items-center gap-1"
                            >
                              <span>{v.name}</span>
                              <span className="font-mono text-purple-900">${v.sellPrice.toFixed(2)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <div className="font-mono-num font-black text-xs sm:text-sm text-[#1E40AF]">
                    ${product.price % 1 === 0 ? product.price : product.price.toFixed(2)}
                    {product.sellByFraction && <span className="text-[10px] text-slate-500 font-normal block text-right">/{product.fractionUnit || 'kg'}</span>}
                  </div>
                  {product.sellByFraction ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFractionalModalProduct(product);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center space-x-1 font-bold text-xs shadow-sm transition active:scale-95"
                    >
                      <Scale className="w-3.5 h-3.5" />
                      <span>Calc</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToCart(product);
                      }}
                      className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center font-bold shadow-sm transition active:scale-95"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Grid View Mode matching Desired 4 (Full Name Visibility, No Clipping) */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
          {filteredProducts.map((product, idx) => {
            const qty = cartMap.get(product.id) || 0;
            const inCart = qty > 0;
            const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length];

            return (
              <div
                key={product.id}
                id={`product-card-${product.id}`}
                onClick={() => handleProductClick(product)}
                className={`relative rounded-2xl border p-3 sm:p-3.5 flex flex-col justify-between text-center cursor-pointer transition transform active:scale-95 shadow-sm min-h-[185px] ${
                  inCart
                    ? 'bg-slate-50 border-purple-400 text-slate-950 ring-2 ring-[#6A4DFF]/30'
                    : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300 hover:shadow-md'
                }`}
              >
                {/* Stock Indicator Top-Right Badge */}
                {product.sellByFraction ? (
                  <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-0.5">
                    <Scale className="w-2.5 h-2.5" />
                    <span>By {product.fractionUnit || 'kg'}</span>
                  </span>
                ) : product.stockQuantity === 0 && (!product.stockCases || product.stockCases === 0) ? (
                  <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                    OOS
                  </span>
                ) : (
                  <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {product.stockQuantity} {product.unit || 'units'}
                  </span>
                )}

                {/* Circular Avatar / Cart Count (Desired 4) */}
                <div className="flex justify-center mt-1 mb-2">
                  <div
                    className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white shadow-md transition-transform ${
                      inCart
                        ? 'bg-[#8B0000] scale-105 ring-2 ring-rose-400' // Burgundy badge for active cart selection
                        : avatarBg
                    }`}
                    style={{ width: '3.25rem', height: '3.25rem' }}
                  >
                    {inCart ? (
                      <span className="text-sm font-black tracking-tighter">
                        x {qty}
                      </span>
                    ) : (
                      <span className="text-xs font-bold opacity-90">
                        {product.name.replace(/^[* ]+/, '').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Product Name (Full Name Display, wrapping cleanly without truncation - Desired 4) */}
                <div className="w-full flex-1 flex flex-col justify-center my-1">
                  <h4 className="text-xs sm:text-sm font-black tracking-tight text-slate-900 leading-snug break-words">
                    {product.name}
                  </h4>

                  {/* Variant / Category description */}
                  <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium break-words mt-0.5">
                    {product.category || 'General'} {product.unit && product.unit !== 'Each' ? `(${product.unit})` : ''}
                  </div>

                  {/* Fractional quick indicator */}
                  {product.sellByFraction && (
                    <div className="mt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <Scale className="w-3 h-3" />
                        <span>Weight / Price Factor</span>
                      </span>
                    </div>
                  )}

                  {/* Variant Quick Pills for Grid View */}
                  {product.packagingVariants && product.packagingVariants.length > 0 && !product.variantId && (
                    <div className="flex flex-wrap justify-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                      {product.packagingVariants.map((v) => {
                        const vProd = products.find((p) => p.id === `${product.id.replace(/-UNIT$|-CASE$/, '')}__${v.id}`);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              if (vProd) onAddToCart(vProd);
                              else {
                                onAddToCart({
                                  ...product,
                                  id: `${product.id.replace(/-UNIT$|-CASE$/, '')}__${v.id}`,
                                  name: `${product.name.replace(/ Each$/, '')} (${v.name})`,
                                  price: v.sellPrice,
                                  unit: v.name,
                                  variantId: v.id,
                                  unitsPerPack: v.unitsPerPack,
                                });
                              }
                            }}
                            className="px-1.5 py-0.5 rounded-md bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-750 text-[9px] font-bold transition active:scale-95 flex items-center gap-0.5 shadow-2xs"
                            title={`Add ${v.name} for $${v.sellPrice.toFixed(2)}`}
                          >
                            <span>{v.name}</span>
                            <span className="font-mono text-purple-900">${v.sellPrice.toFixed(2)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Price tag (e.g. $2.50, $0.50) matching Desired 4 */}
                <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between font-mono-num text-xs sm:text-sm font-black text-[#1E40AF]">
                  <span>${product.price % 1 === 0 ? product.price : product.price.toFixed(2)}</span>
                  {product.sellByFraction && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100/70 px-1.5 py-0.5 rounded">
                      /{product.fractionUnit || 'kg'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fractional / Weight Factor Input Modal */}
      {fractionalModalProduct && (
        <FractionalWeightModal
          isOpen={true}
          onClose={() => setFractionalModalProduct(null)}
          product={fractionalModalProduct}
          existingCartItem={cart.find((it) => it.product.id === fractionalModalProduct.id) || null}
          initialQuantity={cartMap.get(fractionalModalProduct.id) || 1}
          initialPrice={fractionalModalProduct.price}
          onConfirm={(qty, unitPrice, notes) => {
            if (onAddFractionalToCart) {
              onAddFractionalToCart(fractionalModalProduct, qty, unitPrice, notes);
            } else {
              onAddToCart(fractionalModalProduct);
            }
            setFractionalModalProduct(null);
          }}
          onRemove={() => {
            onRemoveOneFromCart(fractionalModalProduct);
            setFractionalModalProduct(null);
          }}
        />
      )}

      {/* 3. Sticky Bottom Green "Go To Counter" Button (Matching Desired 2 & 4) */}
      <div className="fixed bottom-14 left-0 right-0 z-20 px-3 sm:px-4 pointer-events-auto">
        <div className="max-w-4xl mx-auto">
          <button
            id="btn-go-to-counter"
            type="button"
            onClick={onGoToCounter}
            className="w-full py-3.5 px-6 rounded-2xl bg-[#4CAF50] hover:bg-[#43A047] active:bg-[#388E3C] text-white font-black text-base sm:text-lg tracking-wide shadow-xl flex items-center justify-between transition transform active:scale-[0.99]"
          >
            <div className="flex items-center space-x-2">
              <ShoppingCart className="w-5 h-5" />
              <span>Go To Counter</span>
              {totalCartCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-white/25 text-xs font-black">
                  {totalCartCount} {totalCartCount === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <span className="font-mono-num font-black text-lg">
                ${totalCartValue % 1 === 0 ? totalCartValue : totalCartValue.toFixed(2)}
              </span>
              <ArrowRight className="w-5 h-5" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
