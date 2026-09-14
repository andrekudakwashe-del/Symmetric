import React, { useState, useMemo, useEffect } from 'react';
import {
  Product,
  Customer,
  Salesperson,
  SaleInvoice,
  SaleItem,
  PaymentMethod,
  ActiveTab,
  CartItem,
  ParkedSale,
} from '../../types';
import {
  getProducts,
  getCustomers,
  addCustomer,
  addSale,
  saveParkedSale,
  getParkedSales,
  deleteParkedSale,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  CreditCard,
  Banknote,
  Smartphone,
  Landmark,
  FileText,
  UserPlus,
  Receipt,
  RotateCcw,
  Printer,
  Share2,
  Calendar,
  AlertCircle,
  Package,
  Layers,
  Sparkles,
  ArrowRight,
  X,
  Check,
} from 'lucide-react';
import { POSHomeView } from './POSHomeView';
import { POSItemsView } from './POSItemsView';
import { POSCounterView } from './POSCounterView';
import { POSMoreDrawer } from './POSMoreDrawer';
import { ReceiptModal } from '../common/ReceiptModal';

interface POSRegisterProps {
  currentUser: Salesperson | null;
  onNavigate: (tab: ActiveTab, contextCustomer?: string) => void;
  preSelectedCustomerName?: string;
  initialView?: 'home' | 'items' | 'counter';
  activeGlobalTab?: ActiveTab;
  onLogout?: () => void;
}

