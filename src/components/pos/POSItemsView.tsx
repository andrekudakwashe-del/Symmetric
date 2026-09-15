import React, { useState, useMemo } from 'react';
import { Product, CartItem, Salesperson, ActiveTab } from '../../types';
import { FractionalWeightModal } from './FractionalWeightModal';
import { QuickAddProductModal } from './QuickAddProductModal';
import { ProductGestureCard } from './ProductGestureCard';
import { ProductGestureListRow } from './ProductGestureListRow';
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
  Sparkles,
  Trash2,
  AlertCircle,
  X,
} from 'lucide-react';

interface POSItemsViewProps {
  products: Product[];
  cart: CartItem[];
  onAddToCart: (product: Product) => void;
  onAddFractionalToCart?: (product: Product, quantity: number, customPrice?: number, notes?: string) => void;
  onRemoveOneFromCart: (product: Product) => void;
  onUpdateQuantity?: (productId: string, delta: number) => void;
  onRemoveItem?: (productId: string) => void;
  onGoToCounter: () => void;
  onOpenMoreMenu?: () => void;
  onOpenCustomerModal?: () => void;
  onQuickAddProduct?: (product: Product) => void;
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
  onUpdateQuantity,
  onRemoveItem,
  onGoToCounter,
  onOpenMoreMenu,
  onOpenCustomerModal,
  onQuickAddProduct,
  initialSearch = '',
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isListView, setIsListView] = useState<boolean>(false);
  const [quickScanOpen, setQuickScanOpen] = useState<boolean>(false);
  const [fractionalModalProduct, setFractionalModalProduct] = useState<Product | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);
  const [removeConfirmProduct, setRemoveConfirmProduct] = useState<Product | null>(null);

  const handleProductTap = (product: Product) => {
    if (product.sellByFraction) {
      setFractionalModalProduct(product);
    } else {
      if (onUpdateQuantity && cartMap.has(product.id)) {
        onUpdateQuantity(product.id, 1);
      } else {
        onAddToCart(product);
      }
    }
  };

  const handleProductDecrement = (product: Product) => {
    if (onUpdateQuantity) {
      const currentQty = cartMap.get(product.id) || 0;
      if (currentQty <= 1) {
        if (onRemoveItem) onRemoveItem(product.id);
        else onRemoveOneFromCart(product);
      } else {
        onUpdateQuantity(product.id, -1);
      }
    } else {
      onRemoveOneFromCart(product);
    }
  };

  const handleRequestRemove = (product: Product) => {
    setRemoveConfirmProduct(product);
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

        {/* Search Bar & Barcode Scanner & Quick Add Button */}
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
          <button
            type="button"
            onClick={() => setIsQuickAddOpen(true)}
            title="Quick Add Product to Inventory & Cart"
            className="h-10 px-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white flex items-center space-x-1 font-black text-xs shadow-md transition transform active:scale-95 shrink-0 border border-white/30"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span className="hidden sm:inline">+ Quick Add</span>
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

      {/* Gesture shortcut hint bar for cashiers */}
      <div className="px-3.5 py-1.5 rounded-xl bg-purple-50/80 border border-purple-200/70 flex items-center justify-between text-[11px] font-bold text-purple-900 shadow-2xs">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="w-2 h-2 rounded-full bg-[#6A4DFF] animate-pulse inline-block" />
          <span>Tap to <strong>+1</strong></span>
          <span className="text-purple-300">•</span>
          <span>Hold 500ms to <strong>-1</strong></span>
          <span className="text-purple-300">•</span>
          <span>Hold 2s to <strong>remove</strong></span>
        </span>
        <span className="text-[10px] text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-full font-black hidden sm:inline">
          {totalCartCount} in cart
        </span>
      </div>

      {/* 2. Items Display: List or Grid matching Desired 4 (Full item names, no truncation) */}
      {filteredProducts.length === 0 ? (
        searchQuery.trim().length > 0 ? (
          /* Rich Quick Add Card for Admin when item is not found (e.g. searching "moss") */
          <div className="bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/40 border-2 border-dashed border-emerald-300 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-sm animate-fadeIn">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-inner">
              <Sparkles className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800 bg-emerald-100/90 px-3 py-1 rounded-full border border-emerald-200 inline-block mb-1.5">
                Quick Counter Inventory
              </span>
              <h3 className="text-base sm:text-lg font-black text-slate-900">
                No product found matching &ldquo;{searchQuery}&rdquo;
              </h3>
              <p className="text-xs text-slate-600 max-w-sm mx-auto mt-1 leading-relaxed">
                As an admin, you can instantly register <strong>{searchQuery}</strong> into your store inventory with a name and price and sell it right now!
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1 max-w-md mx-auto">
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(true)}
                className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs sm:text-sm tracking-wide shadow-lg shadow-emerald-600/30 flex items-center justify-center space-x-2 transition transform active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>+ Quick Add &ldquo;{searchQuery}&rdquo; &amp; Sell</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                className="w-full sm:w-auto px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Reset Search
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Package className="w-6 h-6" />
            </div>
            <h3 className="text-sm sm:text-base font-black text-slate-800">No items match your category filter</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Try selecting another category or add a new quick product.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('All')}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                Show All Items
              </button>
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
              >
                + Quick Add Product
              </button>
            </div>
          </div>
        )
      ) : isListView ? (
        /* List View Mode with Full Gesture Support */
        <div className="space-y-2">
          {filteredProducts.map((product, idx) => {
            const qty = cartMap.get(product.id) || 0;
            const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length];

            return (
              <ProductGestureListRow
                key={product.id}
                product={product}
                quantityInCart={qty}
                avatarBg={avatarBg}
                onTap={handleProductTap}
                onDecrement={handleProductDecrement}
                onRequestRemove={handleRequestRemove}
              />
            );
          })}
        </div>
      ) : (
        /* Grid View Mode matching Screenshot with Full Gesture Support */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
          {filteredProducts.map((product, idx) => {
            const qty = cartMap.get(product.id) || 0;
            const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length];

            return (
              <ProductGestureCard
                key={product.id}
                product={product}
                quantityInCart={qty}
                avatarBg={avatarBg}
                onTap={handleProductTap}
                onDecrement={handleProductDecrement}
                onRequestRemove={handleRequestRemove}
              />
            );
          })}
        </div>
      )}

      {/* Remove Item from Sale Confirmation Modal (Triggered by 2-Second Long Hold) */}
      {removeConfirmProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl border border-slate-100 space-y-4 text-center animate-scaleUp">
            <div className="w-13 h-13 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
              <Trash2 className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Remove from Sale Cart?</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Are you sure you want to remove{' '}
                <strong className="text-slate-900 font-black">
                  {cartMap.get(removeConfirmProduct.id) || 1}x {removeConfirmProduct.name}
                </strong>{' '}
                from the current sale cart?
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setRemoveConfirmProduct(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onRemoveItem) {
                    onRemoveItem(removeConfirmProduct.id);
                  } else {
                    onRemoveOneFromCart(removeConfirmProduct);
                  }
                  setRemoveConfirmProduct(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition active:scale-95"
              >
                Remove Item
              </button>
            </div>
          </div>
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

      {/* Quick Add Product Modal for Instant Counter Sale */}
      <QuickAddProductModal
        isOpen={isQuickAddOpen}
        initialName={searchQuery.trim()}
        onClose={() => setIsQuickAddOpen(false)}
        onProductCreated={(prod) => {
          if (onQuickAddProduct) {
            onQuickAddProduct(prod);
          } else {
            onAddToCart(prod);
          }
          setSearchQuery('');
          setIsQuickAddOpen(false);
        }}
      />

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
