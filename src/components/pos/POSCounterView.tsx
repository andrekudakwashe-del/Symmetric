import React, { useState, useMemo, useRef } from 'react'; // ADDED useRef
import { Product, CartItem, Customer, Salesperson, ActiveTab } from '../../types';
import { getSalespeople, logManagerOverride } from '../../db/roomDatabase';
import { FractionalWeightModal } from './FractionalWeightModal';
import { ManagerPinModal } from '../common/ManagerPinModal';
import { CartItemGestureRow } from './CartItemGestureRow';
import { QuickAddProductModal } from './QuickAddProductModal';
import {
  Menu,
  UserPlus,
  PhoneCall,
  Pencil,
  Plus,
  Minus,
  Trash2,
  ScanLine,
  Check,
  X,
  Tag,
  DollarSign,
  Percent,
  Layers,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Lock,
  Unlock,
  ShieldCheck,
  AlertCircle,
  FileText,
  Scale,
} from 'lucide-react';

interface POSCounterViewProps {
  cart: CartItem[];
  customers: Customer[];
  selectedCustomer: Customer | null;
  currentUser?: Salesperson | null;
  onSelectCustomer: (cust: Customer | null) => void;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  onSetCustomPrice?: (productId: string, price: number) => void;
  onRemoveItem: (productId: string) => void;
  onClearCart: () => void;
  onSaveForLater: () => void;
  onOpenItems: () => void;
  onCharge: () => void;
  onOpenMoreMenu?: () => void;
  onOpenCustomerModal?: () => void;
  onQuickAddProduct?: (product: Product) => void;
  discountAmount: number;
  discountType: 'fixed' | 'percent';
  discountInput: string;
  onApplyDiscount: (type: 'fixed' | 'percent', value: string) => void;
  taxAmount?: number;
  onApplyTax?: (tax: number) => void;
  otherCharges?: number;
  onApplyOtherCharges?: (charges: number) => void;
}

