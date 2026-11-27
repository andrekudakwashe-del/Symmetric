import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Printer,
  FileText,
  CheckCircle2,
  XCircle,
  Edit3,
  Copy,
  Send,
  Truck,
  PackageCheck,
  TrendingUp,
  ClipboardList,
  Wrench,
  Bluetooth,
  Eye,
  Trash2,
  X,
  Package,
} from 'lucide-react';
import { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, Salesperson } from '../../types';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getCurrentBranch,
  getCurrentCompany,
  getPurchaseOrders,
  isPurchaseOrderApprover,
  rejectPurchaseOrder,
  submitPurchaseOrderForApproval,
} from '../../db/roomDatabase';
import {
  printPurchaseOrderA4,
  printPurchaseOrderThermal,
} from '../../services/purchaseOrderPrintService';
import { bluetoothPrinter } from '../../services/bluetoothPrinter';
import { PurchaseOrderEditorModal } from './PurchaseOrderEditorModal';
import { formatPoLineRateLabel, resolvePoLinePackType } from '../../utils/purchaseOrderMath';

interface PurchaseOrderRegistryViewProps {
  currentUser: Salesperson;
  activeSection: 'purchase_orders' | 'reorder_insights';
  onChangeSection: (section: 'purchase_orders' | 'reorder_insights') => void;
  onGoToMaster?: () => void;
  onReceiveDirectGrv?: (poId: string) => void;
  onReceiveNormalGrv?: (poId: string) => void;
  externalDraftRequest?: {
    nonce: number;
    lines: PurchaseOrderLine[];
    supplierId?: string;
    supplierName?: string;
  } | null;
  reorderContent?: React.ReactNode;
}

type StatusFilter = 'ALL' | PurchaseOrderStatus;

const STATUS_META: Record<
  PurchaseOrderStatus,
  { label: string; textClass: string; dotClass: string }
> = {
  DRAFT: { label: 'Draft', textClass: 'text-slate-600', dotClass: 'bg-slate-400' },
  PENDING_APPROVAL: { label: 'Pending Approval', textClass: 'text-amber-700', dotClass: 'bg-amber-500' },
  APPROVED: { label: 'Approved', textClass: 'text-emerald-700', dotClass: 'bg-emerald-500' },
  PARTIALLY_RECEIVED: { label: 'Partially Received', textClass: 'text-indigo-700', dotClass: 'bg-indigo-500' },
  RECEIVED: { label: 'Received', textClass: 'text-teal-700', dotClass: 'bg-teal-600' },
  REJECTED: { label: 'Returned / Rejected', textClass: 'text-red-700', dotClass: 'bg-red-500' },
  CANCELLED: { label: 'Cancelled', textClass: 'text-slate-400', dotClass: 'bg-slate-300' },
};

const FILTER_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'PARTIALLY_RECEIVED', label: 'Partial' },
  { id: 'RECEIVED', label: 'Received' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'REJECTED', label: 'Rejected' },
];

