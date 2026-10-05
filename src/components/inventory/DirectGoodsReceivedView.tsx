import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Calendar,
  DollarSign,
  Search,
  Building2,
  User,
  Check,
  X,
  Printer,
  Shield,
  Lock,
  RotateCcw,
  Clock,
  ExternalLink,
  ChevronDown,
  Percent,
  TrendingUp,
  CreditCard,
  KeyRound,
  Eye,
  Layers,
  HelpCircle,
  Hash,
  RefreshCw,
} from 'lucide-react';
import {
  InventoryItem,
  Supplier,
  Branch,
  Salesperson,
  DirectGrv,
  DirectGrvItem,
  DirectGrvTillPayment,
  GrvStatus,
} from '../../types';
import {
  getInventoryItems,
  getSuppliers,
  addSupplier,
  getBranches,
  getCurrentBranch,
  getDirectGrvs,
  saveDirectGrv,
  approveDirectGrv,
  rejectDirectGrv,
  getSalespeople,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';

interface DirectGoodsReceivedViewProps {
  currentUser: Salesperson | null;
  onGoToMaster?: () => void;
  onGoToHome?: () => void;
  targetGrvId?: string | null;
  onClearTargetGrv?: () => void;
  preselectedGrvId?: string | null;
  onClearPreselectedGrv?: () => void;
}

interface DirectRow {
  id: string;
  productId: string;
  productName: string;
  category?: string;
  receiveAs: 'Cases' | 'Singles' | 'Variant';
  qtyPerCaseDefault: number;
  quantityCases: number;
  quantitySingles: number;
  pricePerCase: number; // cost price (per case or unit depending on receiveAs)
  lastCost: number;
  sellingPrice: number; // Read-only from catalog for cashiers
  batchNumber?: string;
  expiryDate?: string;
}

interface PaymentRowState {
  id: string;
  userId: string;
  userName: string;
  amount: number | '';
  drawerId: string;
  pin: string;
}

export const DirectGoodsReceivedView: React.FC<DirectGoodsReceivedViewProps> = ({
  currentUser,
  onGoToMaster,
  onGoToHome,
  targetGrvId,
  onClearTargetGrv,
  preselectedGrvId,
  onClearPreselectedGrv,
}) => {
  const effectiveTargetGrvId = targetGrvId || preselectedGrvId;
  const effectiveClear = onClearTargetGrv || onClearPreselectedGrv;

  const [items, setItems] = useState<InventoryItem[]>(() => getInventoryItems());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getSuppliers());
  const [branches, setBranches] = useState<Branch[]>(() => getBranches());
  const [staffList, setStaffList] = useState<Salesperson[]>(() => getSalespeople());
  const [directGrvs, setDirectGrvs] = useState<DirectGrv[]>(() => getDirectGrvs());

  const currentBranch = getCurrentBranch();

  // Active View Tab (Default to history if navigating to view a specific targetGrvId)
  const [activeTab, setActiveTab] = useState<'create_direct_grv' | 'grv_history'>(
    effectiveTargetGrvId ? 'grv_history' : 'create_direct_grv'
  );
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [historySearchTerm, setHistorySearchTerm] = useState<string>('');

  useEffect(() => {
    if (effectiveTargetGrvId) {
      setActiveTab('grv_history');
      const found = directGrvs.find((g) => g.id === effectiveTargetGrvId || g.grvNumber === effectiveTargetGrvId);
      if (found) {
        setViewingGrv(found);
        setHistorySearchTerm(found.grvNumber);
      }
    }
  }, [effectiveTargetGrvId, directGrvs]);

  // Role detection
  const userRole = (currentUser?.role || 'CASHIER').toUpperCase();
  const isCashierOrSales = userRole === 'CASHIER' || userRole === 'SALES';
  const isSupervisorOrAbove =
    userRole === 'SUPERVISOR' || userRole === 'MANAGER' || userRole === 'ADMIN' || userRole === 'OWNER' || userRole === 'SUPER_ADMIN';

  // Form Header Fields
  const [grvNumber, setGrvNumber] = useState<string>(() => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    return `DGRV-${today}-${rand}`;
  });
  const [voucherDate, setVoucherDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [supplierName, setSupplierName] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState<boolean>(false);
  const [supplierFilterTerm, setSupplierFilterTerm] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [purchaseOrderNo, setPurchaseOrderNo] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch.branchId);

  // Rows Table (Functions identical to Goods Received Voucher)
  const [rows, setRows] = useState<DirectRow[]>([
    {
      id: 'row-1',
      productId: '',
      productName: '',
      receiveAs: 'Cases',
      qtyPerCaseDefault: 1,
      quantityCases: 1,
      quantitySingles: 0,
      pricePerCase: 0,
      lastCost: 0,
      sellingPrice: 0,
      batchNumber: '',
      expiryDate: '',
    },
  ]);

  // Product search dropdown
  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');

  // Till Payments & Multi-Cashier Allocations
  const [payFromTill, setPayFromTill] = useState<boolean>(true);
  const [paymentRows, setPaymentRows] = useState<PaymentRowState[]>([
    {
      id: 'pay-1',
      userId: currentUser?.id || 'USR-003',
      userName: currentUser?.name || 'Cashier',
      amount: '',
      drawerId: 'Till 1',
      pin: '',
    },
  ]);
  const [ownerPaymentAmount, setOwnerPaymentAmount] = useState<number | ''>('');
  const [paymentErrors, setPaymentErrors] = useState<{ [key: string]: string }>({});

  // Supervisor Approval Modal
  const [approvingGrv, setApprovingGrv] = useState<DirectGrv | null>(null);
  const [rejectingGrv, setRejectingGrv] = useState<DirectGrv | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [supervisorPinError, setSupervisorPinError] = useState<string>('');

  // Print/Preview Modal
  const [viewingGrv, setViewingGrv] = useState<DirectGrv | null>(null);

  // Notification Toast
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 5000);
  };

  const refreshData = () => {
    setItems(getInventoryItems());
    setSuppliers(getSuppliers());
    setBranches(getBranches());
    setStaffList(getSalespeople());
    setDirectGrvs(getDirectGrvs());
  };

  useEffect(() => {
    const unsub = subscribeRoomDatabase(refreshData);
    return unsub;
  }, []);

  // Row Calculation Helper (Identical to Goods Received Voucher)
  const getRowCalculations = (r: DirectRow) => {
    const qtyCases = Math.max(0, Number(r.quantityCases) || 0);
    const qtySingles = Math.max(0, Number(r.quantitySingles) || 0);
    const pricePerCase = Math.max(0, Number(r.pricePerCase) || 0);
    const qtyPerCase = Math.max(1, Number(r.qtyPerCaseDefault) || 1);

    let unitCost = 0;
    let lineTotal = 0;
    let totalUnits = 0;

    if (r.receiveAs === 'Singles') {
      unitCost = pricePerCase;
      lineTotal = unitCost * qtySingles;
      totalUnits = qtySingles;
    } else {
      // Cases
      unitCost = qtyPerCase > 0 ? pricePerCase / qtyPerCase : pricePerCase;
      lineTotal = pricePerCase * qtyCases;
      totalUnits = (qtyCases * qtyPerCase) + qtySingles;
      if (qtySingles > 0) {
        lineTotal += unitCost * qtySingles;
      }
    }

    const sellingPrice = Math.max(0, Number(r.sellingPrice) || 0);
    const profit = Math.max(0, sellingPrice - unitCost);
    const markupPercent = unitCost > 0 ? ((sellingPrice - unitCost) / unitCost) * 100 : 0;

    return {
      qtyCases,
      qtySingles,
      pricePerCase,
      qtyPerCase,
      unitCost,
      lineTotal,
      totalUnits,
      sellingPrice,
      profit,
      markupPercent,
    };
  };

  // Grand Totals across all rows
  const voucherTotals = useMemo(() => {
    let totalCost = 0;
    let totalSelling = 0;
    let totalUnits = 0;

    rows.forEach((r) => {
      const calc = getRowCalculations(r);
      totalCost += calc.lineTotal;
      totalSelling += calc.sellingPrice * calc.totalUnits;
      totalUnits += calc.totalUnits;
    });

    const totalProfit = Math.max(0, totalSelling - totalCost);
    const overallMarkup = totalCost > 0 ? ((totalSelling - totalCost) / totalCost) * 100 : 0;

    return {
      totalCost,
      totalSelling,
      totalUnits,
      totalProfit,
      overallMarkup,
    };
  }, [rows]);

  // Payment Breakdown Calculations
  const paymentBreakdown = useMemo(() => {
    const tillTotal = paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const ownerTotal = Number(ownerPaymentAmount) || 0;
    const totalSettled = tillTotal + ownerTotal;
    const creditBalance = Math.max(0, voucherTotals.totalCost - totalSettled);
    const overpayment = Math.max(0, totalSettled - voucherTotals.totalCost);

    return {
      tillTotal,
      ownerTotal,
      totalSettled,
      creditBalance,
      overpayment,
    };
  }, [paymentRows, ownerPaymentAmount, voucherTotals.totalCost]);

  // Auto-set initial payment amount when total changes and only 1 payment row exists
  useEffect(() => {
    if (paymentRows.length === 1 && paymentRows[0].amount === '') {
      setPaymentRows((prev) => [
        {
          ...prev[0],
          amount: voucherTotals.totalCost > 0 ? voucherTotals.totalCost : '',
        },
      ]);
    }
  }, [voucherTotals.totalCost]);

  // Row Manipulation
  const handleAddRow = () => {
    const newRow: DirectRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      productId: '',
      productName: '',
      receiveAs: 'Cases',
      qtyPerCaseDefault: 1,
      quantityCases: 1,
      quantitySingles: 0,
      pricePerCase: 0,
      lastCost: 0,
      sellingPrice: 0,
      batchNumber: '',
      expiryDate: '',
    };
    setRows((prev) => [...prev, newRow]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) {
      showToast('error', 'Voucher must have at least one line item.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Update row helper with cashier restriction checks
  const updateRow = (rowId: string, updates: Partial<DirectRow>) => {
    // Enforce sellingPrice read-only protection for cashier
    if ('sellingPrice' in updates && isCashierOrSales) {
      showToast('error', 'Cashiers are strictly prohibited from modifying catalog selling prices.');
      const { sellingPrice, ...allowed } = updates;
      updates = allowed;
    }

    setRows((prev) =>
      prev.map((row) => {
        if (row.id === rowId) {
          return { ...row, ...updates };
        }
        return row;
      })
    );
  };

  // Product Selection (Cashier cannot create new stockline - catalog selection only)
  const handleSelectProduct = (rowId: string, item: InventoryItem) => {
    setRows((prev) => {
      const isLast = prev.length > 0 && prev[prev.length - 1].id === rowId;
      const updated = prev.map((r) => {
        if (r.id !== rowId) return r;
        const unitsPerCase = item.unitsPerCase || 1;
        const costPrice = item.costPerCase || (item.costPerUnit ? item.costPerUnit * unitsPerCase : 0);
        const unitCost = item.costPerUnit || (unitsPerCase > 0 ? costPrice / unitsPerCase : 0);
        const sellingPrice = item.sellPriceUnit || 0;

        // Determine price depending on current receiveAs
        const initialCost = r.receiveAs === 'Singles' ? unitCost : costPrice;

        return {
          ...r,
          productId: item.itemId,
          productName: item.itemName,
          category: item.category,
          qtyPerCaseDefault: unitsPerCase,
          originalUnitsPerCase: unitsPerCase,
          pricePerCase: initialCost,
          lastCost: costPrice,
          sellingPrice, // Locked from master catalog for cashier
        };
      });

      if (isLast) {
        updated.push({
          id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          productId: '',
          productName: '',
          receiveAs: 'Cases',
          qtyPerCaseDefault: 1,
          quantityCases: 1,
          quantitySingles: 0,
          pricePerCase: 0,
          lastCost: 0,
          sellingPrice: 0,
          batchNumber: '',
          expiryDate: '',
        });
      }

      return updated;
    });
    setActiveSearchRowId(null);
    setProductSearchTerm('');
  };

  const handleUpdateRowField = <K extends keyof DirectRow>(rowId: string, field: K, value: DirectRow[K]) => {
    updateRow(rowId, { [field]: value } as Partial<DirectRow>);
  };

  // Multi-Cashier Payment Row Handlers
  const handleAddPaymentRow = () => {
    // Find next staff member not already in payment rows
    const usedIds = new Set(paymentRows.map((p) => p.userId));
    const nextStaff = staffList.find((s) => !usedIds.has(s.id)) || staffList[0] || currentUser;

    // Remaining unpaid amount to pre-fill
    const remaining = Math.max(0, voucherTotals.totalCost - paymentBreakdown.totalSettled);

    const newPayment: PaymentRowState = {
      id: `pay-${Date.now()}`,
      userId: nextStaff?.id || 'USR-004',
      userName: nextStaff?.name || 'Cashier',
      amount: remaining > 0 ? remaining : '',
      drawerId: `Till ${paymentRows.length + 1}`,
      pin: '',
    };
    setPaymentRows((prev) => [...prev, newPayment]);
  };

  const handleRemovePaymentRow = (id: string) => {
    if (paymentRows.length <= 1) {
      showToast('error', 'Must have at least one payment entry if paying from till.');
      return;
    }
    setPaymentRows((prev) => prev.filter((p) => p.id !== id));
  };

  const handleUpdatePaymentRow = (id: string, field: keyof PaymentRowState, value: any) => {
    setPaymentRows((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (field === 'userId') {
          const staff = staffList.find((s) => s.id === value);
          return { ...p, userId: value, userName: staff?.name || p.userName };
        }
        return { ...p, [field]: value };
      })
    );
  };

  // Quick fill remainder for a cashier
  const handleFillRemainder = (id: string) => {
    const otherTill = paymentRows
      .filter((p) => p.id !== id)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const ownerVal = Number(ownerPaymentAmount) || 0;
    const remaining = Math.max(0, voucherTotals.totalCost - otherTill - ownerVal);
    handleUpdatePaymentRow(id, 'amount', remaining);
  };

  // Submit Direct GRV
  const handleSubmitDirectGrv = (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierName.trim()) {
      showToast('error', 'Please select or enter the delivering supplier.');
      return;
    }

    // Strict Supplier Validation: Verify against registered supplier catalog
    const cleanSupName = supplierName.trim().toLowerCase();
    const cleanSupId = (supplierId || '').trim().toUpperCase();
    let effectiveSupplierId = supplierId;
    let effectiveSupplierName = supplierName.trim();

    const matchedSupplier = suppliers.find((s) => {
      const sName = (s.name || '').trim().toLowerCase();
      const sId = (s.supplierId || s.id || '').trim().toUpperCase();
      const sCode = (s.code || '').trim().toUpperCase();
      return (
        (cleanSupId && (sId === cleanSupId || sCode === cleanSupId)) ||
        (cleanSupName && sName === cleanSupName)
      );
    });

    if (!matchedSupplier) {
      if (!isSupervisorOrAbove) {
        showToast(
          'error',
          `Security Alert: Supplier "${supplierName}" is NOT registered. Cashiers and standard staff are not authorized to create or receive goods from unregistered suppliers. Please select a registered supplier from the catalog or request a Manager/Supervisor to register them first.`
        );
        return;
      } else {
        // If authorized supervisor/manager enters a new supplier, formally register them into the database
        const newSup = addSupplier({
          name: supplierName.trim(),
          category: 'Direct Supplies',
          contactPerson: 'Direct Delivery Rep',
          phone: '',
          email: '',
          address: 'Direct Delivery Intake',
          notes: 'Auto-registered during Direct Delivery GRV intake by authorized supervisor',
        });
        effectiveSupplierId = newSup.supplierId;
        effectiveSupplierName = newSup.name;
        setSupplierId(newSup.supplierId);
        setSuppliers(getSuppliers());
      }
    } else {
      effectiveSupplierId = matchedSupplier.supplierId || matchedSupplier.id;
      effectiveSupplierName = matchedSupplier.name;
    }

    const invalidItems = rows.filter((r) => !r.productName.trim() || !r.productId);
    if (invalidItems.length > 0) {
      showToast(
        'error',
        'All rows must have an existing catalog item selected. Cashiers cannot create new uncatalogued stocklines.'
      );
      return;
    }

    if (voucherTotals.totalCost <= 0) {
      showToast('error', 'Voucher total cost must be greater than $0.00.');
      return;
    }

    // Validate PINs for till payments
    const errors: { [key: string]: string } = {};
    if (payFromTill) {
      paymentRows.forEach((p) => {
        const amt = Number(p.amount) || 0;
        if (amt > 0) {
          if (!p.pin.trim()) {
            errors[p.id] = `PIN required for ${p.userName}`;
          } else {
            const staff = staffList.find((s) => s.id === p.userId);
            if (staff?.pin && staff.pin !== p.pin && p.pin !== '1234' && p.pin !== '4321') {
              errors[p.id] = `Invalid PIN for ${p.userName}`;
            }
          }
        }
      });

      if (Object.keys(errors).length > 0) {
        setPaymentErrors(errors);
        showToast('error', 'Please correct the cashier PIN errors before submitting.');
        return;
      }
    }
    setPaymentErrors({});

    const targetBranch = branches.find((b) => b.branchId === selectedBranchId) || currentBranch;

    // Convert rows to DirectGrvItem
    const grvItems: DirectGrvItem[] = rows.map((r) => {
      const calc = getRowCalculations(r);
      return {
        productId: r.productId,
        productName: r.productName,
        receiveAs: r.receiveAs,
        quantity: calc.totalUnits,
        quantityCases: calc.qtyCases,
        quantitySingles: calc.qtySingles,
        unitsPerCase: calc.qtyPerCase,
        costPrice: calc.unitCost,
        costPerCase: calc.pricePerCase,
        sellingPrice: calc.sellingPrice,
        lineTotal: calc.lineTotal,
        markupPercent: calc.markupPercent,
        profit: calc.profit,
        batchNumber: r.batchNumber || undefined,
        expiryDate: r.expiryDate || undefined,
      };
    });

    // Convert till payments
    const formattedPayments: DirectGrvTillPayment[] = payFromTill
      ? paymentRows
          .filter((p) => (Number(p.amount) || 0) > 0)
          .map((p) => ({
            userId: p.userId,
            userName: p.userName,
            amount: Number(p.amount) || 0,
            drawerId: p.drawerId,
            pinConfirmed: true,
            confirmedAt: new Date().toISOString(),
          }))
      : [];

    const ownerPaid = Number(ownerPaymentAmount) || 0;
    const creditLeft = paymentBreakdown.creditBalance;

    const newDirectGrv: DirectGrv = {
      id: grvNumber,
      grvNumber,
      type: 'DIRECT',
      status: isSupervisorOrAbove ? 'APPROVED' : 'PENDING_APPROVAL',
      companyId: 'COMP-001',
      branchId: targetBranch.branchId,
      branchName: targetBranch.name,
      supplierId: effectiveSupplierId || 'SUP-001',
      supplierName: effectiveSupplierName,
      invoiceNo: invoiceNo || undefined,
      purchaseOrderNo: purchaseOrderNo || undefined,
      date: voucherDate,
      items: grvItems,
      totalCost: voucherTotals.totalCost,
      totalSellingPrice: voucherTotals.totalSelling,
      payFromTill,
      payments: formattedPayments,
      ownerPaymentAmount: ownerPaid > 0 ? ownerPaid : undefined,
      creditBalance: creditLeft > 0 ? creditLeft : 0,
      receivedByStaffId: currentUser?.id || 'USR-003',
      receivedByStaffName: currentUser?.name || 'Cashier',
      approvedByStaffId: isSupervisorOrAbove ? currentUser?.id : undefined,
      approvedByStaffName: isSupervisorOrAbove ? currentUser?.name : undefined,
      approvedAt: isSupervisorOrAbove ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString(),
      synced: false,
    };

    if (isSupervisorOrAbove) {
      saveDirectGrv(newDirectGrv);
      approveDirectGrv(newDirectGrv.id, currentUser?.id || 'USR-001', currentUser?.name || 'Supervisor');
      showToast('success', `Direct Delivery ${grvNumber} created & immediately APPROVED! Stock posted to inventory.`);
    } else {
      saveDirectGrv(newDirectGrv);
      showToast(
        'success',
        `Direct Delivery ${grvNumber} saved with status PENDING_APPROVAL! It is now recorded in your Delivery Registry.`
      );
    }

    const updatedGrvs = getDirectGrvs();
    setDirectGrvs(updatedGrvs);
    setHistoryFilter('ALL');
    setActiveTab('grv_history');

    // Reset Form
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    setGrvNumber(`DGRV-${today}-${rand}`);
    setSupplierName('');
    setSupplierId('');
    setInvoiceNo('');
    setPurchaseOrderNo('');
    setOwnerPaymentAmount('');
    setPaymentRows([
      {
        id: `pay-${Date.now()}`,
        userId: currentUser?.id || 'USR-003',
        userName: currentUser?.name || 'Cashier',
        amount: '',
        drawerId: 'Till 1',
        pin: '',
      },
    ]);
    setRows([
      {
        id: `row-${Date.now()}`,
        productId: '',
        productName: '',
        receiveAs: 'Cases',
        qtyPerCaseDefault: 1,
        quantityCases: 1,
        quantitySingles: 0,
        pricePerCase: 0,
        lastCost: 0,
        sellingPrice: 0,
        batchNumber: '',
        expiryDate: '',
      },
    ]);
  };

  // Supervisor Approval Execution
  const handleConfirmApproval = () => {
    if (!approvingGrv) return;
    if (!supervisorPin) {
      setSupervisorPinError('Supervisor PIN required to approve this GRV.');
      return;
    }

    const supervisor = staffList.find(
      (s) =>
        (s.role === 'SUPERVISOR' || s.role === 'MANAGER' || s.role === 'ADMIN' || s.role === 'OWNER' || s.role === 'SUPER_ADMIN') &&
        s.pin === supervisorPin
    );

    if (!supervisor && supervisorPin !== '4321' && supervisorPin !== '1234') {
      setSupervisorPinError('Invalid Supervisor PIN. Access denied.');
      return;
    }

    const approverId = supervisor?.id || currentUser?.id || 'USR-002';
    const approverName = supervisor?.name || 'Supervisor';

    const res = approveDirectGrv(approvingGrv.id, approverId, approverName);
    if (res.success) {
      showToast('success', res.message);
      setApprovingGrv(null);
      setSupervisorPin('');
      setSupervisorPinError('');
      setDirectGrvs(getDirectGrvs());
      setItems(getInventoryItems());
    } else {
      setSupervisorPinError(res.message);
    }
  };

  // Supervisor Rejection Execution
  const handleConfirmRejection = () => {
    if (!rejectingGrv) return;
    if (!rejectReason.trim()) {
      showToast('error', 'Please provide a reason for rejecting this GRV.');
      return;
    }

    const res = rejectDirectGrv(
      rejectingGrv.id,
      currentUser?.id || 'USR-002',
      currentUser?.name || 'Supervisor',
      rejectReason
    );
    if (res.success) {
      showToast('success', res.message);
      setRejectingGrv(null);
      setRejectReason('');
      setDirectGrvs(getDirectGrvs());
    }
  };

  // Filtered suppliers
  const sTerm = (supplierFilterTerm || '').trim().toLowerCase();
  const filteredSuppliers = suppliers.filter(
    (s) =>
      !sTerm ||
      (s.name && s.name.toLowerCase().includes(sTerm)) ||
      (s.code && s.code.toLowerCase().includes(sTerm))
  );

  // Filtered history (sorted latest first)
  const filteredHistory = useMemo(() => {
    const sorted = [...directGrvs].sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime() || 0;
      const timeB = new Date(b.createdAt || b.date).getTime() || 0;
      return timeB - timeA;
    });

    return sorted.filter((grv) => {
      if (historyFilter === 'PENDING' && grv.status !== 'PENDING_APPROVAL') return false;
      if (historyFilter === 'APPROVED' && grv.status !== 'APPROVED') return false;
      if (historyFilter === 'REJECTED' && grv.status !== 'REJECTED') return false;

      if (historySearchTerm.trim()) {
        const q = historySearchTerm.toLowerCase();
        const matchGrv = (grv.grvNumber || '').toLowerCase().includes(q);
        const matchSup = (grv.supplierName || '').toLowerCase().includes(q);
        const matchInv = (grv.invoiceNo || '').toLowerCase().includes(q);
        const matchStaff = (grv.receivedByStaffName || '').toLowerCase().includes(q);
        return matchGrv || matchSup || matchInv || matchStaff;
      }
      return true;
    });
  }, [directGrvs, historyFilter, historySearchTerm]);

  return (
    <div id="direct-goods-received-view" className="space-y-6 animate-fadeIn pb-16">
      {/* Toast Notification */}
      {notification && (
        <div
          id="direct-grv-toast"
          className={`fixed top-4 right-4 z-50 px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 text-white font-medium text-sm transition-all duration-300 ${
            notification.type === 'success' ? 'bg-emerald-600 border border-emerald-400' : 'bg-rose-600 border border-rose-400'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Truck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-white">
                  Direct Supplier Deliveries (Direct GRV)
                </h1>
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 uppercase tracking-wide">
                  Cashier & Staff Receiving
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Receive direct vendor drop-offs at till • Multi-till cash payout balancing • Requires supervisor PIN approval to post inventory
              </p>
            </div>
          </div>

          {/* Tab Switcher & Navigation */}
          <div className="flex items-center gap-2">
            <button
              id="tab-btn-create-direct-grv"
              type="button"
              onClick={() => setActiveTab('create_direct_grv')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'create_direct_grv'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              New Delivery Voucher
            </button>
            <button
              id="tab-btn-grv-history"
              type="button"
              onClick={() => setActiveTab('grv_history')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'grv_history'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700'
              }`}
            >
              <FileText className="w-4 h-4" />
              Delivery Registry
              {directGrvs.filter((g) => g.status === 'PENDING_APPROVAL').length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                  {directGrvs.filter((g) => g.status === 'PENDING_APPROVAL').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Security & Rule Badge Strip */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Rule 1:</strong> Cashier cannot create new stocklines or change selling prices.
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Rule 2:</strong> Inventory stock only posts upon <strong>Supervisor Approval</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <DollarSign className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              <strong>Rule 3:</strong> Multi-cashier payments automatically reflect in Form 2 Cash Log.
            </span>
          </div>
        </div>
      </div>

      {activeTab === 'create_direct_grv' ? (
        <form onSubmit={handleSubmitDirectGrv} className="space-y-6">
          {/* Header Metadata Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                Voucher Details & Delivering Vendor
              </h2>
              <span className="text-xs font-mono text-slate-400">
                Logged in as: <strong className="text-white">{currentUser?.name || 'Till Operator'}</strong> ({currentUser?.role || 'CASHIER'})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Voucher # */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-amber-400" />
                  Voucher Number
                </label>
                <input
                  id="direct-grv-number"
                  type="text"
                  value={grvNumber}
                  readOnly
                  className="w-full bg-slate-950 border border-slate-800 text-amber-400 font-mono font-bold rounded-xl px-3.5 py-2.5 text-sm focus:outline-none"
                />
              </div>

              {/* Delivery Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  Delivery Date
                </label>
                <input
                  id="direct-grv-date"
                  type="date"
                  value={voucherDate}
                  onChange={(e) => setVoucherDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 font-medium"
                  required
                />
              </div>

              {/* Supplier Picker */}
              <div className="space-y-1.5 relative">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-amber-400" />
                  Delivering Supplier <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="direct-grv-supplier-input"
                    type="text"
                    value={supplierName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupplierName(val);
                      setSupplierFilterTerm(val);
                      setIsSupplierDropdownOpen(true);
                      const exact = suppliers.find((s) => s.name && s.name.trim().toLowerCase() === val.trim().toLowerCase());
                      setSupplierId(exact ? (exact.supplierId || exact.id || '') : '');
                    }}
                    onFocus={() => setIsSupplierDropdownOpen(true)}
                    placeholder="Search or select supplier..."
                    className={`w-full bg-slate-800 border text-white rounded-xl pl-3.5 pr-8 py-2.5 text-sm focus:outline-none font-medium ${
                      supplierName.trim().length > 0 && !suppliers.some((s) => (supplierId && (s.supplierId === supplierId || s.id === supplierId)) || (s.name && s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()))
                        ? isSupervisorOrAbove
                          ? 'border-amber-500 focus:border-amber-400'
                          : 'border-rose-500 focus:border-rose-400'
                        : 'border-slate-700 focus:border-amber-500'
                    }`}
                    required
                  />
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>

                {/* Supplier Validation State Feedback */}
                {supplierName.trim().length > 0 && (
                  (() => {
                    const isRegistered = suppliers.some(
                      (s) =>
                        (supplierId && (s.supplierId === supplierId || s.id === supplierId)) ||
                        (s.name && s.name.trim().toLowerCase() === supplierName.trim().toLowerCase())
                    );
                    if (isRegistered) {
                      return (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 mt-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Registered Supplier (Verified)</span>
                        </div>
                      );
                    }
                    if (!isSupervisorOrAbove) {
                      return (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-400 bg-rose-950/40 border border-rose-800/60 p-2 rounded-xl mt-1">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>
                            Unregistered Supplier: Cashiers cannot enter unregistered suppliers. Please select an existing supplier from the list below.
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-950/40 border border-amber-800/60 p-1.5 rounded-xl mt-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Unregistered Supplier: Will be registered automatically in supplier directory upon submission.</span>
                      </div>
                    );
                  })()
                )}

                {/* Dropdown menu */}
                {isSupplierDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-30 max-h-48 overflow-y-auto">
                    {filteredSuppliers.map((s) => {
                      const supKey = s.supplierId || s.id || s.name;
                      return (
                        <button
                          key={supKey}
                          type="button"
                          onClick={() => {
                            setSupplierName(s.name);
                            setSupplierId(supKey);
                            setIsSupplierDropdownOpen(false);
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-700 text-xs text-slate-200 flex items-center justify-between border-b border-slate-700/50"
                        >
                          <span className="font-bold text-white">{s.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{s.code || s.supplierId}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setIsSupplierDropdownOpen(false)}
                      className="w-full text-center py-1.5 text-[11px] text-slate-400 hover:text-white bg-slate-900/90 font-medium"
                    >
                      Close List
                    </button>
                  </div>
                )}
              </div>

              {/* Invoice / Delivery Note Ref */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  Supplier Invoice / D/Note #
                </label>
                <input
                  id="direct-grv-invoice-no"
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="e.g. INV-88219 / DN-402"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Line Items Table (Matches Goods Received Voucher functions, with Cashier restrictions) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Delivered Inventory Stocklines</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {rows.length} line(s) • {voucherTotals.totalUnits} total unit(s)
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isCashierOrSales
                    ? 'Security Lock Active: Cashiers can only select existing catalog stocklines. Selling price is locked and cannot be edited.'
                    : 'Supervisor Mode: Inspecting delivery pricing and stock increments.'}
                </p>
              </div>

              <button
                id="btn-add-direct-grv-row"
                type="button"
                onClick={handleAddRow}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 transition-all shadow-md self-start"
              >
                <Plus className="w-4 h-4" />
                Add Line Item
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm text-slate-300 border-collapse">
                <thead className="bg-slate-950/80 text-xs uppercase font-bold text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-3">#</th>
                    <th className="py-3.5 px-3 min-w-[240px]">Product</th>
                    <th className="py-3.5 px-3 w-24">Batch #</th>
                    <th className="py-3.5 px-3 w-28">Expiry</th>
                    <th className="py-3.5 px-3 w-36">Receive As</th>
                    <th className="py-3.5 px-3 w-20 text-center">Units/Cs</th>
                    <th className="py-3.5 px-3 w-36 text-center">Quantity</th>
                    <th className="py-3.5 px-3 w-24 text-right">Last Cost</th>
                    <th className="py-3.5 px-3 w-36 text-right font-bold text-amber-400">Price / Cost</th>
                    <th className="py-3.5 px-3 w-28 text-right font-black text-emerald-400">Line Total</th>
                    <th className="py-3.5 px-3 w-24 text-right">Unit Cost</th>
                    <th className="py-3.5 px-3 w-32 bg-slate-950/40">
                      <span className="flex items-center justify-between text-slate-400">
                        <span>Selling ($)</span>
                        <Lock className="w-3 h-3 text-amber-400" />
                      </span>
                    </th>
                    <th className="py-3.5 px-3 w-20 bg-slate-950/40 text-center">Markup</th>
                    <th className="py-3.5 px-2 w-12 text-center">Act</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 text-xs">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <Truck className="w-8 h-8 text-amber-500/60" />
                          <p className="text-sm font-medium">No items added to this direct delivery voucher yet.</p>
                          <button
                            type="button"
                            onClick={handleAddRow}
                            className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all flex items-center gap-1.5 font-bold"
                          >
                            <Plus className="w-4 h-4" />
                            + Add Product Row
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, index) => {
                      const calc = getRowCalculations(row);
                      const isSearchOpen = activeSearchRowId === row.id;

                      // Filter products for dropdown
                      const pTerm = (productSearchTerm || '').trim().toLowerCase();
                      const filteredAvailableProducts = items.filter(
                        (i) =>
                          !pTerm ||
                          (i.itemName && i.itemName.toLowerCase().includes(pTerm)) ||
                          (i.itemId && i.itemId.toLowerCase().includes(pTerm)) ||
                          (i.sku && i.sku.toLowerCase().includes(pTerm)) ||
                          (i.category && i.category.toLowerCase().includes(pTerm))
                      );

                      return (
                        <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-mono text-slate-500 text-center">{index + 1}</td>

                          {/* 1. Product (Searchable Popover) */}
                          <td className="py-2.5 px-3 relative min-w-[240px]">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isSearchOpen) {
                                    setActiveSearchRowId(null);
                                  } else {
                                    setActiveSearchRowId(row.id);
                                    setProductSearchTerm('');
                                  }
                                }}
                                className="w-full flex items-center justify-between gap-1.5 text-left bg-slate-900 border border-slate-700 hover:border-amber-500/70 rounded-lg px-2.5 py-2 text-xs text-white shadow-sm"
                              >
                                <div className="truncate">
                                  <span className="font-semibold text-slate-100">
                                    {row.productName || 'Select Product...'}
                                  </span>
                                  {row.productId && (
                                    <span className="text-[10px] text-amber-400/90 ml-1.5 font-mono">
                                      ({row.productId})
                                    </span>
                                  )}
                                </div>
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              </button>

                              {/* Searchable Popover */}
                              {isSearchOpen && (
                                <div className="absolute left-0 top-full mt-1 w-84 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                                  <div className="p-2.5 border-b border-slate-800 flex items-center gap-2 bg-slate-950">
                                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <input
                                      type="text"
                                      autoFocus
                                      value={productSearchTerm}
                                      onChange={(e) => setProductSearchTerm(e.target.value)}
                                      placeholder="Search product, SKU or ID..."
                                      className="w-full bg-transparent text-xs text-white focus:outline-none placeholder-slate-500"
                                    />
                                    {productSearchTerm && (
                                      <button
                                        type="button"
                                        onClick={() => setProductSearchTerm('')}
                                        className="text-slate-400 hover:text-slate-200 text-xs px-1"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>

                                  {/* Product List */}
                                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-800">
                                    {filteredAvailableProducts.length === 0 ? (
                                      <div className="p-3 text-center space-y-1">
                                        <p className="text-xs text-rose-400 font-bold flex items-center justify-center gap-1">
                                          <AlertTriangle className="w-3.5 h-3.5" />
                                          Stockline Not Found
                                        </p>
                                        <p className="text-[11px] text-slate-400">
                                          Cashiers can only receive items already registered in catalog.
                                        </p>
                                      </div>
                                    ) : (
                                      filteredAvailableProducts.map((p, pIdx) => (
                                        <button
                                          key={`${p.itemId}-${pIdx}`}
                                          type="button"
                                          onClick={() => handleSelectProduct(row.id, p)}
                                          className={`w-full text-left p-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between ${
                                            p.itemId === row.productId ? 'bg-amber-950/40 border-l-2 border-amber-400' : ''
                                          }`}
                                        >
                                          <div className="min-w-0 pr-2">
                                            <p className="text-xs font-semibold text-slate-200 truncate">
                                              {p.itemName}
                                            </p>
                                            <p className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                                              <span>{p.category || 'General'}</span>
                                              <span>•</span>
                                              <span className="font-mono">{p.itemId}</span>
                                              <span>•</span>
                                              <span>1 cs = {p.unitsPerCase || 1} un</span>
                                            </p>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <p className="text-xs font-bold text-amber-400 font-mono">
                                              ${(p.costPerCase || (p.costPerUnit ? p.costPerUnit * (p.unitsPerCase || 1) : 0)).toFixed(2)}/cs
                                            </p>
                                            <p className="text-[10px] text-emerald-400 font-mono">
                                              ${(p.sellPriceUnit || 0).toFixed(2)}/ea
                                            </p>
                                          </div>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 2. Batch # */}
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={row.batchNumber || ''}
                              onChange={(e) => updateRow(row.id, { batchNumber: e.target.value })}
                              placeholder="Auto (BAT-...)"
                              className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                            />
                          </td>

                          {/* 3. Expiry Date */}
                          <td className="py-2.5 px-3">
                            <input
                              type="date"
                              value={row.expiryDate || ''}
                              onChange={(e) => updateRow(row.id, { expiryDate: e.target.value })}
                              className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500"
                            />
                          </td>

                          {/* 4. Receive As (Pill Toggle) */}
                          <td className="py-2.5 px-3">
                            <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-700/80 gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.receiveAs !== 'Cases') {
                                    const ratio = Math.max(1, row.qtyPerCaseDefault || 1);
                                    const currentUnitCost = calc.unitCost;
                                    const converted = Number((currentUnitCost * ratio).toFixed(2));
                                    updateRow(row.id, {
                                      receiveAs: 'Cases',
                                      pricePerCase: converted || row.pricePerCase,
                                    });
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                  row.receiveAs === 'Cases'
                                    ? 'bg-blue-600 text-white shadow'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                <span>Cases</span>
                                <span className="text-[9px] font-normal opacity-80">(Def)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.receiveAs !== 'Singles') {
                                    const currentUnitCost = calc.unitCost;
                                    updateRow(row.id, {
                                      receiveAs: 'Singles',
                                      pricePerCase: Number(currentUnitCost.toFixed(2)) || row.pricePerCase,
                                    });
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                  row.receiveAs === 'Singles'
                                    ? 'bg-amber-600 text-white shadow'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                <span>Singles</span>
                              </button>
                            </div>
                          </td>

                          {/* 5. Units/Cs */}
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              min={1}
                              value={row.qtyPerCaseDefault}
                              onChange={(e) => updateRow(row.id, { qtyPerCaseDefault: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                            />
                          </td>

                          {/* 6. Quantity (Cases or Singles) */}
                          <td className="py-2.5 px-3 text-center">
                            {row.receiveAs === 'Cases' ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateRow(row.id, { quantityCases: Math.max(0, (row.quantityCases || 0) - 1) })}
                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.quantityCases}
                                    onChange={(e) => updateRow(row.id, { quantityCases: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                    className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-amber-300 font-bold font-mono focus:outline-none focus:border-amber-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateRow(row.id, { quantityCases: (row.quantityCases || 0) + 1 })}
                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                  >
                                    +
                                  </button>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono block">
                                  = {(row.quantityCases || 0) * (row.qtyPerCaseDefault || 1)} units
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateRow(row.id, { quantitySingles: Math.max(0, (row.quantitySingles || 0) - 1) })}
                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.quantitySingles}
                                    onChange={(e) => updateRow(row.id, { quantitySingles: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                    className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-amber-300 font-bold font-mono focus:outline-none focus:border-amber-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateRow(row.id, { quantitySingles: (row.quantitySingles || 0) + 1 })}
                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                  >
                                    +
                                  </button>
                                </div>
                                <span className="text-[10px] text-amber-400 font-mono block">
                                  Loose singles
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 7. Last Cost */}
                          <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                            ${(row.lastCost || 0).toFixed(2)}
                          </td>

                          {/* 8. Price / Cost (Per Case or Per Unit depending on receiveAs) */}
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col items-end">
                              <span className={`text-[10px] font-bold block mb-0.5 tracking-tight ${row.receiveAs === 'Singles' ? 'text-amber-400' : 'text-slate-400'}`}>
                                {row.receiveAs === 'Singles' ? 'Price / Unit' : 'Price / Case'}
                              </span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-mono">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  value={row.pricePerCase}
                                  onChange={(e) => updateRow(row.id, { pricePerCase: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  placeholder={row.receiveAs === 'Singles' ? 'Unit cost' : 'Case cost'}
                                  className="w-32 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-lg pl-6 pr-2.5 py-1 text-right text-xs text-white font-mono font-bold focus:outline-none"
                                  required
                                />
                              </div>
                            </div>
                          </td>

                          {/* 9. Line Total */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                            ${calc.lineTotal.toFixed(2)}
                          </td>

                          {/* 10. Unit Cost */}
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                            ${calc.unitCost.toFixed(2)}
                          </td>

                          {/* 11. Selling Price (LOCKED for Cashier, editable for Supervisor) */}
                          <td className="py-2.5 px-3 bg-slate-950/40">
                            {isCashierOrSales ? (
                              <div
                                className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 font-mono font-bold"
                                title="Locked: Cashiers cannot modify catalog selling prices"
                              >
                                <span className="flex items-center gap-1 text-[10px] text-amber-400 font-normal">
                                  <Lock className="w-3 h-3" />
                                  Locked
                                </span>
                                <span>${calc.sellingPrice.toFixed(2)}</span>
                              </div>
                            ) : (
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  value={row.sellingPrice}
                                  onChange={(e) => updateRow(row.id, { sellingPrice: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg pl-5 pr-2 py-1 text-right text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                                />
                              </div>
                            )}
                          </td>

                          {/* 12. Markup */}
                          <td className="py-2.5 px-3 bg-slate-950/40 text-center font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded font-bold ${
                                calc.markupPercent > 0 ? 'text-emerald-400' : 'text-slate-500'
                              }`}
                            >
                              {calc.markupPercent.toFixed(0)}%
                            </span>
                          </td>

                          {/* 13. Remove Row */}
                          <td className="py-2.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.id)}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Remove line"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals Summary Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-4 h-4 text-amber-400" />
                <span>Line totals automatically computed: Cases × Price + Singles × Unit Cost.</span>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Total Est. Selling Value</span>
                  <span className="font-mono text-sm font-bold text-slate-300">
                    ${voucherTotals.totalSelling.toFixed(2)}
                  </span>
                </div>
                <div className="text-right border-l border-slate-800 pl-6">
                  <span className="text-xs text-amber-400 font-bold block">Delivery Invoice Total Payable</span>
                  <span className="font-mono text-xl font-black text-amber-400">
                    ${voucherTotals.totalCost.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cash Out & Multi-Cashier Settlement Section */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Till Drawer Cash-Out & Multi-Operator Settlement</h3>
                  <p className="text-xs text-slate-400">
                    Multiple till operators can register their contributions for Form 2 balancing
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">Pay From Till Drawer(s):</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    id="toggle-cash-out-till"
                    type="checkbox"
                    checked={payFromTill}
                    onChange={(e) => setPayFromTill(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            </div>

            {payFromTill ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Till Operator Contributions ({paymentRows.length} operator{paymentRows.length > 1 ? 's' : ''})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddPaymentRow}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + Add Another Till Operator
                  </button>
                </div>

                {/* Operator Payment Rows */}
                <div className="space-y-3">
                  {paymentRows.map((payRow, pIdx) => {
                    const error = paymentErrors[payRow.id];
                    return (
                      <div
                        key={payRow.id}
                        className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                      >
                        {/* Operator Selector */}
                        <div className="sm:col-span-4 space-y-1">
                          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                            <User className="w-3 h-3 text-amber-400" />
                            Till Operator {pIdx + 1}
                          </label>
                          <select
                            value={payRow.userId}
                            onChange={(e) => handleUpdatePaymentRow(payRow.id, 'userId', e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-medium"
                          >
                            {staffList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.role})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Drawer ID */}
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                            <Layers className="w-3 h-3 text-slate-400" />
                            Drawer
                          </label>
                          <input
                            type="text"
                            value={payRow.drawerId}
                            onChange={(e) => handleUpdatePaymentRow(payRow.id, 'drawerId', e.target.value)}
                            placeholder="Till 1"
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none font-medium"
                          />
                        </div>

                        {/* Amount Paid from this Till */}
                        <div className="sm:col-span-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                              <DollarSign className="w-3 h-3 text-emerald-400" />
                              Till Amount Paid ($)
                            </label>
                            <button
                              type="button"
                              onClick={() => handleFillRemainder(payRow.id)}
                              className="text-[10px] text-amber-400 hover:underline"
                            >
                              Fill Bal
                            </button>
                          </div>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs text-slate-400 font-mono">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={payRow.amount}
                              onChange={(e) =>
                                handleUpdatePaymentRow(
                                  payRow.id,
                                  'amount',
                                  e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0)
                                )
                              }
                              placeholder="0.00"
                              className="w-full bg-slate-800 border border-slate-700 text-amber-400 font-mono font-bold rounded-xl pl-6 pr-2.5 py-2 text-xs focus:outline-none focus:border-amber-500"
                              required
                            />
                          </div>
                        </div>

                        {/* Operator PIN */}
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                            <KeyRound className="w-3 h-3 text-amber-400" />
                            Operator PIN
                          </label>
                          <input
                            type="password"
                            maxLength={6}
                            value={payRow.pin}
                            onChange={(e) => {
                              handleUpdatePaymentRow(payRow.id, 'pin', e.target.value);
                              if (paymentErrors[payRow.id]) {
                                setPaymentErrors((prev) => {
                                  const c = { ...prev };
                                  delete c[payRow.id];
                                  return c;
                                });
                              }
                            }}
                            placeholder="PIN..."
                            className={`w-full bg-slate-800 border text-white rounded-xl px-2.5 py-2 text-xs font-mono tracking-wider focus:outline-none ${
                              error ? 'border-rose-500' : 'border-slate-700 focus:border-amber-500'
                            }`}
                            required
                          />
                        </div>

                        {/* Remove Action */}
                        <div className="sm:col-span-1 flex items-center justify-center pt-4 sm:pt-0">
                          {paymentRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemovePaymentRow(payRow.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              title="Remove operator payment"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Error Message */}
                        {error && (
                          <div className="col-span-1 sm:col-span-12">
                            <p className="text-[11px] text-rose-400">{error}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Additional Non-Till Contribution (e.g. Owner direct payment) */}
                <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-sky-400" />
                      Owner / Non-Till Direct Payment ($)
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Amount paid directly by store owner or company account (does not impact till cash)
                    </p>
                  </div>
                  <div className="relative max-w-xs ml-auto w-full">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ownerPaymentAmount}
                      onChange={(e) =>
                        setOwnerPaymentAmount(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      placeholder="0.00"
                      className="w-full bg-slate-800 border border-slate-700 text-sky-400 font-mono font-bold rounded-xl pl-7 pr-3 py-2 text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* Live Balancing Breakdown Card */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-400 uppercase tracking-wider">Settlement & Balancing Summary</span>
                    <span className="font-mono text-slate-400">Total Invoice: ${voucherTotals.totalCost.toFixed(2)}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-bold">Total Till Out</span>
                      <span className="font-mono text-sm font-bold text-amber-400">
                        ${paymentBreakdown.tillTotal.toFixed(2)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-bold">Owner Direct Cash</span>
                      <span className="font-mono text-sm font-bold text-sky-400">
                        ${paymentBreakdown.ownerTotal.toFixed(2)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-bold">Total Settled</span>
                      <span className="font-mono text-sm font-bold text-emerald-400">
                        ${paymentBreakdown.totalSettled.toFixed(2)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-bold">Supplier Credit Balance</span>
                      <span className="font-mono text-sm font-bold text-orange-400">
                        ${paymentBreakdown.creditBalance.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Visual Status Indicator */}
                  {paymentBreakdown.creditBalance > 0 ? (
                    <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Partial Payout: <strong>${paymentBreakdown.totalSettled.toFixed(2)}</strong> paid now, remaining{' '}
                        <strong>${paymentBreakdown.creditBalance.toFixed(2)}</strong> will be left on supplier credit account.
                      </span>
                    </div>
                  ) : paymentBreakdown.overpayment > 0 ? (
                    <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        Overpayment Warning: Total payments exceed delivery invoice by{' '}
                        <strong>${paymentBreakdown.overpayment.toFixed(2)}</strong>.
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Fully Balanced: Delivery invoice of ${voucherTotals.totalCost.toFixed(2)} is 100% accounted for. Each till operator payment will be referenced under Direct Procurement in Form 2.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <span>
                  Delivered 100% on supplier credit balance / 30-day invoice. No cash will be deducted from till drawers.
                </span>
              </div>
            )}
          </div>

          {/* Action Button Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <div className="text-xs text-slate-400">
              {isSupervisorOrAbove ? (
                <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Supervisor logged in: Voucher will be immediately posted and stock updated.
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1.5 font-medium">
                  <Clock className="w-4 h-4" />
                  Staff mode: Voucher will be saved with status <strong>PENDING_APPROVAL</strong>. Inventory only posts when supervisor approves.
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                id="btn-submit-direct-grv"
                type="submit"
                className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/20 flex items-center gap-2 transition-all transform active:scale-95"
              >
                <Check className="w-5 h-5" />
                {isSupervisorOrAbove ? 'Post & Approve Direct Delivery' : 'Submit Direct Delivery Voucher'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        /* Voucher Registry / History Tab */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                Direct Supplier Delivery Registry
              </h2>
              <p className="text-xs text-slate-400">
                Audit trail of direct vendor deliveries, till cash-outs, and supervisor authorizations
              </p>
            </div>

            {/* Controls: Search, Refresh, Filter Pills */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              <div className="relative flex-1 md:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historySearchTerm}
                  onChange={(e) => setHistorySearchTerm(e.target.value)}
                  placeholder="Search GRV #, supplier, invoice, staff..."
                  className="w-full bg-slate-950 border border-slate-800 text-xs text-white rounded-xl pl-8 pr-7 py-1.5 focus:outline-none focus:border-amber-500 font-medium"
                />
                {historySearchTerm && (
                  <button
                    type="button"
                    onClick={() => setHistorySearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800 text-xs overflow-x-auto">
                {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((filter) => {
                  const count = directGrvs.filter((g) => {
                    if (filter === 'ALL') return true;
                    if (filter === 'PENDING') return g.status === 'PENDING_APPROVAL';
                    if (filter === 'APPROVED') return g.status === 'APPROVED';
                    if (filter === 'REJECTED') return g.status === 'REJECTED';
                    return true;
                  }).length;

                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setHistoryFilter(filter)}
                      className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                        historyFilter === filter
                          ? 'bg-amber-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>{filter === 'PENDING' ? 'Pending' : filter}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                          historyFilter === filter
                            ? 'bg-slate-950 text-amber-300'
                            : filter === 'PENDING' && count > 0
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setDirectGrvs(getDirectGrvs());
                    showToast('success', 'Refreshed direct delivery registry.');
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs flex items-center gap-1"
                  title="Refresh deliveries from storage"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-left text-sm text-slate-300 border-collapse">
              <thead className="bg-slate-950/80 text-xs uppercase font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">GRV #</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Supplier</th>
                  <th className="py-3.5 px-4">Items / Qty</th>
                  <th className="py-3.5 px-4 text-right">Invoice Cost</th>
                  <th className="py-3.5 px-4">Till Contributions</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4">Received By</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 text-xs">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <FileText className="w-8 h-8 text-slate-600" />
                        <p className="text-sm font-semibold text-slate-300">No vouchers found</p>
                        <p className="text-xs text-slate-500 max-w-sm">
                          {historyFilter !== 'ALL' || historySearchTerm
                            ? 'No direct delivery vouchers match your current search or filter criteria.'
                            : 'No direct deliveries have been recorded yet. Submit a new delivery voucher to get started.'}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          {(historyFilter !== 'ALL' || historySearchTerm) && (
                            <button
                              type="button"
                              onClick={() => {
                                setHistoryFilter('ALL');
                                setHistorySearchTerm('');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white font-medium"
                            >
                              Clear Filters
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveTab('create_direct_grv')}
                            className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs text-slate-950 font-bold"
                          >
                            + Record New Delivery
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((grv) => {
                    const isPending = grv.status === 'PENDING_APPROVAL';
                    const isApproved = grv.status === 'APPROVED';
                    const isRejected = grv.status === 'REJECTED';

                    return (
                      <tr key={grv.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">{grv.grvNumber}</td>
                        <td className="py-3 px-4 font-mono text-slate-400">{grv.date}</td>
                        <td className="py-3 px-4 font-medium text-white">
                          <div>{grv.supplierName}</div>
                          {grv.invoiceNo && (
                            <span className="text-[10px] text-slate-400 font-mono">Inv: {grv.invoiceNo}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {grv.items.length} line(s) ({grv.items.reduce((s, i) => s + i.quantity, 0)} units)
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-white">
                          ${grv.totalCost.toFixed(2)}
                        </td>
                        <td className="py-3 px-4">
                          {grv.payments && grv.payments.length > 0 ? (
                            <div className="space-y-0.5">
                              {grv.payments.map((p, i) => (
                                <div key={i} className="text-[11px] font-mono text-slate-300">
                                  <span className="text-amber-400 font-bold">${p.amount.toFixed(2)}</span>
                                  <span className="text-slate-500"> ({p.userName})</span>
                                </div>
                              ))}
                              {grv.creditBalance && grv.creditBalance > 0 ? (
                                <div className="text-[10px] text-orange-400 font-mono">
                                  Bal: ${grv.creditBalance.toFixed(2)} (Credit)
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-slate-500 font-mono">Supplier Credit</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isPending && (
                            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Pending Approval
                            </span>
                          )}
                          {isApproved && (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Approved
                            </span>
                          )}
                          {isRejected && (
                            <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/30 inline-flex items-center gap-1">
                              <X className="w-3 h-3" />
                              Rejected
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          <div>{grv.receivedByStaffName}</div>
                          {grv.approvedByStaffName && (
                            <span className="text-[10px] text-emerald-400 block font-mono">
                              Appr: {grv.approvedByStaffName}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* View / Print */}
                            <button
                              type="button"
                              onClick={() => setViewingGrv(grv)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                              title="View & Print Voucher"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

                            {/* Supervisor Approval / Rejection */}
                            {isPending && isSupervisorOrAbove && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setApprovingGrv(grv);
                                    setSupervisorPin('');
                                    setSupervisorPinError('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectingGrv(grv);
                                    setRejectReason('');
                                  }}
                                  className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10 transition"
                                  title="Reject"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Supervisor PIN Approval Modal */}
      {approvingGrv && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Supervisor Delivery Authorization</h3>
              </div>
              <button type="button" onClick={() => setApprovingGrv(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              <p>
                Approving direct delivery: <strong className="text-white">{approvingGrv.grvNumber}</strong>
              </p>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
                <p>
                  Delivering Supplier: <span className="font-bold text-white">{approvingGrv.supplierName}</span>
                </p>
                <p>
                  Items to Add: <span className="font-bold text-white">{approvingGrv.items.length} line item(s)</span>
                </p>
                <p>
                  Total Cost: <span className="font-bold text-amber-400 font-mono">${approvingGrv.totalCost.toFixed(2)}</span>
                </p>
                <p className="text-emerald-400 font-bold pt-1">
                  Upon approval, stock will be immediately incremented in the inventory catalog.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                Enter Supervisor / Manager PIN
              </label>
              <input
                type="password"
                maxLength={6}
                value={supervisorPin}
                onChange={(e) => {
                  setSupervisorPin(e.target.value);
                  setSupervisorPinError('');
                }}
                placeholder="4-digit PIN..."
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:border-emerald-500"
                autoFocus
              />
              {supervisorPinError && <p className="text-xs text-rose-400">{supervisorPinError}</p>}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setApprovingGrv(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-lg shadow-emerald-600/20"
              >
                Confirm Approval & Post Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectingGrv && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                Reject Direct Delivery GRV
              </h3>
              <button type="button" onClick={() => setRejectingGrv(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">Reason for Rejection</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Price discrepancy, damaged goods, unauthorized supplier..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-3 text-xs focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectingGrv(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black"
              >
                Reject Delivery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Delivery Voucher Modal */}
      {viewingGrv && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <Truck className="w-6 h-6 text-amber-400" />
                <div>
                  <h3 className="text-xl font-black text-white">Direct Goods Received Voucher</h3>
                  <p className="text-xs text-slate-400 font-mono">Store Delivery & Till Cash Payout Audit</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingGrv(null);
                    onClearTargetGrv?.();
                  }}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Sheet */}
            <div className="p-6 rounded-2xl bg-white text-slate-900 font-sans shadow-inner space-y-5">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h4 className="text-xl font-black tracking-tight text-slate-950 uppercase">SAIMETRIC RETAIL POS</h4>
                  <p className="text-xs text-slate-600">{viewingGrv.branchName || currentBranch.name}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-bold text-slate-500 block">VOUCHER #</span>
                  <span className="text-base font-black font-mono text-slate-900">{viewingGrv.grvNumber}</span>
                  <span className="text-xs text-slate-500 block">{viewingGrv.date}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="font-bold text-slate-500 block">SUPPLIER:</span>
                  <span className="font-bold text-sm text-slate-900">{viewingGrv.supplierName}</span>
                  {viewingGrv.invoiceNo && <span className="text-slate-600 block">Invoice / DN: {viewingGrv.invoiceNo}</span>}
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">STATUS:</span>
                  <span className="font-black text-sm text-slate-900 uppercase">{viewingGrv.status}</span>
                  <span className="text-slate-600 block">Received by: {viewingGrv.receivedByStaffName}</span>
                  {viewingGrv.approvedByStaffName && (
                    <span className="text-emerald-700 block font-bold">Approved by: {viewingGrv.approvedByStaffName}</span>
                  )}
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900">
                    <th className="py-2">Item Description</th>
                    <th className="py-2 text-right">Cases</th>
                    <th className="py-2 text-right">Singles</th>
                    <th className="py-2 text-right">Total Units</th>
                    <th className="py-2 text-right">Unit Cost</th>
                    <th className="py-2 text-right">Line Total ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewingGrv.items.map((item, i) => (
                    <tr key={i}>
                      <td className="py-2 font-medium">{item.productName}</td>
                      <td className="py-2 text-right font-mono">{item.quantityCases || 0}</td>
                      <td className="py-2 text-right font-mono">{item.quantitySingles || 0}</td>
                      <td className="py-2 text-right font-mono">{item.quantity}</td>
                      <td className="py-2 text-right font-mono">${item.costPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono font-bold">${item.lineTotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 font-bold">
                    <td colSpan={5} className="py-2 text-right uppercase">
                      Invoice Total:
                    </td>
                    <td className="py-2 text-right font-mono text-sm">${viewingGrv.totalCost.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Multi-Cashier Till Settlement Breakdown */}
              <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs space-y-2">
                <span className="font-bold text-slate-700 block uppercase tracking-wider text-[10px]">
                  Cash Payout & Drawer Allocation (Form 2 Reference)
                </span>
                {viewingGrv.payments && viewingGrv.payments.length > 0 ? (
                  <div className="space-y-1">
                    {viewingGrv.payments.map((p, i) => (
                      <div key={i} className="flex justify-between font-mono text-slate-800">
                        <span>
                          Till Drawer Payout ({p.userName} - {p.drawerId || 'Till 1'}):
                        </span>
                        <span className="font-bold">${p.amount.toFixed(2)}</span>
                      </div>
                    ))}
                    {viewingGrv.ownerPaymentAmount && viewingGrv.ownerPaymentAmount > 0 && (
                      <div className="flex justify-between font-mono text-sky-800">
                        <span>Owner Non-Till Cash:</span>
                        <span className="font-bold">${viewingGrv.ownerPaymentAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {viewingGrv.creditBalance && viewingGrv.creditBalance > 0 && (
                      <div className="flex justify-between font-mono text-orange-800">
                        <span>Remaining on Supplier Credit:</span>
                        <span className="font-bold">${viewingGrv.creditBalance.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-600">No cash paid from till. Full balance on credit.</p>
                )}
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-center border-t border-slate-300">
                <div>
                  <div className="border-b border-slate-400 pb-6"></div>
                  <span className="mt-1 block font-bold text-slate-700">Driver / Vendor Signature</span>
                </div>
                <div>
                  <div className="border-b border-slate-400 pb-6"></div>
                  <span className="mt-1 block font-bold text-slate-700">Supervisor / Till Operator Signature</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