export const POSCounterView: React.FC<POSCounterViewProps> = ({
  cart,
  customers,
  selectedCustomer,
  currentUser,
  onSelectCustomer,
  onUpdateQuantity,
  onSetQuantity,
  onSetCustomPrice,
  onRemoveItem,
  onClearCart,
  onSaveForLater,
  onOpenItems,
  onCharge,
  onOpenMoreMenu,
  onOpenCustomerModal,
  onQuickAddProduct,
  discountAmount,
  discountType,
  discountInput,
  onApplyDiscount,
  taxAmount = 0,
  onApplyTax,
  otherCharges = 0,
  onApplyOtherCharges,
}) => {
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [editQtyInput, setEditQtyInput] = useState<string>('1');
  const [editPriceInput, setEditPriceInput] = useState<string>('0');
  const [editDiscountInput, setEditDiscountInput] = useState<string>('0');
  const [editNotesInput, setEditNotesInput] = useState<string>('');

  // Gesture Controls & Quick Add Modals
  const [showQuickAddModal, setShowQuickAddModal] = useState<boolean>(false);
  const [itemToRemoveDialog, setItemToRemoveDialog] = useState<CartItem | null>(null);

  // NEW: For long press detection
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // Admin override state
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [adminPinPromptOpen, setAdminPinPromptOpen] = useState<boolean>(false);
  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [adminPinError, setAdminPinError] = useState<string | null>(null);

  // Modals
  const [showDiscountModal, setShowDiscountModal] = useState<boolean>(false);
  const [showTaxModal, setShowTaxModal] = useState<boolean>(false);
  const [showChargesModal, setShowChargesModal] = useState<boolean>(false);
  const [tempDiscountVal, setTempDiscountVal] = useState<string>(discountInput || '0');
  const [tempDiscountType, setTempDiscountType] = useState<'fixed' | 'percent'>(discountType);
  const [roundOffEnabled, setRoundOffEnabled] = useState<boolean>(false);
  const [customTaxVal, setCustomTaxVal] = useState<string>(taxAmount > 0 ? String(taxAmount) : '0');
  const [customChargeVal, setCustomChargeVal] = useState<string>(otherCharges > 0 ? String(otherCharges) : '0');
  const [fractionalModalItem, setFractionalModalItem] = useState<CartItem | null>(null);

  // Permission Check
  const isAdmin = currentUser?.role === 'Admin';
  const isManager = currentUser?.role === 'Manager';
  const hasEditPricePermission = isAdmin || Boolean(currentUser?.permissions?.canEditCartPrice) || isAdminUnlocked;
  const hasDiscountPermission = isAdmin || isManager || Boolean(currentUser?.permissions?.canApplyCartDiscount) || isAdminUnlocked;
  const hasClearCartPermission = isAdmin || isManager || currentUser?.permissions?.canClearCart !== false;

  // Manager PIN Security Modal Configuration
  const [managerPinModalConfig, setManagerPinModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    actionType: 'REFUND' | 'VOID' | 'DISCOUNT';
    actionDescription: string;
    amount?: number;
    onAuthorize: (manager: Salesperson, reason: string) => void;
  } | null>(null);

  // Calculate totals
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const price = item.customPrice !== undefined ? item.customPrice : item.product.price;
      return sum + price * item.quantity;
    }, 0);
  }, [cart]);

  const totalItemsCount = useMemo(() => {
    return cart.length;
  }, [cart]);

  const totalUnitsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const calculatedDiscount = useMemo(() => {
    if (discountType === 'percent') {
      const pct = parseFloat(discountInput) || 0;
      return (subtotal * pct) / 100;
    }
    return parseFloat(discountInput) || 0;
  }, [subtotal, discountType, discountInput]);

  const currentTax = parseFloat(customTaxVal) || 0;
  const currentOtherCharges = parseFloat(customChargeVal) || 0;

  const rawGrandTotal = Math.max(0, subtotal - calculatedDiscount + currentTax + currentOtherCharges);
  const grandTotal = roundOffEnabled ? Math.round(rawGrandTotal * 10) / 10 : rawGrandTotal;

  // Open item edit drawer or fractional modal
  const handleStartEdit = (item: CartItem) => {
    if (item.isFractional || item.product.sellByFraction) {
      setFractionalModalItem(item);
      return;
    }
    setEditingItem(item);
    setEditQtyInput(String(item.quantity));
    setEditPriceInput(
      String(item.customPrice !== undefined ? item.customPrice : item.product.price)
    );
    setEditDiscountInput(item.discountAmount ? String(item.discountAmount) : '0');
    setEditNotesInput(item.notes || '');
  };

  const handleSaveEdit = () => {
    if (!editingItem) return;
    const newQty = parseFloat(editQtyInput);
    const newPrice = parseFloat(editPriceInput);

    if (!isNaN(newQty)) {
      if (newQty <= 0) {
        onRemoveItem(editingItem.product.id);
      } else {
        onSetQuantity(editingItem.product.id, newQty);
      }
    }

    if (hasEditPricePermission && !isNaN(newPrice) && onSetCustomPrice && newPrice >= 0) {
      onSetCustomPrice(editingItem.product.id, newPrice);
    }

    setEditingItem(null);
  };

  const handleVerifyAdminPin = (e: React.FormEvent) => {
    e.preventDefault();
    const salespeople = getSalespeople();
    const adminMatch = salespeople.find((s) => (s.role === 'Admin' || s.role === 'Manager') && s.pin === adminPinInput && s.active === 'Y');
    if (adminMatch) {
      setIsAdminUnlocked(true);
      setAdminPinPromptOpen(false);
      setAdminPinInput('');
      setAdminPinError(null);
    } else {
      setAdminPinError('Invalid Manager/Admin PIN. Please enter a valid 4-digit PIN.');
    }
  };

  // Void Cart Security Handler
  const handleClearCartWithSecurity = () => {
    if (cart.length === 0) return;
    const isManagerOrAdmin = currentUser?.role === 'Manager' || currentUser?.role === 'Admin' || isAdminUnlocked;

    if (isManagerOrAdmin) {
      if (window.confirm(`Void and clear active counter (${cart.length} items, total: $${subtotal.toFixed(2)})?`)) {
        if (currentUser) {
          logManagerOverride({
            action: 'VOID_CART',
            manager: currentUser,
            cashier: currentUser,
            details: `Counter cart voided by ${currentUser.role} ${currentUser.name} (${cart.length} items, $${subtotal.toFixed(2)})`,
            amount: subtotal,
            referenceId: 'CART',
          });
        }
        onClearCart();
      }
    } else {
      // Cashier requires Manager PIN to Void
      setManagerPinModalConfig({
        isOpen: true,
        title: 'Manager PIN Required: Void Cart',
        subtitle: 'Cashiers cannot void active transactions without Manager or Admin authorization',
        actionType: 'VOID',
        actionDescription: `Void active transaction of ${cart.length} item(s) ($${subtotal.toFixed(2)})`,
        amount: subtotal,
        onAuthorize: (manager, reason) => {
          logManagerOverride({
            action: 'VOID_CART',
            manager: manager,
            cashier: currentUser,
            details: `Counter cart voided for Cashier ${currentUser?.name || 'Staff'}. Authorized by ${manager.role} ${manager.name}. Reason: ${reason}`,
            amount: subtotal,
            referenceId: 'CART',
          });
          onClearCart();
          setManagerPinModalConfig(null);
        },
      });
    }
  };

  // Discount Security Handler (Discounts > 5% require Manager PIN)
  const handleApplyDiscountWithSecurity = () => {
    const isPercent = tempDiscountType === 'percent';
    const val = parseFloat(tempDiscountVal) || 0;
    const pct = isPercent ? val : (subtotal > 0 ? (val / subtotal) * 100 : 0);
    const dollarAmt = isPercent ? (subtotal * pct) / 100 : val;

    if (pct > 5) {
      const isManagerOrAdmin = currentUser?.role === 'Manager' || currentUser?.role === 'Admin' || isAdminUnlocked;
      if (isManagerOrAdmin) {
        if (currentUser) {
          logManagerOverride({
            action: 'DISCOUNT_OVERRIDE',
            manager: currentUser,
            cashier: currentUser,
            details: `${currentUser.role} applied ${pct.toFixed(1)}% discount ($${dollarAmt.toFixed(2)}) on subtotal $${subtotal.toFixed(2)}`,
            amount: dollarAmt,
            referenceId: 'CART',
          });
        }
        onApplyDiscount(tempDiscountType, tempDiscountVal);
        setShowDiscountModal(false);
      } else {
        // Cashier requires Manager PIN for discounts > 5%
        setManagerPinModalConfig({
          isOpen: true,
          title: 'Manager PIN Required: Discount > 5%',
          subtitle: `Discounts exceeding 5% (${pct.toFixed(1)}% requested) require Manager or Admin authorization`,
          actionType: 'DISCOUNT',
          actionDescription: `Authorize ${pct.toFixed(1)}% discount ($${dollarAmt.toFixed(2)}) on subtotal $${subtotal.toFixed(2)}`,
          amount: dollarAmt,
          onAuthorize: (manager, reason) => {
            logManagerOverride({
              action: 'DISCOUNT_OVERRIDE',
              manager: manager,
              cashier: currentUser,
              details: `${pct.toFixed(1)}% discount ($${dollarAmt.toFixed(2)}) approved for Cashier ${currentUser?.name || 'Staff'}. Authorized by ${manager.role} ${manager.name}. Reason: ${reason}`,
              amount: dollarAmt,
              referenceId: 'CART',
            });
            onApplyDiscount(tempDiscountType, tempDiscountVal);
            setShowDiscountModal(false);
            setManagerPinModalConfig(null);
          },
        });
      }
    } else {
      // 5% or less can be applied without Manager PIN
      onApplyDiscount(tempDiscountType, tempDiscountVal);
      setShowDiscountModal(false);
    }
  };

  return (
    <div className="space-y-3 pb-28 select-none animate-fadeIn">
      {/* 1. Top Header Bar (Matching Desired 2) */}
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
              Counter
            </h2>
            {selectedCustomer && (
              <span className="bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full border border-white/30 truncate max-w-[140px]">
                {selectedCustomer.name}
              </span>
            )}
          </div>

          {/* Right: Add Customer, Call */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onOpenCustomerModal}
              title={selectedCustomer ? `Customer: ${selectedCustomer.name}` : 'Select / Add Customer'}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition active:scale-95 ${
                selectedCustomer
                  ? 'bg-white text-[#6A4DFF] font-bold shadow'
                  : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              <UserPlus className="w-5 h-5" />
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
      </div>

      {/* Customer Quick Switcher & Active Customer Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 px-3.5 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
            selectedCustomer ? 'bg-purple-100 text-[#6A4DFF]' : 'bg-slate-100 text-slate-400'
          }`}>
            <UserPlus className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
              Customer Account
            </div>
            <div className="text-xs sm:text-sm font-black text-slate-900 truncate">
              {selectedCustomer ? (
                <span>
                  {selectedCustomer.name}{' '}
                  {selectedCustomer.phone && (
                    <span className="text-slate-400 font-normal">({selectedCustomer.phone})</span>
                  )}
                </span>
              ) : (
                <span className="text-slate-500 font-semibold">Walk-in Customer (Unregistered)</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {selectedCustomer && (
            <button
              type="button"
              onClick={() => onSelectCustomer(null)}
              className="px-2.5 py-1.5 text-[11px] font-bold text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 transition"
              title="Switch to Walk-in customer"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCustomerModal}
            className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-[#6A4DFF] text-xs font-black transition active:scale-95 border border-purple-200"
          >
            {selectedCustomer ? 'Change' : '+ Select Customer'}
          </button>
        </div>
      </div>

      {/* 2. Cart Items Container (Exact compact tile size from Screenshot Desired 2) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {cart.length === 0 ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-800">Your counter is empty</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                Select items from the catalog or scan barcodes to begin sale.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenItems}
              className="px-5 py-2.5 rounded-xl bg-[#6A4DFF] text-white text-xs font-black shadow hover:opacity-95 transition"
            >
              Browse Catalog (+ New Item)
            </button>
          </div>
        ) : (
          <div>
            {/* Gesture shortcut tips for cashiers */}
            <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Tap to <strong>+1</strong> • Hold 500ms to <strong>-1</strong> • Hold 2s to <strong>remove</strong>
              </span>
              <span className="text-[10px] text-slate-400 font-semibold hidden sm:inline">
                Pencil to edit
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {cart.map((item) => (
                <CartItemGestureRow
                  key={item.product.id}
                  item={item}
                  onUpdateQuantity={onUpdateQuantity}
                  onRemoveItem={onRemoveItem}
                  onStartEdit={handleStartEdit}
                  onRequestRemoveDialog={(it) => setItemToRemoveDialog(it)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. "Add New Item" Button + Quick Item + Barcode Scan Button */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onOpenItems}
          className="flex-1 py-3 px-4 rounded-2xl bg-white hover:bg-slate-50 border border-slate-300 text-[#1E40AF] font-black text-xs sm:text-sm tracking-wide shadow-sm flex items-center justify-center transition active:scale-[0.99]"
        >
          Add New Item
        </button>
        <button
          type="button"
          onClick={() => setShowQuickAddModal(true)}
          title="Quick Add Unlisted Product to Inventory & Counter"
          className="py-3 px-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-black text-xs tracking-wide shadow-sm flex items-center justify-center space-x-1.5 transition active:scale-95 shrink-0"
        >
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span>+ Quick Item</span>
        </button>
        <button
          type="button"
          onClick={onOpenItems}
          title="Scan Item"
          className="w-12 h-12 rounded-2xl bg-white hover:bg-slate-50 border border-slate-300 text-[#1E40AF] shadow-sm flex items-center justify-center transition active:scale-95 shrink-0"
        >
          <ScanLine className="w-5 h-5" />
        </button>
      </div>

      {/* 4. Financial Summary Card (Exact layout from Screenshot Desired 2) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2.5">
        {/* Subtotal */}
        <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-700">
          <span>Subtotal</span>
          <span className="font-mono-num text-slate-900 font-black">
            {subtotal % 1 === 0 ? subtotal : subtotal.toFixed(2)}
          </span>
        </div>

        {/* Separator */}
        <div className="border-t border-slate-100" />

        {/* Grand Total (Vibrant Blue font from Screenshot Desired 2) */}
        <div className="flex items-center justify-between">
          <span className="text-sm sm:text-base font-bold text-slate-700">Grand Total</span>
          <span className="font-mono-num text-lg sm:text-xl font-black text-[#1E40AF]">
            ${grandTotal % 1 === 0 ? grandTotal : grandTotal.toFixed(2)}
          </span>
        </div>

        {/* Two-Column Adjustments Section (Desired 2) */}
        <div className="flex items-start justify-between pt-2 border-t border-slate-100 text-xs text-blue-600 font-bold">
          {/* Left Column: Add Tax / Add Discount */}
          <div className="space-y-1">
            <div>
              <button
                type="button"
                onClick={() => setShowTaxModal(true)}
                className="hover:underline text-left"
              >
                {currentTax > 0 ? `Tax ($${currentTax.toFixed(2)})` : 'Add Tax'}
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  if (hasDiscountPermission) {
                    setShowDiscountModal(true);
                  } else {
                    setAdminPinPromptOpen(true);
                  }
                }}
                className="hover:underline text-left flex items-center space-x-1"
              >
                <span>
                  {calculatedDiscount > 0
                    ? `Disc (-$${calculatedDiscount.toFixed(2)})`
                    : 'Add Discount'}
                </span>
                {!hasDiscountPermission && (
                  <Lock className="w-2.5 h-2.5 text-slate-400 inline ml-0.5" />
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Items Count / Add Other Charges */}
          <div className="space-y-1 text-right">
            <div className="text-slate-500 font-medium text-[11px] whitespace-nowrap">
              {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} | {totalUnitsCount}{' '}
              {totalUnitsCount === 1 ? 'Unit' : 'Units'}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setShowChargesModal(true)}
                className="hover:underline text-right"
              >
                {currentOtherCharges > 0
                  ? `Fee ($${currentOtherCharges.toFixed(2)})`
                  : 'Add Other Charges'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. "Clear" (Salmon/Red) and "Save for later" (Amber/Orange) buttons (Desired 2) */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleClearCartWithSecurity}
          disabled={cart.length === 0}
          className="py-3 px-4 rounded-2xl bg-[#EF5350] hover:bg-[#E53935] disabled:opacity-40 text-white font-black text-xs sm:text-sm tracking-wide shadow-sm transition transform active:scale-95"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={onSaveForLater}
          disabled={cart.length === 0}
          className="py-3 px-4 rounded-2xl bg-[#FFA726] hover:bg-[#FB8C00] disabled:opacity-40 text-white font-black text-xs sm:text-sm tracking-wide shadow-sm transition transform active:scale-95"
        >
          Save for later
        </button>
      </div>

      {/* 6. Sticky Bottom Green "Charge: $X.XX" Button (Desired 2) */}
      <div className="fixed bottom-14 left-0 right-0 z-20 px-3 sm:px-4 pointer-events-auto">
        <div className="max-w-4xl mx-auto">
          <button
            id="btn-pos-charge"
            type="button"
            onClick={onCharge}
            disabled={cart.length === 0}
            className="w-full py-3.5 px-6 rounded-2xl bg-[#4CAF50] hover:bg-[#43A047] active:bg-[#388E3C] disabled:opacity-50 text-white font-black text-base sm:text-lg tracking-wide shadow-xl flex items-center justify-center space-x-2 transition transform active:scale-[0.99]"
          >
            <span>Charge: ${grandTotal % 1 === 0 ? grandTotal : grandTotal.toFixed(2)}</span>
          </button>
        </div>
      </div>

      {/* 7. Line Item Edit Modal with Admin Permission Control */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">Edit Line Item</h3>
                <span className="text-xs text-slate-500 font-semibold">
                  {editingItem.product.category} • {editingItem.product.unit || 'Each'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Product Title */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
              <div className="text-sm font-black text-slate-900 leading-snug">
                {editingItem.product.name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Standard Price: ${editingItem.product.price.toFixed(2)} | In Stock: {editingItem.product.stockQuantity}
              </div>
            </div>

            {/* Quantity Stepper */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const q = Math.max(1, (parseInt(editQtyInput, 10) || 1) - 1);
                    setEditQtyInput(String(q));
                  }}
                  className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center justify-center font-bold"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={editQtyInput}
                  onChange={(e) => setEditQtyInput(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-center text-lg font-mono-num font-black text-slate-950 focus:outline-none focus:border-[#6A4DFF] focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    const q = (parseInt(editQtyInput, 10) || 0) + 1;
                    setEditQtyInput(String(q));
                  }}
                  className="w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center font-bold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Unit Price (Gated by Admin Permission) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">Unit Price ($)</label>
                {!hasEditPricePermission && (
                  <button
                    type="button"
                    onClick={() => setAdminPinPromptOpen(true)}
                    className="text-[11px] font-bold text-purple-600 hover:text-purple-800 flex items-center space-x-1"
                  >
                    <Lock className="w-3 h-3" />
                    <span>Unlock Admin Price</span>
                  </button>
                )}
                {hasEditPricePermission && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Admin Price Edit Allowed</span>
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!hasEditPricePermission}
                  value={editPriceInput}
                  onChange={(e) => setEditPriceInput(e.target.value)}
                  className={`w-full border rounded-xl py-2.5 px-3 text-base font-mono-num font-black text-slate-950 focus:outline-none ${
                    hasEditPricePermission
                      ? 'bg-slate-50 border-slate-300 focus:border-emerald-500 focus:bg-white'
                      : 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                  }`}
                />
                {!hasEditPricePermission && (
                  <div
                    onClick={() => setAdminPinPromptOpen(true)}
                    className="absolute inset-0 cursor-pointer flex items-center justify-end pr-3"
                  >
                    <span className="text-xs font-bold text-slate-400 bg-white/80 px-2 py-1 rounded-lg border border-slate-200">
                      Locked for Staff (Tap to Authorize)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Switch to Fractional Calculator */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  const itm = editingItem;
                  setEditingItem(null);
                  setFractionalModalItem(itm);
                }}
                className="w-full py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <Scale className="w-3.5 h-3.5 text-emerald-600" />
                <span>Switch to Weight Factor / Price Calculator</span>
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onRemoveItem(editingItem.product.id);
                  setEditingItem(null);
                }}
                className="py-2.5 px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>

              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md transition active:scale-[0.99]"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fractional / Weight Factor Modal from Counter */}
      {fractionalModalItem && (
        <FractionalWeightModal
          isOpen={true}
          onClose={() => setFractionalModalItem(null)}
          product={fractionalModalItem.product}
          existingCartItem={fractionalModalItem}
          initialQuantity={fractionalModalItem.quantity}
          initialPrice={
            fractionalModalItem.customPrice !== undefined
              ? fractionalModalItem.customPrice
              : fractionalModalItem.product.price
          }
          onConfirm={(qty, unitPrice, notes) => {
            onSetQuantity(fractionalModalItem.product.id, qty);
            if (onSetCustomPrice && unitPrice !== undefined) {
              onSetCustomPrice(fractionalModalItem.product.id, unitPrice);
            }
            setFractionalModalItem(null);
          }}
          onRemove={(prodId) => {
            onRemoveItem(prodId);
            setFractionalModalItem(null);
          }}
        />
      )}

      {/* 8. Admin Authorization PIN Prompt Modal */}
      {adminPinPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-[#6A4DFF] text-white flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900">Admin Authorization</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Enter Admin PIN to unlock restricted function</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAdminPinPromptOpen(false);
                  setAdminPinInput('');
                  setAdminPinError(null);
                }}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {adminPinError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{adminPinError}</span>
              </div>
            )}

            <form onSubmit={handleVerifyAdminPin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Admin 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  autoFocus
                  required
                  value={adminPinInput}
                  onChange={(e) => setAdminPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 px-3 text-center text-xl font-mono-num font-black text-slate-950 focus:outline-none focus:border-[#6A4DFF] focus:bg-white"
                />
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdminPinPromptOpen(false);
                    setAdminPinInput('');
                    setAdminPinError(null);
                  }}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-black text-xs shadow-md flex items-center justify-center space-x-1"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Authorize Override</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. Overall Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Add Cart Discount</h3>
              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTempDiscountType('fixed')}
                className={`py-2 px-3 rounded-xl text-xs font-black transition border ${
                  tempDiscountType === 'fixed'
                    ? 'bg-[#6A4DFF] text-white border-purple-500 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Fixed Amount ($)
              </button>
              <button
                type="button"
                onClick={() => setTempDiscountType('percent')}
                className={`py-2 px-3 rounded-xl text-xs font-black transition border ${
                  tempDiscountType === 'percent'
                    ? 'bg-[#6A4DFF] text-white border-purple-500 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Percentage (%)
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  {tempDiscountType === 'fixed' ? 'Discount Value ($)' : 'Discount Rate (%)'}
                </label>
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-bold">
                  &gt; 5% requires Manager PIN
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={tempDiscountVal}
                onChange={(e) => setTempDiscountVal(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-lg font-mono-num font-black text-slate-950 focus:outline-none focus:border-[#6A4DFF] focus:bg-white"
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onApplyDiscount('fixed', '0');
                  setTempDiscountVal('0');
                  setShowDiscountModal(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleApplyDiscountWithSecurity}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#6A4DFF] hover:bg-[#583be0] text-white font-black text-xs shadow-md"
              >
                Apply Discount
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Tax Modal */}
      {showTaxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Add Tax Amount</h3>
              <button
                type="button"
                onClick={() => setShowTaxModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Sales Tax Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={customTaxVal}
                onChange={(e) => setCustomTaxVal(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-lg font-mono-num font-black text-slate-950 focus:outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCustomTaxVal('0');
                  if (onApplyTax) onApplyTax(0);
                  setShowTaxModal(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onApplyTax) onApplyTax(parseFloat(customTaxVal) || 0);
                  setShowTaxModal(false);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-md"
              >
                Apply Tax
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Other Charges Modal */}
      {showChargesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Add Other Fees / Delivery</h3>
              <button
                type="button"
                onClick={() => setShowChargesModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Other Charges Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={customChargeVal}
                onChange={(e) => setCustomChargeVal(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-lg font-mono-num font-black text-slate-950 focus:outline-none focus:border-amber-500 focus:bg-white"
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCustomChargeVal('0');
                  if (onApplyOtherCharges) onApplyOtherCharges(0);
                  setShowChargesModal(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onApplyOtherCharges) onApplyOtherCharges(parseFloat(customChargeVal) || 0);
                  setShowChargesModal(false);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs shadow-md"
              >
                Apply Fee
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12. Manager PIN Security Authorization Modal (Refunds, Voids, Discounts > 5%) */}
      {managerPinModalConfig && (
        <ManagerPinModal
          isOpen={managerPinModalConfig.isOpen}
          onClose={() => setManagerPinModalConfig(null)}
          title={managerPinModalConfig.title}
          subtitle={managerPinModalConfig.subtitle}
          actionType={managerPinModalConfig.actionType}
          actionDescription={managerPinModalConfig.actionDescription}
          amount={managerPinModalConfig.amount}
          currentStaff={currentUser}
          onAuthorize={managerPinModalConfig.onAuthorize}
        />
      )}

      {/* 13. Gesture 2-Second Hold: "Remove Item?" Confirmation Dialog */}
      {itemToRemoveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Remove Item?</h3>
                <p className="text-xs text-slate-500">
                  Are you sure you want to remove this item from the cart?
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-bold text-slate-800">
              {itemToRemoveDialog.product.name}
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setItemToRemoveDialog(null)}
                className="flex-1 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemoveItem(itemToRemoveDialog.product.id);
                  setItemToRemoveDialog(null);
                }}
                className="flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs shadow-md transition active:scale-95"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 14. Quick Add Product Modal from Counter */}
      <QuickAddProductModal
        isOpen={showQuickAddModal}
        onClose={() => setShowQuickAddModal(false)}
        onProductCreated={(newProd) => {
          if (onQuickAddProduct) {
            onQuickAddProduct(newProd);
          }
          setShowQuickAddModal(false);
        }}
      />
    </div>
  );
};