export const PurchaseOrderRegistryView: React.FC<PurchaseOrderRegistryViewProps> = ({
  currentUser,
  activeSection,
  onChangeSection,
  onGoToMaster,
  onReceiveDirectGrv,
  onReceiveNormalGrv,
  externalDraftRequest,
  reorderContent,
}) => {
  const canApprove = isPurchaseOrderApprover(currentUser);
  const company = getCurrentCompany();
  const branch = getCurrentBranch();

  const [orders, setOrders] = useState<PurchaseOrder[]>(() => getPurchaseOrders());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Editor modal state
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
  const [seededLines, setSeededLines] = useState<PurchaseOrderLine[] | undefined>(undefined);
  const [seededSupplierId, setSeededSupplierId] = useState<string | undefined>(undefined);
  const [seededSupplierName, setSeededSupplierName] = useState<string | undefined>(undefined);

  // Viewing detail modal
  const [viewingPo, setViewingPo] = useState<PurchaseOrder | null>(null);

  // Reject reason modal
  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  // Confirm delete / cancel modal
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<PurchaseOrder | null>(null);

  // Printing & Bluetooth helper state
  const [printingPoId, setPrintingPoId] = useState<string | null>(null);
  const [printerActionBusy, setPrinterActionBusy] = useState<boolean>(false);
  const [showPrinterReconnectBar, setShowPrinterReconnectBar] = useState<boolean>(false);
  const [lastThermalTarget, setLastThermalTarget] = useState<PurchaseOrder | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const refreshOrders = () => {
    const next = getPurchaseOrders();
    setOrders(next);
    setViewingPo((curr) => (curr ? next.find((o) => o.id === curr.id) || curr : null));
  };

  useEffect(() => {
    refreshOrders();
    const handler = () => refreshOrders();
    window.addEventListener('saimetric_purchase_orders_updated', handler);
    window.addEventListener('saimetric_db_updated', handler);
    return () => {
      window.removeEventListener('saimetric_purchase_orders_updated', handler);
      window.removeEventListener('saimetric_db_updated', handler);
    };
  }, []);

  // Open PO Editor whenever Reorder Insights sends selected items to create a new PO
  useEffect(() => {
    if (!externalDraftRequest || !externalDraftRequest.nonce) return;
    setEditingPo(null);
    setSeededLines(externalDraftRequest.lines);
    setSeededSupplierId(externalDraftRequest.supplierId);
    setSeededSupplierName(externalDraftRequest.supplierName);
    onChangeSection('purchase_orders');
    setIsEditorOpen(true);
  }, [externalDraftRequest?.nonce]);

  const stats = useMemo(() => {
    let pendingCount = 0;
    let approvedCount = 0;
    let partialCount = 0;
    let openValue = 0;
    for (const po of orders) {
      if (po.status === 'PENDING_APPROVAL') pendingCount++;
      if (po.status === 'APPROVED') {
        approvedCount++;
        openValue += Number(po.grandTotal || 0);
      }
      if (po.status === 'PARTIALLY_RECEIVED') {
        partialCount++;
        openValue += Number(po.grandTotal || 0);
      }
    }
    return { pendingCount, approvedCount, partialCount, openValue };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = String(searchTerm || '').trim().toLowerCase();
    return orders.filter((po) => {
      if (!po) return false;
      if (statusFilter !== 'ALL' && po.status !== statusFilter) return false;
      if (!q) return true;
      if (String(po.poNumber || po.id || '').toLowerCase().includes(q)) return true;
      if (String(po.supplierName || '').toLowerCase().includes(q)) return true;
      if (String(po.createdByName || '').toLowerCase().includes(q)) return true;
      return (po.lines || []).some(
        (l) =>
          String(l?.poDescription || '').toLowerCase().includes(q) ||
          String(l?.masterDescription || '').toLowerCase().includes(q) ||
          String(l?.code || '').toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, searchTerm]);

  const handleOpenNewPo = () => {
    setEditingPo(null);
    setSeededLines(undefined);
    setSeededSupplierId(undefined);
    setSeededSupplierName(undefined);
    setIsEditorOpen(true);
  };

  const handleOpenEditPo = (po: PurchaseOrder) => {
    setEditingPo(po);
    setSeededLines(undefined);
    setSeededSupplierId(undefined);
    setSeededSupplierName(undefined);
    setIsEditorOpen(true);
  };

  const handleDuplicatePo = (po: PurchaseOrder) => {
    const clonedLines: PurchaseOrderLine[] = (po.lines || []).map((l, idx) => ({
      ...l,
      lineId: `POL-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      receivedCases: 0,
      receivedUnits: 0,
    }));
    setEditingPo(null);
    setSeededLines(clonedLines);
    setSeededSupplierId(po.supplierId);
    setSeededSupplierName(po.supplierName);
    setIsEditorOpen(true);
  };

  const handleSubmitForApproval = (po: PurchaseOrder) => {
    const res = submitPurchaseOrderForApproval(po.id, currentUser);
    if (res.success) {
      refreshOrders();
      showToast('success', `${po.poNumber} submitted for manager approval.`);
    } else {
      showToast('error', res.message || 'Could not submit Purchase Order.');
    }
  };

  const handleApprove = (po: PurchaseOrder) => {
    const res = approvePurchaseOrder(po.id, currentUser);
    if (res.success) {
      refreshOrders();
      showToast('success', `${po.poNumber} approved and ready for GRV receiving.`);
    } else {
      showToast('error', res.message || 'Approval failed.');
    }
  };

  const handleConfirmReject = () => {
    if (!rejectTarget) return;
    const res = rejectPurchaseOrder(
      rejectTarget.id,
      currentUser,
      rejectReason.trim() || 'Returned for revision'
    );
    if (res.success) {
      refreshOrders();
      showToast('info', `${rejectTarget.poNumber} returned for revision.`);
      setRejectTarget(null);
      setRejectReason('');
    } else {
      showToast('error', res.message || 'Could not return Purchase Order.');
    }
  };

  const handleConfirmDeleteOrCancel = () => {
    if (!confirmDeleteTarget) return;
    if (confirmDeleteTarget.status === 'DRAFT' || confirmDeleteTarget.status === 'REJECTED') {
      deletePurchaseOrder(confirmDeleteTarget.id);
      showToast('info', `Deleted ${confirmDeleteTarget.poNumber}.`);
    } else {
      const res = cancelPurchaseOrder(confirmDeleteTarget.id, currentUser, 'Cancelled by user');
      if (!res.success) {
        showToast('error', res.message || 'Could not cancel Purchase Order.');
        return;
      }
      showToast('info', `Cancelled ${confirmDeleteTarget.poNumber}.`);
    }
    setConfirmDeleteTarget(null);
    setViewingPo(null);
    refreshOrders();
  };

  const handlePrintA4 = (po: PurchaseOrder) => {
    const res = printPurchaseOrderA4(po);
    if (res.success) {
      showToast('success', res.message);
    } else {
      showToast('error', res.message);
    }
  };

  const handlePrint58mm = async (po: PurchaseOrder) => {
    setPrintingPoId(po.id);
    setLastThermalTarget(po);
    try {
      const res = await printPurchaseOrderThermal(po, '58mm');
      if (res.mode === 'bluetooth') {
        setShowPrinterReconnectBar(false);
        showToast('success', res.message);
      } else if (res.success) {
        setShowPrinterReconnectBar(Boolean(res.bluetoothAvailable));
        showToast('info', res.message);
      } else {
        setShowPrinterReconnectBar(Boolean(res.bluetoothAvailable));
        showToast('error', res.message);
      }
    } catch (err: any) {
      setShowPrinterReconnectBar(true);
      showToast('error', err?.message || '58mm thermal print failed. Use Repair or Pair Printer below.');
    } finally {
      setPrintingPoId(null);
    }
  };

  const handleRepairPrinter = async () => {
    setPrinterActionBusy(true);
    try {
      const ok = await bluetoothPrinter.connect({ forceRepair: true });
      if (ok) {
        setShowPrinterReconnectBar(false);
        showToast('success', 'Bluetooth printer repaired and reconnected.');
        if (lastThermalTarget) {
          await handlePrint58mm(lastThermalTarget);
        }
      } else {
        showToast('error', 'Repair did not find a printer. Try Pair Printer.');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Printer repair failed.');
    } finally {
      setPrinterActionBusy(false);
    }
  };

  const handlePairPrinter = async () => {
    setPrinterActionBusy(true);
    try {
      const ok = await bluetoothPrinter.connect({ forgetFirst: true });
      if (ok) {
        setShowPrinterReconnectBar(false);
        showToast('success', 'Bluetooth printer paired.');
        if (lastThermalTarget) {
          await handlePrint58mm(lastThermalTarget);
        }
      } else {
        showToast('error', 'Pairing cancelled or no Bluetooth printer selected.');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Printer pairing failed.');
    } finally {
      setPrinterActionBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24">
      {/* Top Module Navigation Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <ClipboardList className="w-5 h-5 text-slate-900 shrink-0" />
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 truncate">
                  Purchase Orders
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {company?.company_name || 'Retail Enterprise'} &middot; {branch?.name || 'Main Store'} &middot;{' '}
                {currentUser.name} ({currentUser.role})
              </p>
            </div>

            {/* Primary Mode Switcher + Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => onChangeSection('purchase_orders')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                    activeSection === 'purchase_orders'
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>PO Registry</span>
                  {stats.pendingCount > 0 && (
                    <span className="ml-0.5 font-mono text-[11px] font-bold text-amber-700">
                      ({stats.pendingCount})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSection('reorder_insights')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                    activeSection === 'reorder_insights'
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Reorder Insights</span>
                </button>
              </div>

              {onGoToMaster && (
                <button
                  type="button"
                  onClick={onGoToMaster}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Package className="w-3.5 h-3.5 text-slate-500" />
                  <span>Inventory Master</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleOpenNewPo}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>New Purchase Order</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-slate-100 border-slate-200 text-slate-800'
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 rounded hover:bg-black/5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bluetooth Printer Repair / Pair Recovery Strip (when 58mm print fails) */}
      {showPrinterReconnectBar && activeSection === 'purchase_orders' && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3">
          <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-amber-900 font-medium">
              58mm Bluetooth thermal printer needs reconnection. Reconnect below and retry printing{' '}
              <span className="font-mono font-bold">{lastThermalTarget?.poNumber}</span>.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={printerActionBusy}
                onClick={handleRepairPrinter}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Repair Printer</span>
              </button>
              <button
                type="button"
                disabled={printerActionBusy}
                onClick={handlePairPrinter}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Bluetooth className="w-3.5 h-3.5" />
                <span>Pair Printer</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPrinterReconnectBar(false)}
                className="p-1.5 text-amber-700 hover:text-amber-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION B: Reorder Insights Sub-section */}
      {activeSection === 'reorder_insights' ? (
        <div>{reorderContent}</div>
      ) : (
        /* SECTION A: Main Purchase Order Registry */
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Pending Manager Approval
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-700">
                {stats.pendingCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {canApprove ? 'Awaiting your sign-off' : 'Waiting for manager'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Approved &amp; Ready
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {stats.approvedCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Ready for Direct or Normal GRV</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Partially Received
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-indigo-700">
                {stats.partialCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Remaining items open</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Open Committed Value
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                ${stats.openValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{orders.length} total POs in registry</div>
            </div>
          </div>

          {/* Search & Status Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              {FILTER_TABS.map((tab) => {
                const count =
                  tab.id === 'ALL' ? orders.length : orders.filter((o) => o.status === tab.id).length;
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {tab.label} <span className="font-mono opacity-80">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full lg:w-72 shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search PO #, supplier, SKU, flavour..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400"
              />
            </div>
          </div>

          {/* Purchase Orders Registry Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filteredOrders.length === 0 ? (
              <div className="py-16 px-6 text-center">
                <ClipboardList className="w-9 h-9 text-slate-300 mx-auto mb-2.5" />
                <div className="text-sm font-semibold text-slate-800">No Purchase Orders Found</div>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Create a new Purchase Order directly or switch to Reorder Insights to build one from low-stock recommendations.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleOpenNewPo}
                    className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Purchase Order</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeSection('reorder_insights')}
                    className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <TrendingUp className="w-4 h-4" />
                    <span>View Reorder Insights</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">PO Number &amp; Date</th>
                      <th className="py-3 px-4">Supplier &amp; Creator</th>
                      <th className="py-3 px-4">Status &amp; Approval</th>
                      <th className="py-3 px-4 text-right">Items / Qty</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredOrders.map((po) => {
                      const st = STATUS_META[po.status] || STATUS_META.DRAFT;
                      const isEditable =
                        po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL' || po.status === 'REJECTED';
                      const isReceivable = po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED';
                      const receivedUnitsTotal = (po.lines || []).reduce(
                        (s, l) => s + Number(l.receivedUnits || 0),
                        0
                      );
                      const pctReceived =
                        po.totalUnits > 0 ? Math.min(100, Math.round((receivedUnitsTotal / po.totalUnits) * 100)) : 0;

                      return (
                        <tr key={po.id} className="hover:bg-slate-50/70 transition">
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setViewingPo(po)}
                              className="font-mono text-sm font-bold text-slate-900 hover:text-indigo-700 cursor-pointer text-left"
                            >
                              {po.poNumber}
                            </button>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {po.orderDate}
                              {po.expectedDeliveryDate ? ` · Due ${po.expectedDeliveryDate}` : ''}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900 truncate max-w-[240px]">
                              {po.supplierName}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              By {po.createdByName || 'Staff'}
                              {po.branchName ? ` · ${po.branchName}` : ''}
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${st.dotClass}`} />
                              <span className={`text-xs font-semibold ${st.textClass}`}>{st.label}</span>
                            </div>
                            {po.approvedByName && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Approved by {po.approvedByName}
                              </div>
                            )}
                            {po.status === 'REJECTED' && po.rejectionReason && (
                              <div className="text-[11px] text-red-600 mt-0.5 truncate max-w-[220px]">
                                Reason: {po.rejectionReason}
                              </div>
                            )}
                            {po.status === 'PARTIALLY_RECEIVED' && (
                              <div className="text-[11px] text-indigo-700 font-mono mt-0.5">
                                {pctReceived}% received ({(po.linkedGrvIds || []).length} GRV)
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs">
                            <div className="font-semibold text-slate-900">
                              {(po.lines || []).length} line{(po.lines || []).length === 1 ? '' : 's'}
                            </div>
                            <div className="text-slate-500">
                              {po.totalCases || 0} cs &middot; {(po.totalUnits || 0).toLocaleString()} u
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                            ${Number(po.grandTotal || 0).toFixed(2)}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                              {po.status === 'DRAFT' && (
                                <button
                                  type="button"
                                  onClick={() => handleSubmitForApproval(po)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Submit</span>
                                </button>
                              )}

                              {canApprove && (po.status === 'PENDING_APPROVAL' || po.status === 'DRAFT') && (
                                <button
                                  type="button"
                                  onClick={() => handleApprove(po)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                              )}

                              {canApprove && po.status === 'PENDING_APPROVAL' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectTarget(po);
                                    setRejectReason('');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              )}

                              {isReceivable && onReceiveDirectGrv && (
                                <button
                                  type="button"
                                  onClick={() => onReceiveDirectGrv(po.id)}
                                  title="Receive items from this PO in Direct GRV"
                                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                  <span>Direct GRV</span>
                                </button>
                              )}

                              {isReceivable && onReceiveNormalGrv && (
                                <button
                                  type="button"
                                  onClick={() => onReceiveNormalGrv(po.id)}
                                  title="Receive items from this PO in Normal GRV"
                                  className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <PackageCheck className="w-3.5 h-3.5" />
                                  <span>Normal GRV</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={printingPoId === po.id}
                                onClick={() => handlePrint58mm(po)}
                                title="Print on 58mm Thermal Printer"
                                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>{printingPoId === po.id ? 'Printing...' : '58mm'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handlePrintA4(po)}
                                title="Print / Save A4 Sheet"
                                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>A4</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setViewingPo(po)}
                                title="View PO Details"
                                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {isEditable && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditPo(po)}
                                  title="Edit Purchase Order"
                                  className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Purchase Order Modal */}
      <PurchaseOrderEditorModal
        isOpen={isEditorOpen}
        currentUser={currentUser}
        editingPo={editingPo}
        initialLines={seededLines}
        initialSupplierId={seededSupplierId}
        initialSupplierName={seededSupplierName}
        onClose={() => setIsEditorOpen(false)}
        onSaved={(savedPo, mode) => {
          setIsEditorOpen(false);
          refreshOrders();
          if (mode === 'APPROVED') {
            showToast('success', `Purchase Order ${savedPo.poNumber} saved & approved.`);
          } else if (mode === 'SUBMITTED') {
            showToast('success', `Purchase Order ${savedPo.poNumber} submitted for manager approval.`);
          } else {
            showToast('info', `Purchase Order ${savedPo.poNumber} saved as draft.`);
          }
        }}
      />

      {/* Purchase Order Detail Inspection Modal */}
      {viewingPo && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-lg font-bold font-mono text-slate-900">{viewingPo.poNumber}</h3>
                  <span
                    className={`text-xs font-semibold uppercase tracking-wider ${
                      (STATUS_META[viewingPo.status] || STATUS_META.DRAFT).textClass
                    }`}
                  >
                    {(STATUS_META[viewingPo.status] || STATUS_META.DRAFT).label}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {viewingPo.supplierName} &middot; Ordered {viewingPo.orderDate} &middot; Prepared by{' '}
                  {viewingPo.createdByName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPo(null)}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {toast && (
                <div
                  className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
                    toast.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : toast.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-slate-100 border-slate-200 text-slate-800'
                  }`}
                >
                  <span>{toast.message}</span>
                  <button
                    type="button"
                    onClick={() => setToast(null)}
                    className="p-1 rounded hover:bg-black/5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {showPrinterReconnectBar && (
                <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="text-xs text-amber-900 font-medium">
                    Want direct 1-tap Bluetooth ESC/POS printing without the print dialog? Reconnect your 58mm printer:
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={printerActionBusy}
                      onClick={handleRepairPrinter}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Repair Printer</span>
                    </button>
                    <button
                      type="button"
                      disabled={printerActionBusy}
                      onClick={handlePairPrinter}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Bluetooth className="w-3.5 h-3.5" />
                      <span>Pair Printer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPrinterReconnectBar(false)}
                      className="p-1 text-amber-700 hover:text-amber-900 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div>
                  <div className="text-slate-500 uppercase font-semibold text-[10px]">Supplier</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{viewingPo.supplierName}</div>
                  {viewingPo.supplierPhone && <div className="text-slate-600 mt-0.5">{viewingPo.supplierPhone}</div>}
                </div>
                <div>
                  <div className="text-slate-500 uppercase font-semibold text-[10px]">Delivery &amp; Terms</div>
                  <div className="text-slate-900 font-semibold mt-0.5">
                    Due: {viewingPo.expectedDeliveryDate || 'As agreed'}
                  </div>
                  <div className="text-slate-600 mt-0.5">{viewingPo.paymentTerms || 'Standard terms'}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase font-semibold text-[10px]">Authorization</div>
                  <div className="text-slate-900 font-semibold mt-0.5">
                    {viewingPo.approvedByName ? `Approved by ${viewingPo.approvedByName}` : 'Pending Manager Approval'}
                  </div>
                  {viewingPo.approvedAt && (
                    <div className="text-slate-500 mt-0.5">{new Date(viewingPo.approvedAt).toLocaleString()}</div>
                  )}
                  {(viewingPo.linkedGrvIds || []).length > 0 && (
                    <div className="text-indigo-700 font-mono mt-1">
                      GRVs: {(viewingPo.linkedGrvIds || []).join(', ')}
                    </div>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 text-right">Ordered</th>
                      <th className="py-2.5 px-3 text-right">Received</th>
                      <th className="py-2.5 px-3 text-right">Cost / Pack</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {(viewingPo.lines || []).map((line, i) => {
                      const packType = resolvePoLinePackType(line);
                      const orderedDisplay =
                        packType === 'Singles'
                          ? `${Number(line.orderSingles || line.totalUnits || 0)} singles`
                          : packType === 'Cases'
                          ? `${Number(line.orderCases || 0)} cs (${Number(line.totalUnits || 0)} u)`
                          : `${Number(line.orderCases || 0)} cs + ${Number(line.orderSingles || 0)} u (${Number(line.totalUnits || 0)} u)`;
                      return (
                        <tr key={line.lineId}>
                          <td className="py-2.5 px-3 text-xs font-mono text-slate-500">{i + 1}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">
                              {line.poDescription || line.masterDescription}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                              {line.code && <span>{line.code}</span>}
                              {line.code && <span>&middot;</span>}
                              <span className="font-sans font-semibold text-indigo-700">{packType}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs">
                            {orderedDisplay}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs">
                            {line.receivedUnits ? `${line.receivedCases || 0} cs (${line.receivedUnits} u)` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs">
                            {formatPoLineRateLabel(line)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                            ${Number(line.lineTotal || 0).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {viewingPo.notes && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <span className="font-semibold text-slate-800">Notes: </span>
                  {viewingPo.notes}
                </div>
              )}

              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">${Number(viewingPo.subtotal || 0).toFixed(2)}</span>
                  </div>
                  {Number(viewingPo.taxAmount || 0) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Tax ({viewingPo.taxPercent || 0}%)</span>
                      <span className="font-mono tabular-nums">${Number(viewingPo.taxAmount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                    <span>Grand Total</span>
                    <span className="font-mono tabular-nums">${Number(viewingPo.grandTotal || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleDuplicatePo(viewingPo)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Duplicate</span>
                </button>
                {viewingPo.status !== 'RECEIVED' && viewingPo.status !== 'PARTIALLY_RECEIVED' && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTarget(viewingPo)}
                    className="px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{viewingPo.status === 'DRAFT' || viewingPo.status === 'REJECTED' ? 'Delete' : 'Cancel PO'}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={printingPoId === viewingPo.id}
                  onClick={() => handlePrint58mm(viewingPo)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{printingPoId === viewingPo.id ? 'Printing...' : 'Print 58mm'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintA4(viewingPo)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Print A4</span>
                </button>
                {canApprove && (viewingPo.status === 'PENDING_APPROVAL' || viewingPo.status === 'DRAFT') && (
                  <button
                    type="button"
                    onClick={() => handleApprove(viewingPo)}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve PO</span>
                  </button>
                )}
                {(viewingPo.status === 'APPROVED' || viewingPo.status === 'PARTIALLY_RECEIVED') &&
                  onReceiveDirectGrv && (
                    <button
                      type="button"
                      onClick={() => {
                        setViewingPo(null);
                        onReceiveDirectGrv(viewingPo.id);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>Receive (Direct GRV)</span>
                    </button>
                  )}
                {(viewingPo.status === 'APPROVED' || viewingPo.status === 'PARTIALLY_RECEIVED') &&
                  onReceiveNormalGrv && (
                    <button
                      type="button"
                      onClick={() => {
                        setViewingPo(null);
                        onReceiveNormalGrv(viewingPo.id);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <PackageCheck className="w-3.5 h-3.5" />
                      <span>Receive (Normal GRV)</span>
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">
              Return Purchase Order {rejectTarget.poNumber}
            </h3>
            <p className="text-xs text-slate-500">
              Provide a brief reason so the creator can revise quantities, flavours, or supplier pricing and resubmit.
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Reduce Orange cases from 20 to 10 and confirm supplier price..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-slate-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Return for Revision
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Cancel Confirmation Modal */}
      {confirmDeleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">
              {confirmDeleteTarget.status === 'DRAFT' || confirmDeleteTarget.status === 'REJECTED'
                ? `Delete ${confirmDeleteTarget.poNumber}?`
                : `Cancel ${confirmDeleteTarget.poNumber}?`}
            </h3>
            <p className="text-xs text-slate-600">
              {confirmDeleteTarget.status === 'DRAFT' || confirmDeleteTarget.status === 'REJECTED'
                ? 'This draft Purchase Order will be permanently removed.'
                : 'This Purchase Order will be marked as CANCELLED and will no longer appear for GRV receiving.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Keep PO
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrCancel}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
