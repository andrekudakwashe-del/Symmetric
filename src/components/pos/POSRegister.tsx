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
  AppCurrency,
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
  getMultiCurrencyConfig,
  getActiveCurrencies,
  getCurrencyRate,
  getCreditPolicy,
  getCustomerCreditSummary,
  isSupervisorOrAbove,
  isBranchInLockdown,
  getCurrentBranchId,
  getCurrentBranch,
} from '../../db/roomDatabase';
import { ManagerPinModal } from '../common/ManagerPinModal';
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
  UserCheck,
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
  ChevronDown,
  ChevronUp,
  X,
  Check,
  Coins,
  RefreshCw,
  Clock,
  Settings,
} from 'lucide-react';
import { POSHomeView } from './POSHomeView';
import { POSItemsView } from './POSItemsView';
import { POSCounterView } from './POSCounterView';
import { POSMoreDrawer } from './POSMoreDrawer';
import { POSOrdersHistory } from './POSOrdersHistory';
import { ReceiptModal } from '../common/ReceiptModal';
import { CustomerSearchModal } from '../common/CustomerSearchModal';
import { ExchangeRatesModal } from '../common/ExchangeRatesModal';

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
  const [selectedCurrency, setSelectedCurrency] = useState<AppCurrency>('USD');
  const [openCashWithdrawal, setOpenCashWithdrawal] = useState<boolean>(false);
  const [cashWithdrawalInput, setCashWithdrawalInput] = useState<string>('');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [changeLeftBehind, setChangeLeftBehind] = useState<boolean>(false);
  const [actualChangeLeftInput, setActualChangeLeftInput] = useState<string>('');
  const [checkoutWarning, setCheckoutWarning] = useState<string | null>(null);
  const [showCustomerPickerInCheckout, setShowCustomerPickerInCheckout] = useState<boolean>(false);
  const [showSearchCustomerModal, setShowSearchCustomerModal] = useState<boolean>(false);

  // Credit sale states
  const [creditAmountInput, setCreditAmountInput] = useState<string>('0');
  const [creditDueDate, setCreditDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14); // 14 days default credit
    return d.toISOString().split('T')[0];
  });
  const [creditDepositInput, setCreditDepositInput] = useState<string>('0');
  const [creditNotes, setCreditNotes] = useState<string>('');
  const [showCreditSupervisorModal, setShowCreditSupervisorModal] = useState<boolean>(false);
  const [creditApprovalRequiredReason, setCreditApprovalRequiredReason] = useState<string>('');
  const [creditAuthorizedBy, setCreditAuthorizedBy] = useState<Salesperson | null>(null);
  const [allowQueueForReview, setAllowQueueForReview] = useState<boolean>(false);

  // Stocktake Branch Lockdown authorization state
  const [isLockedDown, setIsLockedDown] = useState<boolean>(() => isBranchInLockdown());
  const [showLockdownSupervisorModal, setShowLockdownSupervisorModal] = useState<boolean>(false);
  const [lockdownAuthorizedBy, setLockdownAuthorizedBy] = useState<Salesperson | null>(null);

  // Receipt Modal
  const [completedInvoice, setCompletedInvoice] = useState<SaleInvoice | null>(null);
  const [showReceiptsModal, setShowReceiptsModal] = useState<boolean>(false);
  const [showExchangeModal, setShowExchangeModal] = useState<boolean>(false);
  const [showCurrencyPickerModal, setShowCurrencyPickerModal] = useState<boolean>(false);
  const [multiConfig, setMultiConfig] = useState(() => getMultiCurrencyConfig());
  const [proofOfPaymentRef, setProofOfPaymentRef] = useState<string>('');

  // Load data
  const loadData = () => {
    const prods = getProducts();
    const custs = getCustomers();
    setProducts(prods);
    setCustomers(custs);
    setMultiConfig(getMultiCurrencyConfig());
    setIsLockedDown(isBranchInLockdown());
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

  // Customer registration verification (Walk-in customers cannot leave change or buy on credit)
  const isRegisteredCustomer = useMemo(() => {
    if (!activeCustomer) return false;
    const cid = (activeCustomer.customerId || '').trim().toLowerCase();
    const name = (activeCustomer.name || '').trim().toLowerCase();
    if (
      !cid ||
      cid === 'c_walkin' ||
      cid === 'walkin' ||
      name === 'walk-in customer' ||
      name === 'walk in customer' ||
      name === 'walkin'
    ) {
      return false;
    }
    return true;
  }, [activeCustomer]);

  // Cash change calculations
  const parsedCashTendered = parseFloat(cashTendered) || 0;
  const cashChangeDue = Math.max(0, parsedCashTendered - cartTotal);

  // Actual change left behind: defaults to full cashChangeDue if empty, or parsed number
  const parsedActualChangeLeft = useMemo(() => {
    if (!changeLeftBehind) return 0;
    if (actualChangeLeftInput.trim() === '') return cashChangeDue;
    const num = parseFloat(actualChangeLeftInput);
    if (isNaN(num)) return 0;
    return Math.max(0, num);
  }, [changeLeftBehind, actualChangeLeftInput, cashChangeDue]);

  // Physical cash given back from cash drawer to customer
  const physicalCashReturned = useMemo(() => {
    if (!changeLeftBehind) return cashChangeDue;
    return Math.max(0, cashChangeDue - parsedActualChangeLeft);
  }, [cashChangeDue, changeLeftBehind, parsedActualChangeLeft]);

  // Credit calculations: creditAmount defaults to cartTotal if not customized
  const parsedCreditAmount = useMemo(() => {
    if (creditAmountInput.trim() === '') return cartTotal;
    const num = parseFloat(creditAmountInput);
    if (isNaN(num) || num < 0) return cartTotal;
    return num;
  }, [creditAmountInput, cartTotal]);

  const parsedCreditDeposit = useMemo(() => {
    const num = parseFloat(creditDepositInput);
    if (isNaN(num) || num < 0) return 0;
    return num;
  }, [creditDepositInput]);

  const creditBalanceOwed = useMemo(() => {
    return Math.max(0, parsedCreditAmount - parsedCreditDeposit);
  }, [parsedCreditAmount, parsedCreditDeposit]);

  const currentRate = useMemo(() => {
    return getCurrencyRate(selectedCurrency as string);
  }, [selectedCurrency, multiConfig]);

  const maxCashWithdrawalAllowed = useMemo(() => {
    if (!multiConfig.cashWithdrawalPolicy.enabled) return 0;
    if (multiConfig.cashWithdrawalPolicy.maxWithdrawalRule === 'CUSTOM_PERCENT') {
      return (cartTotal * (multiConfig.cashWithdrawalPolicy.customPercent || 100)) / 100;
    }
    return cartTotal; // default: up to sale amount
  }, [cartTotal, multiConfig]);

  const parsedCashWithdrawal = useMemo(() => {
    const num = parseFloat(cashWithdrawalInput);
    if (isNaN(num) || num < 0) return 0;
    return num;
  }, [cashWithdrawalInput]);

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

  const handleQuickAddProduct = (newProduct: Product) => {
    setProducts((prev) => [newProduct, ...prev.filter((p) => p.id !== newProduct.id)]);
    addToCart(newProduct);
    showToast(`Added "${newProduct.name}" to inventory & cart!`);
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
  const handleOpenCheckoutWithCurrency = (curr: AppCurrency = 'USD', withCashOut: boolean = false) => {
    if (cart.length === 0) return;
    setCashTendered(cartTotal % 1 === 0 ? String(cartTotal) : cartTotal.toFixed(2));
    setCreditDepositInput('0');
    setCreditAmountInput(cartTotal % 1 === 0 ? String(cartTotal) : cartTotal.toFixed(2));
    setChangeLeftBehind(false);
    setActualChangeLeftInput('');
    setCheckoutWarning(null);
    setShowCustomerPickerInCheckout(false);

    setSelectedCurrency(curr);
    if (curr === 'ZiG') {
      setPaymentMethod('ZiG');
    } else if (curr === 'EcoCash') {
      setPaymentMethod('EcoCash');
    } else if (curr === 'USD') {
      setPaymentMethod('Cash');
    } else {
      setPaymentMethod(curr as PaymentMethod);
    }

    setOpenCashWithdrawal(!!withCashOut);
    setCashWithdrawalInput('');
    setProofOfPaymentRef('');
    setShowCheckoutModal(true);
  };

  const handleOpenCheckout = () => {
    handleOpenCheckoutWithCurrency(selectedCurrency, false);
  };

  // Payment method selection with customer registration verification for Credit
  const handleSelectPaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method === 'ZiG') {
      setSelectedCurrency('ZiG');
    } else if (method === 'EcoCash' || method === 'EcoCash/Mobile') {
      setSelectedCurrency('EcoCash');
    } else {
      setSelectedCurrency('USD');
    }

    if (method === 'Credit') {
      if (!creditAmountInput || creditAmountInput === '0') {
        setCreditAmountInput(cartTotal % 1 === 0 ? String(cartTotal) : cartTotal.toFixed(2));
      }
      if (!isRegisteredCustomer) {
        setCheckoutWarning(
          'Customer registration required: Credit sales cannot be issued to Walk-in customers. Please select or register a customer below to fill Form 3 Credit ledger.'
        );
        setShowCustomerPickerInCheckout(true);
      } else {
        setCheckoutWarning(null);
      }
    } else {
      if (checkoutWarning && !changeLeftBehind) {
        setCheckoutWarning(null);
      }
    }
  };

  // Change left behind toggle with customer registration verification
  const handleToggleChangeLeftBehind = (checked: boolean) => {
    if (checked && !isRegisteredCustomer) {
      setCheckoutWarning(
        'Customer registration required: Walk-in or unregistered customers cannot leave change behind. Please select or register a customer below to log change into Form 3.'
      );
      setShowCustomerPickerInCheckout(true);
      setChangeLeftBehind(false);
      return;
    }
    setCheckoutWarning(null);
    setChangeLeftBehind(checked);
    if (checked) {
      setActualChangeLeftInput(
        cashChangeDue % 1 === 0 ? String(cashChangeDue) : cashChangeDue.toFixed(2)
      );
    }
  };

  // Select customer callback from drawer or search modal
  const handleSelectCustomerInCheckout = (customer: Customer) => {
    if (!customer || !customer.customerId) {
      setSelectedCustomerId('');
      setCheckoutWarning(null);
      setShowCustomerPickerInCheckout(false);
      setShowSearchCustomerModal(false);
      showToast('Switched to Walk-in Customer (Unregistered)');
      return;
    }
    setCustomers(getCustomers());
    setSelectedCustomerId(customer.customerId);
    setCheckoutWarning(null);
    setShowCustomerPickerInCheckout(false);
    setShowSearchCustomerModal(false);
    showToast(`Selected customer: ${customer.name}`);
  };

  const handleSelectWalkInCustomer = () => {
    setSelectedCustomerId('');
    setCheckoutWarning(null);
    setShowCustomerPickerInCheckout(false);
    setShowSearchCustomerModal(false);
    showToast('Switched to Walk-in Customer (Unregistered)');
  };

  // Process and finalize checkout
  const handleProcessCheckout = () => {
    if (cart.length === 0) return;

    // Enforce registered customer rule for Change Left Behind
    if (paymentMethod === 'Cash' && changeLeftBehind) {
      if (!isRegisteredCustomer) {
        setCheckoutWarning(
          'Cannot complete checkout: Walk-in customers cannot leave change behind. Please select or register a customer to log into Form 3.'
        );
        setShowCustomerPickerInCheckout(true);
        return;
      }
      if (parsedActualChangeLeft <= 0) {
        setCheckoutWarning(
          'Please specify a valid actual change amount greater than $0.00 left behind, or uncheck the change option.'
        );
        return;
      }
      if (parsedActualChangeLeft > cashChangeDue) {
        setCheckoutWarning(
          `Actual change left ($${parsedActualChangeLeft.toFixed(2)}) cannot exceed total change due ($${cashChangeDue.toFixed(2)}).`
        );
        return;
      }
    }

    // Enforce branch stocktake lockdown (auditing lockdown requires supervisor approval)
    if (isLockedDown && !isSupervisorOrAbove(currentUser?.role) && !lockdownAuthorizedBy) {
      setShowLockdownSupervisorModal(true);
      return;
    }

    // Enforce registered customer rule and Credit Policy Modes (A, B, C)
    if (paymentMethod === 'Credit') {
      if (!isRegisteredCustomer) {
        setCheckoutWarning(
          'Cannot complete checkout: Credit sales require a registered customer account in Form 3. Please select or register a customer.'
        );
        setShowCustomerPickerInCheckout(true);
        return;
      }
      if (parsedCreditAmount <= 0) {
        setCheckoutWarning('Credit amount must be greater than $0.00.');
        return;
      }

      const policy = getCreditPolicy();
      const creditSummary = getCustomerCreditSummary(selectedCustomerId, parsedCreditAmount);
      const isSuper = isSupervisorOrAbove(currentUser?.role);

      if (!isSuper && !creditAuthorizedBy) {
        if (policy.mode === 'STRICT_UPFRONT') {
          setCreditApprovalRequiredReason('Store Policy: Every credit sale requires supervisor authorization PIN.');
          setAllowQueueForReview(false);
          setShowCreditSupervisorModal(true);
          return;
        }

        if (policy.mode === 'CUSTOMER_LIMIT') {
          if (!creditSummary.creditAllowed) {
            setCheckoutWarning(creditSummary.limitExceededReason || 'Credit purchases are disabled for this customer account.');
            return;
          }
          if (!creditSummary.isWithinLimits) {
            setCreditApprovalRequiredReason(creditSummary.limitExceededReason || 'Customer credit limit or maximum receipts exceeded.');
            setAllowQueueForReview(true);
            setShowCreditSupervisorModal(true);
            return;
          }
        }
      }
    }

    // Enforce case reserve threshold protection on wholesale case items (zero quantity leakage)
    for (const item of cart) {
      const reserve = Math.max(0, item.product.caseReserveThreshold || 0);
      if (reserve > 0 && item.product.canSellAsCase) {
        const itemCases = Number(item.product.stockCases) || 0;
        const requestedCases = Number(item.quantity) || 0;
        if (itemCases <= reserve || (itemCases - requestedCases) < reserve) {
          setCheckoutWarning(`Wholesale case sale unavailable for "${item.product.name}". Available for retail singles only.`);
          return;
        }
      }
    }

    // Enforce cash withdrawal limit rule for non-default currencies
    if (selectedCurrency !== 'USD' && parsedCashWithdrawal > 0) {
      if (!multiConfig.cashWithdrawalPolicy.enabled) {
        setCheckoutWarning('Cash withdrawal is disabled by current store policy.');
        return;
      }
      if (parsedCashWithdrawal > maxCashWithdrawalAllowed + 0.001) {
        setCheckoutWarning(
          `Cash withdrawal amount ($${parsedCashWithdrawal.toFixed(2)}) exceeds maximum allowable limit ($${maxCashWithdrawalAllowed.toFixed(2)}) for this transaction.`
        );
        return;
      }
    }

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
      currency: selectedCurrency !== 'USD' ? selectedCurrency : undefined,
      exchangeRate: selectedCurrency !== 'USD' ? currentRate : undefined,
      totalInCurrency: selectedCurrency !== 'USD' ? cartTotal * currentRate : undefined,
      cashWithdrawalAmount:
        selectedCurrency !== 'USD' && parsedCashWithdrawal > 0
          ? parsedCashWithdrawal
          : undefined,
      cashWithdrawalInCurrency:
        selectedCurrency !== 'USD' && parsedCashWithdrawal > 0
          ? parsedCashWithdrawal * currentRate
          : undefined,
      totalChargedInCurrency:
        selectedCurrency !== 'USD'
          ? (cartTotal + parsedCashWithdrawal) * currentRate
          : undefined,
      grossTenderUsd:
        parsedCashWithdrawal > 0
          ? cartTotal + parsedCashWithdrawal
          : cartTotal,
      proofOfPaymentRef: proofOfPaymentRef.trim() || undefined,
      paymentReference: proofOfPaymentRef.trim() || undefined,
      paymentMethod,
      cashTendered:
        paymentMethod === 'Cash'
          ? parsedCashTendered > 0
            ? parsedCashTendered
            : cartTotal
          : undefined,
      changeDue:
        paymentMethod === 'Cash'
          ? parsedCashTendered > 0
            ? Math.max(0, parsedCashTendered - cartTotal)
            : 0
          : undefined,
      changeLeftBehind: paymentMethod === 'Cash' ? changeLeftBehind : undefined,
      changeAmountLeftBehind:
        paymentMethod === 'Cash' && changeLeftBehind
          ? parsedActualChangeLeft
          : undefined,
      creditAmount:
        paymentMethod === 'Credit' ? parsedCreditAmount : undefined,
      creditDueDate: paymentMethod === 'Credit' ? creditDueDate : undefined,
      creditDeposit: paymentMethod === 'Credit' ? parsedCreditDeposit : undefined,
      creditBalanceOwed: paymentMethod === 'Credit' ? creditBalanceOwed : undefined,
      staffId: currentUser?.id || '001',
      staffName: currentUser?.name || 'Cashier',
      branchId: currentUser?.branchId || currentUser?.branch_id || getCurrentBranchId(),
      branch_id: currentUser?.branchId || currentUser?.branch_id || getCurrentBranchId(),
      branchName: currentUser?.branchName || getCurrentBranch().name,
      notes: saleNotes,
      status: 'Completed',
    });

    // Reset checkout state and show receipt modal
    setShowCheckoutModal(false);
    setSelectedCurrency('USD');
    setCashWithdrawalInput('');
    setOpenCashWithdrawal(false);
    setCompletedInvoice(newSale);
    setCart([]);
    setDiscountInput('0');
    setTaxAmount(0);
    setOtherCharges(0);
    setSaleNotes('');
    setLockdownAuthorizedBy(null);
    loadData();
  };

  return (
    <div className="relative">
      {/* Branch Full Stocktake Lockdown Alert Banner */}
      {isLockedDown && (
        <div className="bg-rose-950/95 border-b border-rose-800 text-rose-200 px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-lg z-30">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
            <span>
              <strong className="text-white">STORE UNDER FULL STOCKTAKE LOCKDOWN:</strong> Active audit session in progress. Counter sales require supervisor authorization.
            </span>
          </div>
          {lockdownAuthorizedBy && (
            <span className="text-[11px] font-mono bg-rose-900 border border-rose-700 px-2 py-0.5 rounded text-rose-200 shrink-0">
              Override by: {lockdownAuthorizedBy.name}
            </span>
          )}
        </div>
      )}

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
          onOpenCustomerModal={() => setShowSearchCustomerModal(true)}
          onOpenCurrencySelector={() => setShowCurrencyPickerModal(true)}
          onOpenMoreMenu={() => setCurrentView('more')}
          onOpenReceiptsModal={() => setShowReceiptsModal(true)}
          onLogout={onLogout}
          selectedCurrency={selectedCurrency}
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
          onUpdateQuantity={updateQuantity}
          onRemoveItem={removeItem}
          onGoToCounter={() => setCurrentView('counter')}
          onOpenMoreMenu={() => setCurrentView('more')}
          onOpenCurrencySelector={() => setShowCurrencyPickerModal(true)}
          onOpenCustomerModal={() => setShowSearchCustomerModal(true)}
          onQuickAddProduct={handleQuickAddProduct}
          selectedCurrency={selectedCurrency}
        />
      )}

      {/* Screen 1: Counter / Checkout List */}
      {currentView === 'counter' && (
        <POSCounterView
          cart={cart}
          customers={customers}
          selectedCustomer={activeCustomer}
          currentUser={currentUser}
          products={products}
          onAddToCart={addToCart}
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
          onOpenCurrencySelector={() => setShowCurrencyPickerModal(true)}
          onOpenCustomerModal={() => setShowSearchCustomerModal(true)}
          onQuickAddProduct={handleQuickAddProduct}
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
          onOpenExchangeRates={() => setShowExchangeModal(true)}
          onSelectCurrencyAndCheckout={(curr, withCashOut) => {
            handleOpenCheckoutWithCurrency(curr, withCashOut);
          }}
          selectedCurrency={selectedCurrency}
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
          onOpenExchangeRates={() => setShowExchangeModal(true)}
        />
      )}

      {/* CHECKOUT MODAL */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black">Complete Checkout</h3>
                <div className="flex items-center flex-wrap gap-1.5 text-xs mt-0.5">
                  <span className="text-slate-400">Customer:</span>
                  <span className={`font-bold ${isRegisteredCustomer ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {activeCustomer?.name || 'Walk-in Customer'}
                  </span>
                  {isRegisteredCustomer ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                      Registered (#{activeCustomer?.customerId})
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                      Unregistered / Walk-in
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowCustomerPickerInCheckout((prev) => !prev)}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline ml-1 font-semibold flex items-center space-x-0.5"
                  >
                    <span>{showCustomerPickerInCheckout ? 'Hide' : 'Switch Customer'}</span>
                    {showCustomerPickerInCheckout ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Due</span>
                <span className="text-xl font-black font-mono text-emerald-400">
                  ${cartTotal % 1 === 0 ? cartTotal : cartTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Quick Customer Switcher Dropdown */}
            {showCustomerPickerInCheckout && (
              <div className="p-3.5 bg-slate-950/90 border-b border-slate-800 space-y-2 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">Customer for Sale / Form 3 Ledger</span>
                  <button
                    type="button"
                    onClick={() => setShowSearchCustomerModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white font-bold text-xs flex items-center space-x-1.5 shadow-md hover:opacity-95 transition"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Search &amp; Select Customer</span>
                  </button>
                </div>
              </div>
            )}

            {/* Validation / Guidance Warning Banner */}
            {checkoutWarning && (
              <div className="mx-5 mt-4 p-3.5 bg-amber-500/15 border border-amber-500/40 rounded-2xl flex items-start space-x-2.5 text-xs text-amber-200 animate-fadeIn">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="font-bold text-amber-300 leading-snug">{checkoutWarning}</p>
                  <div className="flex items-center flex-wrap gap-2 pt-0.5">
                    {showCreditSupervisorModal === false && creditApprovalRequiredReason && (
                      <button
                        type="button"
                        onClick={() => setShowCreditSupervisorModal(true)}
                        className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[11px] font-bold flex items-center space-x-1.5 shadow-sm"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Enter Supervisor PIN</span>
                      </button>
                    )}
                    {allowQueueForReview && (
                      <button
                        type="button"
                        onClick={() => {
                          setSaleNotes((prev) => (prev ? `${prev} [PENDING SUPERVISOR REVIEW]` : '[PENDING SUPERVISOR REVIEW]'));
                          setCheckoutWarning(null);
                          setShowCreditSupervisorModal(false);
                          showToast('Credit sale queued for Supervisor Review (Mode B)');
                          setTimeout(() => {
                            handleProcessCheckout();
                          }, 50);
                        }}
                        className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-[11px] font-bold flex items-center space-x-1.5 shadow-sm"
                        title="Process credit sale now and route to supervisor review dashboard"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Queue for Supervisor Review (Mode B)</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowSearchCustomerModal(true)}
                      className="px-3 py-1.5 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-md"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Select / Register Customer</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Payment Methods */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">Payment Method &amp; Currency</label>
                <div className="flex flex-wrap gap-1.5">
                  {/* Base Cash */}
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('Cash');
                      setSelectedCurrency((multiConfig.baseCurrency || 'USD') as AppCurrency);
                    }}
                    className={`flex-1 min-w-[75px] p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'Cash' && selectedCurrency === (multiConfig.baseCurrency || 'USD')
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Banknote className="w-4 h-4 text-emerald-400" />
                    <span className="text-[11px] font-bold">{multiConfig.baseCurrency || 'USD'} Cash</span>
                  </button>

                  {/* Dynamic Active Currencies with rate > 0 */}
                  {getActiveCurrencies().map((curr) => {
                    const isSelected = selectedCurrency === curr.code || selectedCurrency === curr.currency;
                    return (
                      <button
                        key={curr.code}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(curr.code as PaymentMethod);
                          setSelectedCurrency(curr.code as AppCurrency);
                        }}
                        className={`flex-1 min-w-[75px] p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                          isSelected
                            ? 'bg-amber-950/70 border-amber-500 text-amber-300 ring-2 ring-amber-500/30 font-black'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Coins className="w-4 h-4 text-amber-400" />
                        <span className="text-[11px] font-bold">{curr.code}</span>
                      </button>
                    );
                  })}

                  {/* Credit (F3) */}
                  <button
                    type="button"
                    onClick={() => handleSelectPaymentMethod('Credit')}
                    className={`flex-1 min-w-[75px] p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'Credit'
                        ? 'bg-rose-950/70 border-rose-500 text-rose-300 ring-2 ring-rose-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-rose-400" />
                    <span className="text-[11px] font-bold">Credit (F3)</span>
                  </button>

                  {/* Card */}
                  <button
                    type="button"
                    onClick={() => handleSelectPaymentMethod('Card')}
                    className={`flex-1 min-w-[75px] p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center space-y-1 ${
                      paymentMethod === 'Card'
                        ? 'bg-blue-950/70 border-blue-500 text-blue-300 ring-2 ring-blue-500/30 font-black'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Landmark className="w-4 h-4 text-blue-400" />
                    <span className="text-[11px] font-bold">Card</span>
                  </button>
                </div>
              </div>

              {/* Cash Tender & Change Math */}
              {paymentMethod === 'Cash' && selectedCurrency === (multiConfig.baseCurrency || 'USD') && (
                <div className="space-y-3 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Cash Tendered ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashTendered}
                      onChange={(e) => {
                        setCashTendered(e.target.value);
                        if (changeLeftBehind) {
                          const newPaid = parseFloat(e.target.value) || 0;
                          const newChange = Math.max(0, newPaid - cartTotal);
                          setActualChangeLeftInput(newChange % 1 === 0 ? String(newChange) : newChange.toFixed(2));
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 text-lg font-mono-num font-black text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Quick Dollar Presets */}
                  <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
                    {[1, 5, 10, 20, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setCashTendered(String(preset));
                          if (changeLeftBehind) {
                            const newChange = Math.max(0, preset - cartTotal);
                            setActualChangeLeftInput(newChange % 1 === 0 ? String(newChange) : newChange.toFixed(2));
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold shrink-0"
                      >
                        ${preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setCashTendered(String(cartTotal));
                        if (changeLeftBehind) {
                          setActualChangeLeftInput('0');
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold shrink-0"
                    >
                      Exact
                    </button>
                  </div>

                  {/* Change Due Display */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                    <span className="font-bold text-slate-400">Total Change Due on Receipt:</span>
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
                    <div className="space-y-2.5 pt-1">
                      <label className="flex items-center space-x-2 text-xs text-amber-300 cursor-pointer bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/30">
                        <input
                          type="checkbox"
                          checked={changeLeftBehind}
                          onChange={(e) => handleToggleChangeLeftBehind(e.target.checked)}
                          className="rounded text-amber-500 bg-slate-950 border-amber-500 w-4 h-4"
                        />
                        <span className="font-bold">Customer leaves change behind in shop (Form 3 Deposit)</span>
                      </label>

                      {/* Actual Change Left Behind Input & Breakdown */}
                      {changeLeftBehind && (
                        <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-2xl space-y-3 animate-fadeIn">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-bold text-amber-200">
                                Actual Change Left Behind in Counter ($)
                              </label>
                              <span className="text-[10px] text-amber-400 font-mono">
                                Receipt Due: ${cashChangeDue.toFixed(2)}
                              </span>
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={cashChangeDue}
                              value={actualChangeLeftInput}
                              onChange={(e) => setActualChangeLeftInput(e.target.value)}
                              placeholder={cashChangeDue.toFixed(2)}
                              className="w-full bg-slate-900 border border-amber-500/50 rounded-xl py-2 px-3 text-base font-mono-num font-black text-amber-300 focus:outline-none focus:border-amber-400"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">
                              If the customer only leaves partial change (e.g. change due is $10 but you only hand them $5 cash and keep $5 in shop fund), enter the actual amount left here.
                            </p>
                          </div>

                          {/* Quick shortcuts for actual change left */}
                          <div className="flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setActualChangeLeftInput(
                                  cashChangeDue % 1 === 0 ? String(cashChangeDue) : cashChangeDue.toFixed(2)
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-amber-900/60 hover:bg-amber-800 text-amber-200 text-xs font-bold shrink-0 border border-amber-700/50"
                            >
                              Full Change (${cashChangeDue.toFixed(2)})
                            </button>
                            {cashChangeDue > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const half = Math.floor((cashChangeDue / 2) * 100) / 100;
                                  setActualChangeLeftInput(String(half));
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold shrink-0"
                              >
                                Half (${(cashChangeDue / 2).toFixed(2)})
                              </button>
                            )}
                          </div>

                          {/* Real-time Math Summary Box */}
                          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-amber-500/20 space-y-1 text-xs">
                            <div className="flex justify-between text-amber-300 font-bold">
                              <span>Left in Shop Fund (Form 3 Credit):</span>
                              <span className="font-mono-num">${parsedActualChangeLeft.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-emerald-400 font-bold">
                              <span>Physical Cash Handed Out:</span>
                              <span className="font-mono-num">${physicalCashReturned.toFixed(2)}</span>
                            </div>
                            {parsedActualChangeLeft > cashChangeDue && (
                              <p className="text-[11px] text-rose-400 font-bold pt-1 border-t border-rose-500/30">
                                Warning: Actual change left cannot exceed total change due (${cashChangeDue.toFixed(2)}).
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Multi-Currency & Cash Withdrawal Module */}
              {(selectedCurrency !== 'USD' || paymentMethod === 'Card' || paymentMethod === 'EcoCash' || paymentMethod === 'ZiG') && (
                <div className="space-y-3 bg-slate-950/70 p-3.5 rounded-2xl border border-amber-500/30 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <div className="flex items-center space-x-2">
                      <Coins className="w-4 h-4 text-amber-400" />
                      <span className="font-bold text-amber-300 text-sm">
                        {selectedCurrency !== 'USD' ? selectedCurrency : paymentMethod} Electronic Payment
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
                      <span>Rate:</span>
                      <span className="font-mono font-bold text-slate-200">
                        1 USD = {currentRate.toFixed(2)} {selectedCurrency !== 'USD' ? selectedCurrency : 'USD'}
                      </span>
                      {selectedCurrency !== 'USD' && (
                        <button
                          type="button"
                          onClick={() => setShowExchangeModal(true)}
                          className="text-[10px] text-indigo-400 hover:underline font-bold ml-1"
                        >
                          Adjust
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Converted Goods Total */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    <div>
                      <span className="text-slate-400 font-bold block">Goods Total:</span>
                      <span className="text-[11px] text-slate-500 font-mono">${cartTotal.toFixed(2)} USD</span>
                    </div>
                    <span className="font-mono-num font-black text-amber-400 text-base">
                      {(cartTotal * currentRate).toFixed(2)} {selectedCurrency !== 'USD' ? selectedCurrency : 'USD'}
                    </span>
                  </div>

                  {/* Cash Withdrawal (Cash-Out) Section */}
                  {multiConfig.cashWithdrawalPolicy.enabled && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={openCashWithdrawal}
                            onChange={(e) => {
                              setOpenCashWithdrawal(e.target.checked);
                              if (!e.target.checked) setCashWithdrawalInput('');
                            }}
                            className="w-4 h-4 text-emerald-500 rounded border-slate-700 bg-slate-900 focus:ring-emerald-500"
                          />
                          <span className="font-bold text-emerald-300 text-xs flex items-center space-x-1">
                            <span>💵 Customer Cash-Out (USD Cash Payout from Till)</span>
                          </span>
                        </label>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 font-mono border border-emerald-800/60">
                          Limit: ${maxCashWithdrawalAllowed.toFixed(2)} USD
                        </span>
                      </div>

                      {openCashWithdrawal && (
                        <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-xl space-y-2.5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-bold text-emerald-200">
                                Cash Handed to Customer (USD):
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Max allowable: ${maxCashWithdrawalAllowed.toFixed(2)}
                              </span>
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={maxCashWithdrawalAllowed}
                              value={cashWithdrawalInput}
                              onChange={(e) => setCashWithdrawalInput(e.target.value)}
                              placeholder={`0.00 (Max $${maxCashWithdrawalAllowed.toFixed(2)})`}
                              className="w-full bg-slate-900 border border-emerald-500/40 rounded-xl py-2 px-3 text-base font-mono-num font-black text-emerald-300 focus:outline-none focus:border-emerald-400"
                            />
                          </div>

                          {/* Cash-Out Presets */}
                          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
                            {[5, 10, 20].filter((p) => p <= maxCashWithdrawalAllowed).map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setCashWithdrawalInput(String(preset))}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold shrink-0"
                              >
                                ${preset}
                              </button>
                            ))}
                            {maxCashWithdrawalAllowed > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setCashWithdrawalInput(
                                    maxCashWithdrawalAllowed % 1 === 0
                                      ? String(maxCashWithdrawalAllowed)
                                      : maxCashWithdrawalAllowed.toFixed(2)
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold shrink-0"
                              >
                                Max (${maxCashWithdrawalAllowed.toFixed(2)})
                              </button>
                            )}
                          </div>

                          {/* Math breakdown */}
                          <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1 text-[11px]">
                            <div className="flex justify-between text-slate-300">
                              <span>Cash-Out Handed to Customer:</span>
                              <span className="font-mono font-bold text-emerald-400">
                                ${parsedCashWithdrawal.toFixed(2)} USD
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Cash-Out charged in {selectedCurrency}:</span>
                              <span className="font-mono font-bold">
                                {(parsedCashWithdrawal * currentRate).toFixed(2)} {selectedCurrency}
                              </span>
                            </div>
                            <div className="flex justify-between text-white font-bold pt-1 border-t border-slate-800 text-xs">
                              <span>Total Customer Swipes / Pays:</span>
                              <span className="font-mono font-black text-amber-400">
                                {((cartTotal + parsedCashWithdrawal) * currentRate).toFixed(2)} {selectedCurrency}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 pt-1">
                              * Untaxed cash-out payout. Physical USD (${parsedCashWithdrawal.toFixed(2)}) will be automatically deducted from Form 2 cash drawer balance so physical drawer balances.
                            </p>
                          </div>

                          {/* Corporate Governance & Audit Reconciler (Proof of Payment Matcher) */}
                          <div className="p-3 bg-indigo-950/40 border border-indigo-500/40 rounded-xl space-y-2 mt-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black uppercase text-indigo-200 tracking-wider flex items-center gap-1.5">
                                <Receipt className="w-3.5 h-3.5 text-indigo-300" />
                                <span>Corporate Governance &amp; Audit Trail</span>
                              </span>
                              <span className="text-[10px] bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded font-mono font-bold">
                                Slip Matcher
                              </span>
                            </div>
                            <p className="text-[11px] text-indigo-200/90 leading-tight">
                              The physical swipe machine slip or EcoCash confirmation SMS reflects the combined gross total paid:
                            </p>
                            <div className="grid grid-cols-3 gap-1.5 text-center py-1">
                              <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                                <div className="text-[9px] text-slate-400 font-semibold uppercase">Goods Invoice</div>
                                <div className="text-xs font-mono font-bold text-white">${cartTotal.toFixed(2)}</div>
                              </div>
                              <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                                <div className="text-[9px] text-slate-400 font-semibold uppercase">Cash-Out Payout</div>
                                <div className="text-xs font-mono font-bold text-emerald-400">${parsedCashWithdrawal.toFixed(2)}</div>
                              </div>
                              <div className="p-1.5 bg-indigo-900/60 rounded-lg border border-indigo-600/50">
                                <div className="text-[9px] text-indigo-300 font-bold uppercase">Gross Slip / POP</div>
                                <div className="text-xs font-mono font-black text-amber-300">${(cartTotal + parsedCashWithdrawal).toFixed(2)}</div>
                              </div>
                            </div>
                            <div className="pt-1">
                              <label className="text-[11px] font-bold text-indigo-200 block mb-1">
                                Swipe Slip / EcoCash Proof of Payment (POP) Ref #:
                              </label>
                              <input
                                type="text"
                                value={proofOfPaymentRef}
                                onChange={(e) => setProofOfPaymentRef(e.target.value)}
                                placeholder="e.g. EC-782910, Swipe Batch #4102, AuthCode 9214"
                                className="w-full bg-slate-900 border border-indigo-500/50 rounded-xl py-1.5 px-3 text-xs font-mono text-indigo-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400"
                              />
                              <p className="text-[10px] text-indigo-300/70 mt-1">
                                Enter the reference from the swipe terminal slip or EcoCash text to audit against ${(cartTotal + parsedCashWithdrawal).toFixed(2)} USD ({((cartTotal + parsedCashWithdrawal) * currentRate).toFixed(2)} {selectedCurrency}).
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Even without cash withdrawal, allow entering Swipe / POP Reference */}
                  {!openCashWithdrawal && (
                    <div className="pt-2 border-t border-slate-800">
                      <label className="text-[11px] font-bold text-slate-300 block mb-1">
                        Electronic Proof of Payment (POP) / Swipe Reference (Optional):
                      </label>
                      <input
                        type="text"
                        value={proofOfPaymentRef}
                        onChange={(e) => setProofOfPaymentRef(e.target.value)}
                        placeholder="e.g. EcoCash Ref #, POS Terminal Approval Code"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-1.5 px-3 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Credit Sale Form 3 Fields */}
              {paymentMethod === 'Credit' && (
                <div className="space-y-3 bg-rose-950/30 p-3.5 rounded-2xl border border-rose-800/40 text-xs">
                  <div className="text-rose-300 font-bold flex items-center space-x-1.5">
                    <CreditCard className="w-4 h-4" />
                    <span>Auto-fills Form 3 (Credit Sales) & Customer Debt Ledger</span>
                  </div>

                  {/* Customer Registration Notice for Credit */}
                  {!isRegisteredCustomer && (
                    <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl space-y-2">
                      <p className="font-bold text-rose-200 text-xs">
                        Credit sales require a registered customer account so the balance is tracked in Form 3.
                      </p>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setShowSearchCustomerModal(true)}
                          className="px-3 py-1.5 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-md"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Select / Register Customer</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Credit Amount Input with invoice total as default */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-300 font-bold">
                        Credit Amount ($) <span className="text-slate-400 font-normal">(Invoice total default)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setCreditAmountInput(
                            cartTotal % 1 === 0 ? String(cartTotal) : cartTotal.toFixed(2)
                          )
                        }
                        className="text-[10px] text-rose-400 hover:underline font-bold"
                      >
                        Invoice Total (${cartTotal.toFixed(2)})
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={creditAmountInput}
                      onChange={(e) => setCreditAmountInput(e.target.value)}
                      placeholder={cartTotal.toFixed(2)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 font-mono-num font-bold text-white focus:outline-none focus:border-rose-500"
                    />
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

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-bold">
                    <span className="text-slate-400">Balance Added to Form 3 Credit Ledger:</span>
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
                  disabled={
                    (paymentMethod === 'Credit' && !isRegisteredCustomer) ||
                    (paymentMethod === 'Cash' && changeLeftBehind && !isRegisteredCustomer)
                  }
                  className={`flex-1 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center justify-center space-x-1.5 transition active:scale-95 ${
                    (paymentMethod === 'Credit' && !isRegisteredCustomer) ||
                    (paymentMethod === 'Cash' && changeLeftBehind && !isRegisteredCustomer)
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : 'bg-[#4CAF50] hover:bg-[#43A047] active:bg-[#388E3C] text-white'
                  }`}
                  title={
                    (paymentMethod === 'Credit' && !isRegisteredCustomer) ||
                    (paymentMethod === 'Cash' && changeLeftBehind && !isRegisteredCustomer)
                      ? 'Please register or select a customer first'
                      : 'Complete sale and print receipt'
                  }
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {(paymentMethod === 'Credit' && !isRegisteredCustomer) ||
                    (paymentMethod === 'Cash' && changeLeftBehind && !isRegisteredCustomer)
                      ? 'Customer Registration Required'
                      : 'Complete & Print'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Search & Select Modal */}
      {showSearchCustomerModal && (
        <CustomerSearchModal
          isOpen={showSearchCustomerModal}
          onClose={() => setShowSearchCustomerModal(false)}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={handleSelectCustomerInCheckout}
          onSelectWalkIn={handleSelectWalkInCustomer}
          currentUser={currentUser || { id: '001', name: 'Cashier', role: 'Cashier', pin: '0000', active: 'Y' }}
        />
      )}

      {/* Currency Selection & Rates Modal */}
      {showCurrencyPickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl text-white">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] p-4 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <Coins className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black">Select Transaction Currency</h3>
                  <p className="text-xs text-white/80">Active operational rates in store</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCurrencyPickerModal(false)}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Currency list */}
            <div className="p-4 space-y-2.5 max-h-[60vh] overflow-y-auto">
              {/* Base Currency Option */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCurrency((multiConfig.baseCurrency || 'USD') as AppCurrency);
                  setShowCurrencyPickerModal(false);
                  showToast(`Switched currency to Base: ${multiConfig.baseCurrency || 'USD'}`);
                }}
                className={`w-full p-3 rounded-2xl border text-left transition flex items-center justify-between ${
                  selectedCurrency === (multiConfig.baseCurrency || 'USD')
                    ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/30'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 font-black text-sm flex items-center justify-center">
                    {multiConfig.baseCurrency || 'USD'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>{multiConfig.baseCurrency || 'USD'} (Base Currency)</span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-bold">
                        1.00
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono">
                      Cart Total: {multiConfig.baseCurrency || 'USD'} ${cartTotal.toFixed(2)}
                    </div>
                  </div>
                </div>
                {selectedCurrency === (multiConfig.baseCurrency || 'USD') && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
              </button>

              {/* All Active Foreign Currencies (rate > 0) */}
              {getActiveCurrencies().map((curr) => {
                const rate = Number(curr.rateToBase || curr.rateToUsd || 1);
                const convertedTotal = (cartTotal * rate).toFixed(2);
                const isSelected = selectedCurrency === curr.code || selectedCurrency === curr.currency;

                return (
                  <button
                    key={curr.code}
                    type="button"
                    onClick={() => {
                      setSelectedCurrency(curr.code as AppCurrency);
                      setShowCurrencyPickerModal(false);
                      showToast(`Switched currency to ${curr.code} (Rate: ${rate.toFixed(2)})`);
                    }}
                    className={`w-full p-3 rounded-2xl border text-left transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 font-black text-xs flex items-center justify-center">
                        {curr.symbol || curr.code}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white flex items-center space-x-2">
                          <span>{curr.name}</span>
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold font-mono">
                            1 {multiConfig.baseCurrency || 'USD'} = {rate.toFixed(2)} {curr.code}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          Cart Total: {curr.symbol} {convertedTotal}
                        </div>
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 className="w-5 h-5 text-amber-400" />}
                  </button>
                );
              })}

              {getActiveCurrencies().length === 0 && (
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-center text-xs text-slate-400">
                  No secondary currencies currently have active rates. Configure rates below to enable additional currencies for your region.
                </div>
              )}
            </div>

            {/* Footer with Manage Rates trigger */}
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCurrencyPickerModal(false);
                  setShowExchangeModal(true);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
              >
                <Settings className="w-3.5 h-3.5 text-purple-400" />
                <span>Configure Rates &amp; Base Currency</span>
              </button>
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

      {/* Credit Sale Supervisor Authorization Modal (Mode A & Mode C limit exceeded) */}
      {showCreditSupervisorModal && (
        <ManagerPinModal
          isOpen={showCreditSupervisorModal}
          onClose={() => setShowCreditSupervisorModal(false)}
          title="Supervisor Credit Authorization"
          subtitle={creditApprovalRequiredReason}
          actionType="DISCOUNT"
          actionDescription={`Credit Sale of $${parsedCreditAmount.toFixed(2)} to ${activeCustomer?.name || 'Customer'}`}
          amount={parsedCreditAmount}
          reasonRequired={false}
          defaultReasons={[
            'Customer Credit Limit Exception',
            'Multiple Receipts Overdue Exception',
            'Offline Supervisor Discretionary Credit',
            'VIP Regular Account Approval',
          ]}
          currentStaff={currentUser}
          onAuthorize={(supervisor) => {
            setCreditAuthorizedBy(supervisor);
            setShowCreditSupervisorModal(false);
            showToast(`Credit Sale Authorized by ${supervisor.name} (${supervisor.role})`);
            setCheckoutWarning(null);
          }}
        />
      )}

      {/* Stocktake Full Lockdown Sales Override Modal */}
      {showLockdownSupervisorModal && (
        <ManagerPinModal
          isOpen={showLockdownSupervisorModal}
          onClose={() => setShowLockdownSupervisorModal(false)}
          title="Stocktake Lockdown Authorization"
          subtitle="This branch is currently under Full Stocktake Lockdown. Sales require supervisor override."
          actionType="DISCOUNT"
          actionDescription={`Emergency Sale during Lockdown Audit ($${cartTotal.toFixed(2)})`}
          amount={cartTotal}
          reasonRequired={true}
          defaultReasons={[
            'Perishable/Urgent Goods Exemption',
            'Customer Line Pre-Count Verified',
            'Owner / Auditor Explicit Clearance',
            'Emergency Essential Supplies',
          ]}
          currentStaff={currentUser}
          onAuthorize={(supervisor) => {
            setLockdownAuthorizedBy(supervisor);
            setShowLockdownSupervisorModal(false);
            showToast(`Lockdown Sale Authorized by ${supervisor.name}`);
            setCheckoutWarning(null);
          }}
        />
      )}

      {/* RECEIPTS MODAL (Inside Cash Register) */}
      {showReceiptsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-2xl p-3 sm:p-4">
            <POSOrdersHistory
              currentUser={currentUser}
              onNavigate={(tab, customer) => {
                setShowReceiptsModal(false);
                onNavigate(tab, customer);
              }}
              isModal={true}
              onCloseModal={() => setShowReceiptsModal(false)}
            />
          </div>
        </div>
      )}

      {/* MULTI-CURRENCY & CASH-OUT RATES MODAL */}
      <ExchangeRatesModal
        isOpen={showExchangeModal}
        onClose={() => {
          setShowExchangeModal(false);
          setMultiConfig(getMultiCurrencyConfig());
        }}
        currentUser={currentUser}
      />
    </div>
  );
};