export const POSRegister: React.FC<POSRegisterProps> = ({
  currentUser,
  onNavigate,
  preSelectedCustomerName,
  initialView = 'home',
  activeGlobalTab,
  onLogout,
}) => {
  // Navigation internal sub-view: 'home' | 'items' | 'counter' | 'more'
  const [currentView, setCurrentView] = useState<'home' | 'items' | 'counter' | 'more'>(() => {
    if (activeGlobalTab === 'items') return 'items';
    if (activeGlobalTab === 'counter') return 'counter';
    if (activeGlobalTab === 'more') return 'more';
    return initialView;
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountInput, setDiscountInput] = useState<string>('0');
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [otherCharges, setOtherCharges] = useState<number>(0);
  const [saleNotes, setSaleNotes] = useState<string>('');
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Checkout modal states
  const [showCheckoutModal, setShowCheckoutModal] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [changeLeftBehind, setChangeLeftBehind] = useState<boolean>(false);

  // Credit sale states
  const [creditDueDate, setCreditDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14); // 14 days default credit
    return d.toISOString().split('T')[0];
  });
  const [creditDepositInput, setCreditDepositInput] = useState<string>('0');
  const [creditNotes, setCreditNotes] = useState<string>('');

  // Quick Customer Create Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustAddress, setNewCustAddress] = useState<string>('');

  // Receipt Modal
  const [completedInvoice, setCompletedInvoice] = useState<SaleInvoice | null>(null);

  // Load data
  const loadData = () => {
    const prods = getProducts();
    const custs = getCustomers();
    setProducts(prods);
    setCustomers(custs);
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToDatabase(() => {
      loadData();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Sync with external global activeTab changes
  useEffect(() => {
    if (activeGlobalTab === 'items') setCurrentView('items');
    else if (activeGlobalTab === 'counter') setCurrentView('counter');
    else if (activeGlobalTab === 'more') setCurrentView('more');
    else if (activeGlobalTab === 'home' || activeGlobalTab === 'pos') {
      // Keep existing sub-view or stay on home if cart is empty
    }
  }, [activeGlobalTab]);

  // Pre-select customer if provided
  useEffect(() => {
    if (preSelectedCustomerName && customers.length > 0) {
      const target = preSelectedCustomerName.trim().toLowerCase();
      const match = customers.find(
        (c) => (c.name || '').trim().toLowerCase() === target
      );
      if (match) {
        setSelectedCustomerId(match.customerId);
      }
    }
  }, [preSelectedCustomerName, customers]);

  const activeCustomer = useMemo(() => {
    return customers.find((c) => c.customerId === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Calculations
  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const price = item.customPrice !== undefined ? item.customPrice : item.product.price;
      return sum + price * item.quantity;
    }, 0);
  }, [cart]);

  const calculatedDiscount = useMemo(() => {
    const val = parseFloat(discountInput) || 0;
    if (discountType === 'percent') {
      return (cartSubtotal * Math.min(100, Math.max(0, val))) / 100;
    }
    return Math.min(cartSubtotal, Math.max(0, val));
  }, [cartSubtotal, discountInput, discountType]);

  const cartTotal = useMemo(() => {
    return Math.max(0, cartSubtotal - calculatedDiscount + taxAmount + otherCharges);
  }, [cartSubtotal, calculatedDiscount, taxAmount, otherCharges]);

  const totalUnits = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Cash change calculations
  const parsedCashTendered = parseFloat(cashTendered) || 0;
  const cashChangeDue = Math.max(0, parsedCashTendered - cartTotal);

  // Credit calculations
  const parsedCreditDeposit = parseFloat(creditDepositInput) || 0;
  const creditBalanceOwed = Math.max(0, cartTotal - parsedCreditDeposit);

  // Toast Helper
  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast(null);
    }, 3000);
  };

  // Cart Actions
  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
        },
      ];
    });
  };

  const addFractionalToCart = (
    product: Product,
    quantity: number,
    customPrice?: number,
    notes?: string
  ) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.product.id === product.id);
      const unitPrice = customPrice !== undefined ? customPrice : product.price;
      const itemData: CartItem = {
        product,
        quantity,
        customPrice: unitPrice,
        isFractional: true,
        fractionUnit: product.fractionUnit || 'kg',
        weightFactor: quantity,
        saleType: 'Fractional',
        notes,
      };
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = itemData;
        return updated;
      }
      return [...prev, itemData];
    });
    showToast(`Added ${quantity} ${product.fractionUnit || 'kg'} of ${product.name}`);
  };

  const removeOneFromCart = (product: Product) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.product.id === product.id) {
            const newQty = item.quantity - 1;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const setQuantity = (productId: string, quantity: number) => {
    setCart((prev) => {
      return prev.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      );
    });
  };

  const setCustomPrice = (productId: string, customPrice: number) => {
    setCart((prev) => {
      return prev.map((item) =>
        item.product.id === productId ? { ...item, customPrice } : item
      );
    });
  };

  const removeItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountInput('0');
    setTaxAmount(0);
    setOtherCharges(0);
    setSaleNotes('');
    setCashTendered('');
    setCreditDepositInput('0');
    showToast('Counter cleared');
  };

  // Park sale ("Save for later")
  const handleSaveForLater = () => {
    if (cart.length === 0) return;
    saveParkedSale({
      customerName: activeCustomer ? activeCustomer.name : 'Walk-in Customer',
      customerId: activeCustomer?.customerId,
      items: cart,
      subtotal: cartSubtotal,
      total: cartTotal,
      notes: saleNotes,
    });
    setCart([]);
    showToast('Sale parked in Pending Sales');
    setCurrentView('home');
  };

  // Restore parked sale
  const handleRestoreParkedSale = (parked: ParkedSale) => {
    setCart(parked.items);
    if (parked.customerId) {
      setSelectedCustomerId(parked.customerId);
    }
    deleteParkedSale(parked.id);
    showToast('Parked sale restored to counter');
    setCurrentView('counter');
  };

  // Checkout modal trigger
  const handleOpenCheckout = () => {
    if (cart.length === 0) return;
    setCashTendered(cartTotal % 1 === 0 ? String(cartTotal) : cartTotal.toFixed(2));
    setCreditDepositInput('0');
    setPaymentMethod('Cash');
    setChangeLeftBehind(false);
    setShowCheckoutModal(true);
  };

  // Quick customer create
  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const created = addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      address: newCustAddress.trim(),
      createdBy: currentUser?.id || '001',
    });

    setCustomers((prev) => [created, ...prev]);
    setSelectedCustomerId(created.customerId);
    setShowAddCustomerModal(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    showToast(`Customer ${created.name} registered`);
  };

  // Process and finalize checkout
  const handleProcessCheckout = () => {
    if (cart.length === 0) return;

    const saleItems: SaleItem[] = cart.map((item) => {
      const unitPrice =
        item.customPrice !== undefined ? item.customPrice : item.product.price;
      return {
        id: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        category: item.product.category,
        quantity: item.quantity,
        unitPrice,
        total: unitPrice * item.quantity,
      };
    });

    const itemsSummary = cart
      .map((item) => {
        const qtyStr = item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(3).replace(/\.?0+$/, '');
        return `${qtyStr}x ${item.product.name}`;
      })
      .join(', ');

    const customerName = activeCustomer ? activeCustomer.name : 'Walk-in Customer';
    const customerId = activeCustomer ? activeCustomer.customerId : 'C_WALKIN';
    const today = new Date().toISOString().split('T')[0];

    const newSale = addSale({
      timestamp: new Date().toISOString(),
      date: today,
      customerId,
      customerName,
      items: saleItems,
      itemsSummary,
      subtotal: cartSubtotal,
      discount: calculatedDiscount,
      tax: taxAmount,
      total: cartTotal,
      paymentMethod,
      cashTendered: paymentMethod === 'Cash' ? parsedCashTendered : undefined,
      changeDue: paymentMethod === 'Cash' ? cashChangeDue : undefined,
      changeLeftBehind: paymentMethod === 'Cash' ? changeLeftBehind : undefined,
      creditDueDate: paymentMethod === 'Credit' ? creditDueDate : undefined,
      creditDeposit: paymentMethod === 'Credit' ? parsedCreditDeposit : undefined,
      creditBalanceOwed: paymentMethod === 'Credit' ? creditBalanceOwed : undefined,
      staffId: currentUser?.id || '001',
      staffName: currentUser?.name || 'Cashier',
      notes: saleNotes,
      status: 'Completed',
    });

    // Reset checkout state and show receipt modal
    setShowCheckoutModal(false);
    setCompletedInvoice(newSale);
    setCart([]);
    setDiscountInput('0');
    setTaxAmount(0);
    setOtherCharges(0);
    setSaleNotes('');
    loadData();
  };

  return (
    <div className="relative">
      {/* Status Toast */}
      {statusToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-slate-900 border border-emerald-500 text-emerald-300 text-xs font-bold rounded-2xl shadow-2xl flex items-center space-x-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{statusToast}</span>
        </div>
      )}

      {/* Screen 3: POS Home (+ New Sale / Add Expense / Pending Sales) */}
      {currentView === 'home' && (
        <POSHomeView
          currentUser={currentUser}
          onNavigateTab={onNavigate}
          onStartNewSale={() => setCurrentView('items')}
          onRestoreParkedSale={handleRestoreParkedSale}
          onOpenCustomerModal={() => setShowAddCustomerModal(true)}
          onOpenMoreMenu={() => setCurrentView('more')}
          onLogout={onLogout}
        />
      )}

      {/* Screen 2: Product Selection / Items Grid */}
      {currentView === 'items' && (
        <POSItemsView
          products={products}
          cart={cart}
          onAddToCart={addToCart}
          onAddFractionalToCart={addFractionalToCart}
          onRemoveOneFromCart={removeOneFromCart}
          onGoToCounter={() => setCurrentView('counter')}
          onOpenMoreMenu={() => setCurrentView('more')}
          onOpenCustomerModal={() => setShowAddCustomerModal(true)}
        />
      )}

      {/* Screen 1: Counter / Checkout List */}
      {currentView === 'counter' && (
        <POSCounterView
          cart={cart}
          customers={customers}
          selectedCustomer={activeCustomer}
          currentUser={currentUser}
          onSelectCustomer={(cust) => setSelectedCustomerId(cust ? cust.customerId : '')}
          onUpdateQuantity={updateQuantity}
          onSetQuantity={setQuantity}
          onSetCustomPrice={setCustomPrice}
          onRemoveItem={removeItem}
          onClearCart={clearCart}
          onSaveForLater={handleSaveForLater}
          onOpenItems={() => setCurrentView('items')}
          onCharge={handleOpenCheckout}
          onOpenMoreMenu={() => setCurrentView('more')}
          onOpenCustomerModal={() => setShowAddCustomerModal(true)}
          discountAmount={calculatedDiscount}
          discountType={discountType}
          discountInput={discountInput}
          onApplyDiscount={(type, val) => {
            setDiscountType(type);
            setDiscountInput(val);
          }}
          taxAmount={taxAmount}
          onApplyTax={(val) => setTaxAmount(val)}
          otherCharges={otherCharges}
          onApplyOtherCharges={(val) => setOtherCharges(val)}
        />
      )}

      {/* More Hub */}
      {currentView === 'more' && (
        <POSMoreDrawer
          onNavigate={(tab) => {
            if (tab === 'home' || tab === 'items' || tab === 'counter') {
              setCurrentView(tab);
            } else {
              onNavigate(tab);
            }
          }}
          onClose={() => setCurrentView('home')}
          currentUser={currentUser}
          pendingSyncCount={0}
          onLogout={onLogout}
        />
      )}

      {/* Quick Add Customer Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-5 space-y-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h3 className="text-base font-black">Register Customer</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="p-1 rounded-full bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Customer Full Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="e.g. Tendai Moyo, Kudakwashe"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Phone Number (EcoCash/WhatsApp)
                </label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="e.g. +263 77 123 4567"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Address / Site Location
                </label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  placeholder="e.g. 14 Enterprise Rd, Highlands"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Customer Selector from Existing list */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-xs font-bold text-slate-400 mb-1">
                  Or Select Existing Customer ({customers.length} registered)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => {
                    setSelectedCustomerId(e.target.value);
                    setShowAddCustomerModal(false);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2 text-white text-xs"
                >
                  <option value="">Walk-in Customer (Unregistered)</option>
                  {customers.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.name} {c.phone ? `(${c.phone})` : ''} - #{c.customerId}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="flex-1 py-2.5 rounded-2xl bg-slate-800 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs shadow-lg"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black">Complete Checkout</h3>
                <p className="text-xs text-slate-400">
                  Customer: <span className="text-orange-400 font-bold">{activeCustomer?.name || 'Walk-in Customer'}</span>
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Due</span>
                <span className="text-xl font-black font-mono text-emerald-400">
                  ${cartTotal % 1 === 0 ? cartTotal : cartTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Payment Methods */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Cash')}
                    className={`p-3 rounded-2xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'Cash'
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Banknote className="w-5 h-5 text-emerald-400" />
                    <span className="text-xs">Cash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Credit')}
                    className={`p-3 rounded-2xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'Credit'
                        ? 'bg-rose-950/70 border-rose-500 text-rose-300 ring-2 ring-rose-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 text-rose-400" />
                    <span className="text-xs">Credit (Form 3)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('EcoCash/Mobile')}
                    className={`p-3 rounded-2xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'EcoCash/Mobile'
                        ? 'bg-blue-950/70 border-blue-500 text-blue-300 ring-2 ring-blue-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-5 h-5 text-blue-400" />
                    <span className="text-xs">EcoCash / Swipe</span>
                  </button>
                </div>
              </div>

              {/* Cash Tender & Change Math */}
              {paymentMethod === 'Cash' && (
                <div className="space-y-3 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Cash Tendered ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 text-lg font-mono-num font-black text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Quick Dollar Presets */}
                  <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
                    {[1, 5, 10, 20, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCashTendered(String(preset))}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold shrink-0"
                      >
                        ${preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCashTendered(String(cartTotal))}
                      className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold shrink-0"
                    >
                      Exact
                    </button>
                  </div>

                  {/* Change Due Display */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                    <span className="font-bold text-slate-400">Change Due:</span>
                    <span
                      className={`font-mono-num font-black text-base ${
                        cashChangeDue > 0 ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      ${cashChangeDue.toFixed(2)}
                    </span>
                  </div>

                  {/* Change Left Behind Toggle */}
                  {cashChangeDue > 0 && (
                    <label className="flex items-center space-x-2 text-xs text-amber-300 cursor-pointer pt-1 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/30">
                      <input
                        type="checkbox"
                        checked={changeLeftBehind}
                        onChange={(e) => setChangeLeftBehind(e.target.checked)}
                        className="rounded text-amber-500 bg-slate-950 border-amber-500"
                      />
                      <span>Customer leaves change with shop (Log in Form 3)</span>
                    </label>
                  )}
                </div>
              )}

              {/* Credit Sale Form 3 Fields */}
              {paymentMethod === 'Credit' && (
                <div className="space-y-3 bg-rose-950/30 p-3.5 rounded-2xl border border-rose-800/40 text-xs">
                  <div className="text-rose-300 font-bold flex items-center space-x-1.5">
                    <CreditCard className="w-4 h-4" />
                    <span>Auto-fills Form 3 (Credit Sales) & Debtor Ledger</span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Upfront Cash Deposit ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={creditDepositInput}
                      onChange={(e) => setCreditDepositInput(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 font-mono-num text-white"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Expected Repayment Due Date</label>
                    <input
                      type="date"
                      value={creditDueDate}
                      onChange={(e) => setCreditDueDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 text-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900 font-bold">
                    <span className="text-slate-400">Balance Added to Debt Ledger:</span>
                    <span className="text-rose-400 font-mono-num text-sm font-black">
                      ${creditBalanceOwed.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Order Notes */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Receipt Note (Optional)</label>
                <input
                  type="text"
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  placeholder="e.g. Authorized by Manager, Warranty Slip #902"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCheckoutModal(false)}
                  className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleProcessCheckout}
                  className="flex-1 py-3 rounded-2xl bg-[#4CAF50] hover:bg-[#43A047] active:bg-[#388E3C] text-white font-black text-xs shadow-lg flex items-center justify-center space-x-1.5 transition active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>Complete & Print</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      {completedInvoice && (
        <ReceiptModal
          isOpen={!!completedInvoice}
          invoice={completedInvoice}
          onClose={() => {
            setCompletedInvoice(null);
            setCurrentView('home');
          }}
        />
      )}
    </div>
  );
};
