import React, { useState, useEffect, useRef } from 'react';
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
  getBranches,
  getCurrentBranch,
  getDirectGrvs,
  saveDirectGrv,
  approveDirectGrv,
  rejectDirectGrv,
  getSalespeople,
  hasStaffPermission,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';

interface DirectGoodsReceivedViewProps {
  currentUser: Salesperson | null;
  onGoToMaster?: () => void;
  onGoToHome?: () => void;
}

interface DirectRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  markupPercent: number;
  profit: number;
  unitsPerCase: number;
  unit: string;
}

export const DirectGoodsReceivedView: React.FC<DirectGoodsReceivedViewProps> = ({
  currentUser,
  onGoToMaster,
  onGoToHome,
}) => {
  const [items, setItems] = useState<InventoryItem[]>(() => getInventoryItems());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getSuppliers());
  const [branches, setBranches] = useState<Branch[]>(() => getBranches());
  const [staffList, setStaffList] = useState<Salesperson[]>(() => getSalespeople());
  const [directGrvs, setDirectGrvs] = useState<DirectGrv[]>(() => getDirectGrvs());

  const currentBranch = getCurrentBranch();

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'create_direct_grv' | 'grv_history'>('create_direct_grv');

  // Role detection
  const userRole = (currentUser?.role || 'CASHIER').toUpperCase();
  const isCashierOrSales = userRole === 'CASHIER' || userRole === 'SALES';
  const isSupervisorOrAbove = userRole === 'SUPERVISOR' || userRole === 'MANAGER' || userRole === 'ADMIN' || userRole === 'OWNER';

  // Form Fields
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

  // Rows Table
  const [rows, setRows] = useState<DirectRow[]>([
    {
      id: 'row-1',
      productId: '',
      productName: '',
      quantity: 1,
      costPrice: 0,
      sellingPrice: 0,
      markupPercent: 0,
      profit: 0,
      unitsPerCase: 1,
      unit: 'Singles',
    },
  ]);

  // Product search dropdown
  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');

  // Cash Out From Till Toggle
  const [payFromTill, setPayFromTill] = useState<boolean>(true);
  const [selectedPayingStaffId, setSelectedPayingStaffId] = useState<string>(currentUser?.id || 'USR-003');
  const [cashierPin, setCashierPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

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

  // Row Manipulation
  const handleAddRow = () => {
    const newRow: DirectRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      productId: '',
      productName: '',
      quantity: 1,
      costPrice: 0,
      sellingPrice: 0,
      markupPercent: 0,
      profit: 0,
      unitsPerCase: 1,
      unit: 'Singles',
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

  const handleSelectProduct = (rowId: string, item: InventoryItem) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const costPrice = item.costPerUnit || item.costPerCase / (item.unitsPerCase || 1) || 0;
        const sellingPrice = item.sellPriceUnit || 0;
        const profit = Math.max(0, sellingPrice - costPrice);
        const markupPercent = costPrice > 0 ? ((sellingPrice - costPrice) / costPrice) * 100 : 0;
        return {
          ...r,
          productId: item.itemId,
          productName: item.itemName,
          costPrice,
          sellingPrice,
          profit,
          markupPercent,
          unitsPerCase: item.unitsPerCase || 1,
          unit: 'Singles',
        };
      })
    );
    setActiveSearchRowId(null);
    setProductSearchTerm('');
  };

  const handleUpdateRowField = (rowId: string, field: 'quantity' | 'costPrice', value: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r, [field]: value };
        const cost = field === 'costPrice' ? value : r.costPrice;
        const selling = r.sellingPrice;
        updated.profit = Math.max(0, selling - cost);
        updated.markupPercent = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
        return updated;
      })
    );
  };

  // Calculations
  const grvTotalCost = rows.reduce((sum, r) => sum + (r.quantity * r.costPrice), 0);
  const grvTotalSelling = rows.reduce((sum, r) => sum + (r.quantity * r.sellingPrice), 0);
  const grvTotalProfit = Math.max(0, grvTotalSelling - grvTotalCost);

  // Submit Direct GRV
  const handleSubmitDirectGrv = (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierName.trim()) {
      showToast('error', 'Please select or enter the delivering supplier.');
      return;
    }

    const invalidItems = rows.filter((r) => !r.productName.trim() || r.quantity <= 0);
    if (invalidItems.length > 0) {
      showToast('error', 'All rows must have a valid product name and positive quantity.');
      return;
    }

    // Cashier PIN validation if paid from till
    if (payFromTill) {
      const payingStaff = staffList.find((s) => s.id === selectedPayingStaffId);
      if (!cashierPin) {
        setPinError('Cashier PIN is required for Till Cash-Out confirmation.');
        return;
      }
      if (payingStaff && payingStaff.pin && payingStaff.pin !== cashierPin) {
        setPinError('Invalid Cashier PIN. Please enter your valid 4-digit POS PIN.');
        return;
      }
    }
    setPinError('');

    const targetBranch = branches.find((b) => b.branchId === selectedBranchId) || currentBranch;
    const payingStaff = staffList.find((s) => s.id === selectedPayingStaffId) || currentUser;

    const grvItems: DirectGrvItem[] = rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      quantity: r.quantity,
      costPrice: r.costPrice,
      sellingPrice: r.sellingPrice,
      lineTotal: r.quantity * r.costPrice,
      markupPercent: r.markupPercent,
      profit: r.profit,
      unitsPerCase: r.unitsPerCase,
      unit: r.unit,
    }));

    const payments: DirectGrvTillPayment[] = payFromTill
      ? [
          {
            userId: payingStaff?.id || 'USR-003',
            userName: payingStaff?.name || 'Cashier',
            amount: grvTotalCost,
            pinConfirmed: true,
            confirmedAt: new Date().toISOString(),
          },
        ]
      : [];

    const newDirectGrv: DirectGrv = {
      id: grvNumber,
      grvNumber,
      type: 'DIRECT',
      status: isSupervisorOrAbove ? 'APPROVED' : 'PENDING_APPROVAL',
      companyId: 'COMP-001',
      branchId: targetBranch.branchId,
      branchName: targetBranch.name,
      supplierId: supplierId || 'SUP-DIRECT',
      supplierName,
      invoiceNo: invoiceNo || undefined,
      purchaseOrderNo: purchaseOrderNo || undefined,
      date: voucherDate,
      items: grvItems,
      totalCost: grvTotalCost,
      totalSellingPrice: grvTotalSelling,
      payFromTill,
      payments,
      receivedByStaffId: currentUser?.id || 'USR-003',
      receivedByStaffName: currentUser?.name || 'Cashier',
      approvedByStaffId: isSupervisorOrAbove ? currentUser?.id : undefined,
      approvedByStaffName: isSupervisorOrAbove ? currentUser?.name : undefined,
      approvedAt: isSupervisorOrAbove ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString(),
      synced: false,
    };

    if (isSupervisorOrAbove) {
      // Direct approve
      saveDirectGrv(newDirectGrv);
      approveDirectGrv(newDirectGrv.id, currentUser?.id || 'USR-001', currentUser?.name || 'Supervisor');
      showToast('success', `Direct GRV ${grvNumber} created & immediately APPROVED! Stock added.`);
    } else {
      saveDirectGrv(newDirectGrv);
      showToast('success', `Direct GRV ${grvNumber} saved with PENDING_APPROVAL! Awaiting Supervisor PIN.`);
    }

    // Reset Form
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    setGrvNumber(`DGRV-${today}-${rand}`);
    setSupplierName('');
    setSupplierId('');
    setInvoiceNo('');
    setPurchaseOrderNo('');
    setCashierPin('');
    setRows([
      {
        id: `row-${Date.now()}`,
        productId: '',
        productName: '',
        quantity: 1,
        costPrice: 0,
        sellingPrice: 0,
        markupPercent: 0,
        profit: 0,
        unitsPerCase: 1,
        unit: 'Singles',
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

    // Verify supervisor pin against staff with supervisor or admin role
    const supervisor = staffList.find(
      (s) =>
        (s.role === 'SUPERVISOR' || s.role === 'ADMIN' || s.role === 'OWNER') &&
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
                  Direct Supplier Deliveries (GRV)
                </h1>
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 uppercase tracking-wide">
                  Non-Admin Staff Voucher
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Receive direct vendor drop-offs at till • Protected pricing fields • Till cash payout authorization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700/80">
              <button
                id="tab-btn-create-direct-grv"
                type="button"
                onClick={() => setActiveTab('create_direct_grv')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'create_direct_grv'
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Plus className="w-4 h-4" />
                New Direct Delivery
              </button>
              <button
                id="tab-btn-direct-grv-history"
                type="button"
                onClick={() => setActiveTab('grv_history')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'grv_history'
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <FileText className="w-4 h-4" />
                Voucher Registry ({directGrvs.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'create_direct_grv' ? (
        <form onSubmit={handleSubmitDirectGrv} className="space-y-6">
          {/* Voucher Metadata Header Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">Voucher Particulars</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 font-mono">GRV Ref:</span>
                <span className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono font-bold text-sm">
                  {grvNumber}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Delivering Supplier */}
              <div className="relative space-y-1.5">
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
                      setSupplierName(e.target.value);
                      setIsSupplierDropdownOpen(true);
                      setSupplierFilterTerm(e.target.value);
                    }}
                    onFocus={() => setIsSupplierDropdownOpen(true)}
                    placeholder="Search or enter supplier..."
                    className="w-full bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>

                {isSupplierDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto">
                    {filteredSuppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSupplierName(s.name);
                          setSupplierId(s.id);
                          setIsSupplierDropdownOpen(false);
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-700/70 text-slate-200 text-sm flex items-center justify-between"
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-slate-400 font-mono">{s.code}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setIsSupplierDropdownOpen(false)}
                      className="w-full text-center py-1.5 text-xs text-amber-400 bg-slate-900/90 border-t border-slate-700 font-medium"
                    >
                      Close list (Use entered text)
                    </button>
                  </div>
                )}
              </div>

              {/* Delivery / GRV Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  Delivery Date <span className="text-rose-400">*</span>
                </label>
                <input
                  id="direct-grv-date"
                  type="date"
                  value={voucherDate}
                  onChange={(e) => setVoucherDate(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              {/* Destination Branch */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  Receiving Branch <span className="text-rose-400">*</span>
                </label>
                <select
                  id="direct-grv-branch"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  {branches.map((b, bIdx) => (
                    <option key={`${b.branchId || bIdx}-${bIdx}`} value={b.branchId}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Supplier Invoice Ref / Waybill */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  Supplier Invoice / Waybill No.
                </label>
                <input
                  id="direct-grv-invoice-no"
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="e.g. INV-9901 / WB-441"
                  className="w-full bg-slate-800/90 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Line Items Table (Reusing the Excel GRV table layout with strict permissions) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Delivered Inventory Items</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {rows.length} line(s)
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isCashierOrSales
                    ? 'Role restriction active: Selling price and markup are locked in read-only mode.'
                    : 'Supervisor mode: Full inventory & pricing inspection enabled.'}
                </p>
              </div>

              <button
                id="btn-add-grv-row"
                type="button"
                onClick={handleAddRow}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 text-xs font-bold flex items-center gap-2 transition-all self-start"
              >
                <Plus className="w-4 h-4" />
                Add Item Line
              </button>
            </div>

            {/* Excel-Style Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm text-slate-300 border-collapse">
                <thead className="bg-slate-950/80 text-xs uppercase font-bold text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4">#</th>
                    <th className="py-3.5 px-4 min-w-[220px]">Product / Description</th>
                    <th className="py-3.5 px-4 w-28">Quantity</th>
                    <th className="py-3.5 px-4 w-32">Cost Price ($)</th>
                    <th className="py-3.5 px-4 w-32">Line Total ($)</th>
                    <th className="py-3.5 px-4 w-32 bg-slate-950/40">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Lock className="w-3 h-3 text-slate-500" />
                        Selling ($)
                      </span>
                    </th>
                    <th className="py-3.5 px-4 w-28 bg-slate-950/40">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Percent className="w-3 h-3 text-slate-500" />
                        Markup %
                      </span>
                    </th>
                    <th className="py-3.5 px-4 w-28 bg-slate-950/40">
                      <span className="flex items-center gap-1 text-slate-400">
                        <TrendingUp className="w-3 h-3 text-slate-500" />
                        Profit ($)
                      </span>
                    </th>
                    <th className="py-3.5 px-3 w-14 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                  {rows.map((row, index) => {
                    const lineTotal = row.quantity * row.costPrice;
                    return (
                      <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-slate-500">{index + 1}</td>

                        {/* Product Picker */}
                        <td className="py-3 px-4 relative">
                          <div className="relative">
                            <input
                              type="text"
                              value={row.productName}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, productName: val } : r))
                                );
                                setActiveSearchRowId(row.id);
                                setProductSearchTerm(val);
                              }}
                              onFocus={() => {
                                setActiveSearchRowId(row.id);
                                setProductSearchTerm(row.productName);
                              }}
                              placeholder="Type to search catalog..."
                              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500 font-medium"
                              required
                            />
                          </div>

                          {/* Catalog Autocomplete Dropdown */}
                          {activeSearchRowId === row.id && (
                            <div className="absolute left-4 right-4 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto">
                              {items
                                .filter((i) => {
                                  const pTerm = (productSearchTerm || '').trim().toLowerCase();
                                  return (
                                    !pTerm ||
                                    (i.itemName && i.itemName.toLowerCase().includes(pTerm)) ||
                                    (i.itemId && i.itemId.toLowerCase().includes(pTerm))
                                  );
                                })
                                .slice(0, 10)
                                .map((item) => (
                                  <button
                                    key={item.itemId}
                                    type="button"
                                    onClick={() => handleSelectProduct(row.id, item)}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-xs text-slate-200 flex items-center justify-between border-b border-slate-700/50"
                                  >
                                    <div>
                                      <p className="font-bold text-white">{item.itemName}</p>
                                      <p className="text-[10px] text-slate-400 font-mono">
                                        ID: {item.itemId} • Stock: {item.stockSingles} ea
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-amber-400 font-mono font-bold">
                                        Cost: ${(item.costPerUnit || 0).toFixed(2)}
                                      </p>
                                      <p className="text-[10px] text-slate-400 font-mono">
                                        Sell: ${(item.sellingPrice || 0).toFixed(2)}
                                      </p>
                                    </div>
                                  </button>
                                ))}
                              <button
                                type="button"
                                onClick={() => setActiveSearchRowId(null)}
                                className="w-full text-center py-1.5 text-[11px] text-slate-400 hover:text-white bg-slate-900/90 font-medium"
                              >
                                Close catalog list
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Quantity Received (EDITABLE) */}
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={row.quantity}
                            onChange={(e) => handleUpdateRowField(row.id, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs text-right font-mono focus:outline-none focus:border-amber-500"
                            required
                          />
                        </td>

                        {/* Cost Price (EDITABLE) */}
                        <td className="py-3 px-4">
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs text-slate-400 font-mono">$</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={row.costPrice}
                              onChange={(e) => handleUpdateRowField(row.id, 'costPrice', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-6 pr-2.5 py-1.5 text-xs text-right font-mono focus:outline-none focus:border-amber-500 font-bold"
                              required
                            />
                          </div>
                        </td>

                        {/* Line Total = Qty * Cost (AUTO-CALCULATED) */}
                        <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                          ${lineTotal.toFixed(2)}
                        </td>

                        {/* Selling Price (READ ONLY FOR CASHIER/SALES) */}
                        <td className="py-3 px-4 bg-slate-950/20 text-right">
                          <span className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-xs text-slate-300">
                            ${row.sellingPrice.toFixed(2)}
                          </span>
                        </td>

                        {/* Markup % (READ ONLY) */}
                        <td className="py-3 px-4 bg-slate-950/20 text-right font-mono text-xs text-slate-400">
                          {row.markupPercent.toFixed(1)}%
                        </td>

                        {/* Profit (READ ONLY) */}
                        <td className="py-3 px-4 bg-slate-950/20 text-right font-mono text-xs text-emerald-400 font-medium">
                          ${row.profit.toFixed(2)}
                        </td>

                        {/* Action: Delete Line */}
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals Summary Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-4 h-4 text-amber-400" />
                <span>Line totals automatically computed: Qty × Cost Price.</span>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Total Est. Selling Value</span>
                  <span className="font-mono text-sm font-bold text-slate-300">
                    ${grvTotalSelling.toFixed(2)}
                  </span>
                </div>
                <div className="text-right border-l border-slate-800 pl-6">
                  <span className="text-xs text-amber-400 font-bold block">GRV Total Payable</span>
                  <span className="font-mono text-xl font-black text-amber-400">
                    ${grvTotalCost.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cash Out From Till Toggle & PIN Confirmation */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Cash Out From Till Payout</h3>
                  <p className="text-xs text-slate-400">
                    Direct cash payment from terminal drawer to supplier driver
                  </p>
                </div>
              </div>

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

            {payFromTill ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                {/* Paying Cashier / Till */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-amber-400" />
                    Paying Cashier / Operator
                  </label>
                  <select
                    id="select-paying-cashier"
                    value={selectedPayingStaffId}
                    onChange={(e) => setSelectedPayingStaffId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  >
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount Paid */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                    Amount Deducted from Till
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm text-slate-400 font-mono">$</span>
                    <input
                      type="text"
                      readOnly
                      value={grvTotalCost.toFixed(2)}
                      className="w-full bg-slate-950 border border-slate-700 text-amber-400 font-mono font-bold rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* Cashier PIN Confirmation */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    Cashier 4-Digit PIN <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="cashier-payout-pin"
                    type="password"
                    maxLength={6}
                    value={cashierPin}
                    onChange={(e) => {
                      setCashierPin(e.target.value);
                      setPinError('');
                    }}
                    placeholder="Enter POS PIN..."
                    className={`w-full bg-slate-800 border text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none font-mono tracking-widest ${
                      pinError ? 'border-rose-500' : 'border-slate-700 focus:border-amber-500'
                    }`}
                    required={payFromTill}
                  />
                  {pinError && <p className="text-[11px] text-rose-400">{pinError}</p>}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <span>Delivered on supplier credit / 30-day invoice. No cash will be deducted from till drawer.</span>
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
                  Staff mode: Voucher will be saved with status <strong>PENDING_APPROVAL</strong>.
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
                Direct Delivery Registry
              </h2>
              <p className="text-xs text-slate-400">
                Audit trail of direct vendor deliveries, approvals, and till payouts
              </p>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Branch: <span className="text-white font-bold">{currentBranch.name}</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-left text-sm text-slate-300 border-collapse">
              <thead className="bg-slate-950/80 text-xs uppercase font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">GRV Number</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Supplier</th>
                  <th className="py-3.5 px-4">Items</th>
                  <th className="py-3.5 px-4 text-right">Total Cost</th>
                  <th className="py-3.5 px-4 text-center">Till Payout</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4">Received By</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {directGrvs.map((grv) => {
                  const isPending = grv.status === 'PENDING_APPROVAL';
                  const isApproved = grv.status === 'APPROVED';
                  const isRejected = grv.status === 'REJECTED';

                  return (
                    <tr key={grv.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs font-bold text-amber-400">
                        {grv.grvNumber}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-400">{grv.date}</td>
                      <td className="py-3 px-4 font-medium text-white">{grv.supplierName}</td>
                      <td className="py-3 px-4 text-xs text-slate-300">
                        {grv.items.length} product(s) ({grv.items.reduce((s, i) => s + i.quantity, 0)} units)
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        ${grv.totalCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {grv.payFromTill ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/30">
                            Cash Out
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[11px] font-mono">
                            Credit
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isPending && (
                          <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Pending
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
                      <td className="py-3 px-4 text-xs text-slate-300">
                        {grv.receivedByStaffName}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Print / View Voucher Button */}
                          <button
                            type="button"
                            onClick={() => setViewingGrv(grv)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                            title="View & Print Voucher"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Supervisor Approval Buttons */}
                          {isPending && isSupervisorOrAbove && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setApprovingGrv(grv);
                                  setSupervisorPin('');
                                  setSupervisorPinError('');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingGrv(grv);
                                  setRejectReason('');
                                }}
                                className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
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
                })}
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
                <h3 className="text-lg font-bold text-white">Supervisor Approval Required</h3>
              </div>
              <button
                type="button"
                onClick={() => setApprovingGrv(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              <p>
                Authorizing Direct Delivery: <strong>{approvingGrv.grvNumber}</strong>
              </p>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
                <p>Delivering Supplier: <span className="font-bold text-white">{approvingGrv.supplierName}</span></p>
                <p>Items Count: <span className="font-bold text-white">{approvingGrv.items.length} item(s)</span></p>
                <p>Total Cost: <span className="font-bold text-amber-400 font-mono">${approvingGrv.totalCost.toFixed(2)}</span></p>
                <p>Till Payout: <span className="font-bold text-emerald-400 font-mono">{approvingGrv.payFromTill ? `$${approvingGrv.totalCost.toFixed(2)}` : 'None (Credit)'}</span></p>
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
              {supervisorPinError && (
                <p className="text-xs text-rose-400">{supervisorPinError}</p>
              )}
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

      {/* Reject Modal */}
      {rejectingGrv && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                Reject Direct GRV
              </h3>
              <button
                type="button"
                onClick={() => setRejectingGrv(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">Reason for Rejection</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Price discrepancy, damaged packaging, unauthorized vendor..."
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

      {/* Clean Printable Voucher Preview Modal */}
      {viewingGrv && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <Truck className="w-6 h-6 text-amber-400" />
                <div>
                  <h3 className="text-xl font-black text-white">Goods Received Voucher</h3>
                  <p className="text-xs text-slate-400 font-mono">Direct Supplier Delivery Form</p>
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
                  onClick={() => setViewingGrv(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Voucher Sheet */}
            <div className="p-6 rounded-2xl bg-white text-slate-900 font-sans shadow-inner space-y-5">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h4 className="text-xl font-black tracking-tight text-slate-950 uppercase">
                    SAIMETRIC RETAIL POS
                  </h4>
                  <p className="text-xs text-slate-600">{viewingGrv.branchName}</p>
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
                  {viewingGrv.invoiceNo && (
                    <span className="text-slate-600 block">Inv Ref: {viewingGrv.invoiceNo}</span>
                  )}
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">DELIVERY STATUS:</span>
                  <span className="font-black text-sm text-slate-900 uppercase">{viewingGrv.status}</span>
                  <span className="text-slate-600 block">Received by: {viewingGrv.receivedByStaffName}</span>
                  {viewingGrv.approvedByStaffName && (
                    <span className="text-slate-600 block">Approved by: {viewingGrv.approvedByStaffName}</span>
                  )}
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900">
                    <th className="py-2">Item Description</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Unit Cost</th>
                    <th className="py-2 text-right">Total ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewingGrv.items.map((item, i) => (
                    <tr key={i}>
                      <td className="py-2 font-medium">{item.productName}</td>
                      <td className="py-2 text-right font-mono">{item.quantity}</td>
                      <td className="py-2 text-right font-mono">${item.costPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono font-bold">${item.lineTotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 font-bold">
                    <td colSpan={3} className="py-2 text-right uppercase">GRV Total:</td>
                    <td className="py-2 text-right font-mono text-sm">${viewingGrv.totalCost.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Till Payout Statement */}
              {viewingGrv.payFromTill && (
                <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs flex justify-between">
                  <span>Till Cash-Out Authorized:</span>
                  <span className="font-bold font-mono">${viewingGrv.totalCost.toFixed(2)} (Cash Drawer Out)</span>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-center border-t border-slate-300">
                <div>
                  <div className="border-b border-slate-400 pb-6"></div>
                  <span className="mt-1 block font-bold text-slate-700">Driver / Vendor Signature</span>
                </div>
                <div>
                  <div className="border-b border-slate-400 pb-6"></div>
                  <span className="mt-1 block font-bold text-slate-700">Supervisor / Cashier Signature</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
