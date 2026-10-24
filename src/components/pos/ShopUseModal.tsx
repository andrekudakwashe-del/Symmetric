import React, { useState, useEffect, useMemo } from 'react';
import { Salesperson, Product, ConsumptionType, InternalConsumption } from '../../types';
import { getProducts, getSalespeople } from '../../db/roomDatabase';
import {
  createInternalConsumptionRequest,
  approveInternalConsumption,
  rejectInternalConsumption,
  getInternalConsumptions,
} from '../../services/walletService';
import {
  Utensils,
  ShoppingBag,
  ShieldAlert,
  CheckCircle,
  X,
  Plus,
  Minus,
  Trash2,
  Lock,
  AlertTriangle,
  Search,
  Check,
  Clock,
  Home,
  UserCheck,
  Layers,
  Sparkles,
  ArrowRight,
  Eye,
  BadgePercent,
  CheckCircle2,
} from 'lucide-react';

interface ShopUseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
}

export const ShopUseModal: React.FC<ShopUseModalProps> = ({ isOpen, onClose, currentUser }) => {
  // 1. ALL useState hooks strictly at the top in stable order
  const [activeTab, setActiveTab] = useState<'register' | 'pending'>('register');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [consumptionType, setConsumptionType] = useState<ConsumptionType>('STAFF_WELFARE');
  const [notes, setNotes] = useState<string>('');
  const [cart, setCart] = useState<
    Array<{
      product: Product;
      quantity: number;
    }>
  >([]);

  // Instant Supervisor PIN Authorization state
  const [showInstantPin, setShowInstantPin] = useState(false);
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Pending Approval Action State (for supervisors reviewing in pending tab)
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [reviewSupervisorPin, setReviewSupervisorPin] = useState<string>('');
  const [reviewApproverId, setReviewApproverId] = useState<string>('');
  const [internalConsumptions, setInternalConsumptions] = useState<InternalConsumption[]>([]);

  // Rejection Dialog State (replaces window.prompt)
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('Not Authorized / Excessive');

  // 2. ALL useMemo hooks
  const salespeople = getSalespeople();
  const supervisors = useMemo(() => {
    return salespeople.filter(
      (s) => s.role === 'Supervisor' || s.role === 'Admin' || s.role === 'OWNER' || s.role === 'SUPER_ADMIN'
    );
  }, [salespeople]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['All', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchQuery =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCat && matchQuery;
    });
  }, [products, selectedCategory, searchQuery]);

  const pendingRequests = useMemo(() => {
    return internalConsumptions.filter((r) => r.status === 'PENDING');
  }, [internalConsumptions]);

  const pastRequests = useMemo(() => {
    return internalConsumptions.filter((r) => r.status !== 'PENDING');
  }, [internalConsumptions]);

  // 3. Helper loader
  const loadData = () => {
    setProducts(getProducts());
    setInternalConsumptions(getInternalConsumptions());
  };

  // 4. ALL useEffect hooks
  useEffect(() => {
    if (isOpen) {
      loadData();
      setCart([]);
      setNotes('');
      setSupervisorPin('');
      setShowInstantPin(false);
      setStatusNotice(null);
      setApprovingRequestId(null);
      setRejectingRequestId(null);
      if (supervisors.length > 0) {
        setSelectedSupervisorId(supervisors[0].id);
        setReviewApproverId(supervisors[0].id);
      }
    }
  }, [isOpen]);

  // Cart operations
  const handleAddToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as Array<{ product: Product; quantity: number }>
    );
  };

  const handleSetExactQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      handleRemoveFromCart(productId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity: qty } : item))
    );
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const totalCost = cart.reduce(
    (sum, item) => sum + (item.product.costPrice || item.product.price * 0.7) * item.quantity,
    0
  );
  const totalRetail = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);

  // 1. CASHIER: Submit as Pending Approval
  const handleSubmitAsPending = () => {
    setStatusNotice(null);
    if (cart.length === 0) {
      setStatusNotice({ text: 'Please add at least one product to the shop use cart.', type: 'error' });
      return;
    }

    try {
      const request = createInternalConsumptionRequest({
        type: consumptionType,
        items: cart.map((i) => ({
          productId: i.product.id,
          productName: i.product.name,
          sku: i.product.sku,
          quantity: i.quantity,
          costPrice: i.product.costPrice || i.product.price * 0.7,
          retailPrice: i.product.price,
        })),
        requestedBy: currentUser,
        notes: notes.trim() || undefined,
      });

      setStatusNotice({
        text: `Submitted! Request #${request.id} for $${totalCost.toFixed(2)} cost is now PENDING supervisor approval.`,
        type: 'success',
      });
      setCart([]);
      setNotes('');
      loadData();
      setTimeout(() => {
        setActiveTab('pending');
      }, 1200);
    } catch (err: any) {
      setStatusNotice({ text: err.message || 'Failed to submit request.', type: 'error' });
    }
  };

  // 2. INSTANT SUPERVISOR PIN AUTHORIZATION
  const handleInstantAuthorize = () => {
    setStatusNotice(null);
    if (cart.length === 0) {
      setStatusNotice({ text: 'Please add at least one product to the shop use cart.', type: 'error' });
      return;
    }

    const sup = salespeople.find((s) => s.id === selectedSupervisorId);
    if (!sup) {
      setStatusNotice({ text: 'Please select a valid authorizing supervisor.', type: 'error' });
      return;
    }

    if (!supervisorPin || supervisorPin.trim().length < 4) {
      setStatusNotice({ text: 'Please enter the 4-6 digit supervisor security PIN.', type: 'error' });
      return;
    }

    if (sup.pin && sup.pin !== supervisorPin.trim()) {
      setStatusNotice({ text: 'Incorrect supervisor PIN. Authorization failed.', type: 'error' });
      return;
    }

    if (currentUser.id === sup.id && sup.role !== 'OWNER' && sup.role !== 'Admin' && sup.role !== 'SUPER_ADMIN') {
      setStatusNotice({
        text: 'Segregation of duties: Cashiers cannot approve their own shop use request.',
        type: 'error',
      });
      return;
    }

    // 1. Create request
    const request = createInternalConsumptionRequest({
      type: consumptionType,
      items: cart.map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        sku: i.product.sku,
        quantity: i.quantity,
        costPrice: i.product.costPrice || i.product.price * 0.7,
        retailPrice: i.product.price,
      })),
      requestedBy: currentUser,
      notes: notes.trim() || undefined,
    });

    // 2. Approve immediately with PIN
    const res = approveInternalConsumption(request.id, sup, supervisorPin);
    if (!res.success) {
      setStatusNotice({ text: res.message, type: 'error' });
      return;
    }

    setStatusNotice({
      text: `Approved! Invoice $0 issued. Stock deducted and $${totalCost.toFixed(2)} recorded at cost.`,
      type: 'success',
    });
    setCart([]);
    setNotes('');
    setSupervisorPin('');
    setShowInstantPin(false);
    loadData();
    setTimeout(() => {
      onClose();
    }, 1800);
  };

  // 3. SUPERVISOR APPROVES PENDING REQUEST
  const handleApprovePending = (reqId: string) => {
    const approver = salespeople.find((s) => s.id === reviewApproverId) || currentUser;
    if (!approver) return;

    if (!reviewSupervisorPin || reviewSupervisorPin.trim().length < 4) {
      setStatusNotice({ text: 'Please enter your supervisor PIN to approve.', type: 'error' });
      return;
    }

    if (approver.pin && approver.pin !== reviewSupervisorPin.trim()) {
      setStatusNotice({ text: 'Incorrect supervisor PIN. Authorization failed.', type: 'error' });
      return;
    }

    const res = approveInternalConsumption(reqId, approver, reviewSupervisorPin);
    if (res.success) {
      setStatusNotice({ text: res.message, type: 'success' });
      setApprovingRequestId(null);
      setReviewSupervisorPin('');
      loadData();
    } else {
      setStatusNotice({ text: res.message, type: 'error' });
    }
  };

  const handleOpenRejectModal = (reqId: string) => {
    setRejectingRequestId(reqId);
    setRejectionReasonInput('Not Authorized / Excessive');
  };

  const handleConfirmReject = () => {
    if (!rejectingRequestId) return;
    const reason = rejectionReasonInput.trim() || 'Not Authorized';
    const res = rejectInternalConsumption(rejectingRequestId, currentUser, reason);
    if (res.success) {
      setStatusNotice({ text: res.message, type: 'success' });
      setRejectingRequestId(null);
      loadData();
    } else {
      setStatusNotice({ text: res.message, type: 'error' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl text-white flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-slate-950 shadow-md">
              <Utensils className="w-5 h-5 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight">Shop Use &amp; Internal Consumption</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 font-mono">
                  Non-Cash • Affects P&amp;L Profit • Stock at Cost
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Goods taken to provide meals for staff or supplies. Non-cash transaction: affects profit in P&amp;L, zero cash outflow from drawer.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* View Mode Tabs */}
            <div className="flex bg-slate-900 border border-slate-800 rounded-2xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'register'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Register POS</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 relative ${
                  activeTab === 'pending'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Pending &amp; History</span>
                {pendingRequests.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                    {pendingRequests.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-2xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Notice Banner */}
        {statusNotice && (
          <div
            className={`p-3 text-xs flex items-center justify-between gap-2 border-b font-medium animate-fadeIn ${
              statusNotice.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
                : 'bg-rose-950/70 border-rose-800 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusNotice.type === 'success' ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{statusNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tab 1: POS Register & Cart View */}
        {activeTab === 'register' && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* LEFT: Product Catalog Panel (7 cols) */}
            <div className="lg:col-span-7 p-4 border-r border-slate-800 flex flex-col overflow-hidden bg-slate-900/50">
              {/* Search & Category Filter */}
              <div className="space-y-2 mb-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search product name, barcode, or SKU..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Categories */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${
                        selectedCategory === cat
                          ? 'bg-slate-800 text-amber-300 border border-amber-500/40 shadow'
                          : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Products Grid */}
              <div className="flex-1 overflow-y-auto pr-1">
                {filteredProducts.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
                    <ShoppingBag className="w-8 h-8 mb-2 opacity-40" />
                    <span>No products found matching "{searchQuery}"</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {filteredProducts.map((p) => {
                      const cost = p.costPrice || p.price * 0.7;
                      const inCart = cart.find((i) => i.product.id === p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleAddToCart(p)}
                          className={`p-2.5 rounded-2xl border cursor-pointer transition active:scale-[0.98] flex flex-col justify-between group ${
                            inCart
                              ? 'bg-amber-950/30 border-amber-500/60 shadow-md'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[10px] text-slate-400 font-mono truncate">{p.sku || 'SKU'}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-slate-800 text-slate-300">
                                Stock: {p.stock}
                              </span>
                            </div>
                            <h4 className="text-xs font-bold text-white line-clamp-2 group-hover:text-amber-300 transition">
                              {p.name}
                            </h4>
                          </div>

                          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                            <div>
                              <div className="text-[10px] text-amber-400 font-bold font-mono">
                                Cost: ${cost.toFixed(2)}
                              </div>
                              <div className="text-[9px] text-slate-500 line-through">
                                Retail: ${p.price.toFixed(2)}
                              </div>
                            </div>
                            {inCart ? (
                              <span className="w-6 h-6 rounded-xl bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shadow">
                                {inCart.quantity}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="w-6 h-6 rounded-xl bg-slate-800 text-slate-300 group-hover:bg-amber-500 group-hover:text-slate-950 flex items-center justify-center transition"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Register Cart & Processing (5 cols) */}
            <div className="lg:col-span-5 p-4 flex flex-col justify-between overflow-hidden bg-slate-950">
              <div className="space-y-3 flex-1 flex flex-col overflow-hidden">
                {/* Consumption Category Selector */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">Consumption Purpose</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConsumptionType('STAFF_WELFARE')}
                      className={`p-2 rounded-2xl border text-center transition ${
                        consumptionType === 'STAFF_WELFARE'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold">Staff Food</div>
                      <div className="text-[9px] text-slate-500">Meals &amp; Tea</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsumptionType('OWNER_DRAWING_GROCERIES')}
                      className={`p-2 rounded-2xl border text-center transition ${
                        consumptionType === 'OWNER_DRAWING_GROCERIES'
                          ? 'bg-purple-500/20 border-purple-500 text-purple-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold">Home Groceries</div>
                      <div className="text-[9px] text-slate-500">Owner Drawing</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsumptionType('STORE_SUPPLIES')}
                      className={`p-2 rounded-2xl border text-center transition ${
                        consumptionType === 'STORE_SUPPLIES'
                          ? 'bg-blue-500/20 border-blue-500 text-blue-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold">Shop Supplies</div>
                      <div className="text-[9px] text-slate-500">Cleaning/Bags</div>
                    </button>
                  </div>
                </div>

                {/* Cart Items List */}
                <div className="flex-1 overflow-y-auto border border-slate-800 rounded-2xl p-2 bg-slate-900/60 space-y-1.5">
                  {cart.length === 0 ? (
                    <div className="h-44 flex flex-col items-center justify-center text-slate-500 text-xs">
                      <ShoppingBag className="w-8 h-8 mb-2 opacity-30 text-amber-400" />
                      <span>Shop Use cart is empty</span>
                      <span className="text-[10px] text-slate-600">Select products on the left to add</span>
                    </div>
                  ) : (
                    cart.map((item) => {
                      const cost = item.product.costPrice || item.product.price * 0.7;
                      const lineCost = cost * item.quantity;
                      return (
                        <div
                          key={item.product.id}
                          className="p-2 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs"
                        >
                          <div className="flex-1 mr-2 min-w-0">
                            <h5 className="font-bold text-white truncate">{item.product.name}</h5>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                              <span>Cost: ${cost.toFixed(2)}</span>
                              <span>•</span>
                              <span className="text-amber-400 font-mono font-bold">
                                Total: ${lineCost.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(item.product.id, -1)}
                              className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                handleSetExactQuantity(item.product.id, parseInt(e.target.value) || 1)
                              }
                              className="w-8 text-center bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(item.product.id, 1)}
                              className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveFromCart(item.product.id)}
                              className="p-1 text-rose-400 hover:text-rose-300 ml-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Notes Input */}
                <div>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason/Notes (e.g. Staff bread & tea for morning shift)..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Financial Summary Box */}
                <div className="bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 border border-amber-500/30 rounded-2xl p-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Total Items:</span>
                    <span className="font-bold text-white">{totalQuantity} units</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Retail Value (Waived):</span>
                    <span className="font-mono text-slate-300 line-through">${totalRetail.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-black border-t border-slate-800/80 pt-1.5">
                    <span className="text-amber-300">Total Deducted at Cost:</span>
                    <span className="text-amber-400 font-mono">${totalCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                {/* Instant PIN section if toggled */}
                {showInstantPin && (
                  <div className="p-3 bg-slate-900 border border-amber-500/40 rounded-2xl space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Supervisor Instant Authorization</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowInstantPin(false)}
                        className="text-slate-400 hover:text-white text-[10px]"
                      >
                        Cancel PIN
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Supervisor</label>
                        <select
                          value={selectedSupervisorId}
                          onChange={(e) => setSelectedSupervisorId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-white"
                        >
                          {supervisors.map((s, sIdx) => (
                            <option key={`${s.id}-${sIdx}`} value={s.id}>
                              {s.name} ({s.role})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Supervisor PIN</label>
                        <input
                          type="password"
                          maxLength={6}
                          value={supervisorPin}
                          onChange={(e) => setSupervisorPin(e.target.value)}
                          placeholder="Enter PIN"
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-white text-center font-mono font-bold tracking-widest focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleInstantAuthorize}
                      disabled={cart.length === 0}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm &amp; Authorize Now (${totalCost.toFixed(2)})</span>
                    </button>
                  </div>
                )}

                {/* Main 2 Submission Buttons */}
                {!showInstantPin && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleSubmitAsPending}
                      disabled={cart.length === 0}
                      className="py-2.5 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-300 font-bold text-xs flex flex-col items-center justify-center gap-0.5 border border-slate-700 transition active:scale-95 shadow-md cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Submit as Pending</span>
                      </div>
                      <span className="text-[9px] text-slate-400">Cashier queue for approval</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowInstantPin(true)}
                      disabled={cart.length === 0}
                      className="py-2.5 px-3 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs flex flex-col items-center justify-center gap-0.5 transition active:scale-95 shadow-lg cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Authorize with PIN</span>
                      </div>
                      <span className="text-[9px] text-slate-900/80">Immediate approval</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Pending Requests & Audit History */}
        {activeTab === 'pending' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-slate-950">
            {/* PENDING APPROVAL QUEUE */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Pending Requests Awaiting Supervisor Authorization ({pendingRequests.length})</span>
                </h4>
                <span className="text-[11px] text-slate-400">
                  Cashiers process requests here; Supervisor checks and enters PIN to deduct stock at cost.
                </span>
              </div>

              {pendingRequests.length === 0 ? (
                <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center text-slate-500 text-xs">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
                  <p className="font-bold text-slate-400">All caught up!</p>
                  <p className="text-[11px]">No pending shop use or staff food requests.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pendingRequests.map((req) => {
                    const isApproving = approvingRequestId === req.id;
                    return (
                      <div
                        key={req.id}
                        className="bg-slate-900 border border-amber-500/40 rounded-3xl p-4 shadow-xl space-y-3 relative overflow-hidden"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-white text-xs">{req.id}</span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                {req.type === 'STAFF_WELFARE'
                                  ? 'Staff Welfare'
                                  : req.type === 'OWNER_DRAWING_GROCERIES'
                                  ? 'Owner Groceries'
                                  : 'Shop Supplies'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Requested by: <strong className="text-white">{req.requestedByName}</strong> •{' '}
                              {new Date(req.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-xs text-slate-400 block">Cost Total</span>
                            <span className="text-sm font-black text-amber-400 font-mono">
                              ${req.totalCost.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Items list */}
                        <div className="bg-slate-950/80 rounded-2xl p-2.5 border border-slate-800/80 space-y-1 text-xs">
                          {req.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[11px]">
                              <span className="text-slate-300">
                                {it.quantity}x {it.productName}
                              </span>
                              <span className="text-amber-400 font-mono font-bold">${it.totalCost.toFixed(2)}</span>
                            </div>
                          ))}
                          {req.notes && (
                            <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800">
                              Note: {req.notes}
                            </div>
                          )}
                        </div>

                        {/* Supervisor PIN input if actively approving */}
                        {isApproving ? (
                          <div className="p-3 bg-slate-950 rounded-2xl border border-amber-500/50 space-y-2 animate-fadeIn">
                            <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5" />
                              <span>Authorize Request #{req.id}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">Supervisor</label>
                                <select
                                  value={reviewApproverId}
                                  onChange={(e) => setReviewApproverId(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 text-xs text-white"
                                >
                                  {supervisors.map((s, sIdx) => (
                                    <option key={`${s.id}-${sIdx}`} value={s.id}>
                                      {s.name} ({s.role})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">PIN</label>
                                <input
                                  type="password"
                                  maxLength={6}
                                  value={reviewSupervisorPin}
                                  onChange={(e) => setReviewSupervisorPin(e.target.value)}
                                  placeholder="Enter PIN"
                                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 text-xs text-white text-center font-mono font-bold tracking-widest focus:outline-none focus:border-amber-500"
                                />
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setApprovingRequestId(null)}
                                className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApprovePending(req.id)}
                                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow cursor-pointer"
                              >
                                Authorize &amp; Deduct Stock
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setApprovingRequestId(req.id);
                                setReviewSupervisorPin('');
                              }}
                              className="flex-1 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Authorize (PIN)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenRejectModal(req.id)}
                              className="px-3 py-2 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 font-bold text-xs flex items-center justify-center gap-1 border border-rose-500/30 transition cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RECENT AUTHORIZED HISTORY */}
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Authorized &amp; Processed History ({pastRequests.length})</span>
              </h4>

              {pastRequests.length === 0 ? (
                <p className="text-xs text-slate-500">No past requests recorded yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                        <th className="p-3">ID</th>
                        <th className="p-3">Date</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Requested By</th>
                        <th className="p-3">Approved By</th>
                        <th className="p-3">Cost ($)</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {pastRequests.slice(0, 10).map((r, rIdx) => (
                        <tr key={`${r.id}-${rIdx}`} className="hover:bg-slate-800/40">
                          <td className="p-3 font-mono font-bold text-white">{r.id}</td>
                          <td className="p-3 text-slate-400">{r.date}</td>
                          <td className="p-3 font-bold text-slate-300">{r.type}</td>
                          <td className="p-3 text-slate-300">{r.requestedByName}</td>
                          <td className="p-3 text-emerald-400 font-bold">{r.approvedByName || '—'}</td>
                          <td className="p-3 font-mono font-bold text-amber-400">${r.totalCost.toFixed(2)}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                r.status === 'APPROVED'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Non-blocking Rejection Reason Dialog (replaces window.prompt) */}
      {rejectingRequestId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-slate-900 border border-rose-500/50 rounded-3xl p-5 max-w-md w-full shadow-2xl space-y-4 text-white">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>Reject Request #{rejectingRequestId}</span>
            </div>
            <p className="text-xs text-slate-300">
              Please enter the reason for rejecting this internal consumption request:
            </p>
            <input
              type="text"
              value={rejectionReasonInput}
              onChange={(e) => setRejectionReasonInput(e.target.value)}
              placeholder="Reason (e.g. Excessive / Not authorized)"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-400 font-medium"
              autoFocus
            />
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setRejectingRequestId(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow cursor-pointer"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
