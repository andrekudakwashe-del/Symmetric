import React, { useState, useMemo } from 'react';
import {
  ArrowLeftRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  X,
  Search,
  Printer,
  ShieldCheck,
  Package,
  DollarSign,
  Info,
} from 'lucide-react';
import { SaleInvoice, Salesperson } from '../../types';
import {
  getAllInventoryItems,
  exchangeSaleItems,
  ItemExchangeRecord,
  getSalespeople,
  verifySalespersonPin,
  getCurrentBranchId,
  getCurrentCompanyId,
  getCompanies,
  getCurrentCompany,
} from '../../db/roomDatabase';
import { bluetoothPrinter } from '../../services/bluetoothPrinter';

interface ItemExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: SaleInvoice | null;
  currentStaff: Salesperson;
  onExchangeSuccess?: (record: ItemExchangeRecord) => void;
}

export const ItemExchangeModal: React.FC<ItemExchangeModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currentStaff,
  onExchangeSuccess,
}) => {
  if (!isOpen || !invoice) return null;

  // Inventory catalog for replacements
  const inventoryItems = useMemo(() => {
    try {
      return getAllInventoryItems();
    } catch {
      return [];
    }
  }, []);

  // Staff list for manager PIN verification
  const staffList = useMemo(() => {
    try {
      return getSalespeople();
    } catch {
      return [];
    }
  }, []);

  const managers = useMemo(() => {
    return staffList.filter((s: any) =>
      ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR', 'MANAGER', 'admin', 'manager', 'supervisor'].some(
        (role) => String(s.role || '').toLowerCase().includes(role.toLowerCase())
      )
    );
  }, [staffList]);

  // Original items from the invoice
  const originalItems: any[] = Array.isArray(invoice.items) ? invoice.items : [];

  // Calculate already exchanged quantities for items on this invoice
  const priorExchanges: ItemExchangeRecord[] = Array.isArray(invoice.exchanges) ? invoice.exchanges : [];
  const exchangedQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    priorExchanges.forEach((ex) => {
      if (ex.returnedItem?.id) {
        map[ex.returnedItem.id] = (map[ex.returnedItem.id] || 0) + (ex.returnedItem.quantity || 0);
      }
    });
    return map;
  }, [priorExchanges]);

  // Form State - Returned Item
  const [selectedReturnItemId, setSelectedReturnItemId] = useState<string>(() => {
    const firstEligible = originalItems.find(
      (it) => (it.quantity || 1) - (exchangedQtyMap[it.id] || 0) > 0
    );
    return firstEligible ? firstEligible.id : (originalItems[0]?.id || '');
  });

  const selectedReturnItem = useMemo(() => {
    return originalItems.find((it) => it.id === selectedReturnItemId) || null;
  }, [originalItems, selectedReturnItemId]);

  const maxReturnQty = useMemo(() => {
    if (!selectedReturnItem) return 1;
    const originalQty = Number(selectedReturnItem.quantity) || 1;
    const alreadyReturned = exchangedQtyMap[selectedReturnItem.id] || 0;
    return Math.max(1, originalQty - alreadyReturned);
  }, [selectedReturnItem, exchangedQtyMap]);

  const [returnQty, setReturnQty] = useState<number>(1);
  const [returnReason, setReturnReason] = useState<string>('Wrong Size / Variant');
  const [customReason, setCustomReason] = useState<string>('');
  const [restockCondition, setRestockCondition] = useState<'restock' | 'damaged'>('restock');

  // Form State - Replacement Item
  const [replacementSearch, setReplacementSearch] = useState<string>('');
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>('');
  const [replacementQty, setReplacementQty] = useState<number>(1);

  // Form State - Settlement
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'EcoCash' | 'Card'>('Cash');
  const [tenderedAmount, setTenderedAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Manager Authorization State
  const isCurrentUserManager =
    ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR', 'MANAGER', 'admin', 'manager', 'supervisor'].some(
      (r) => String(currentStaff.role || '').toLowerCase().includes(r.toLowerCase())
    );

  const [managerPin, setManagerPin] = useState<string>('');
  const [selectedManagerId, setSelectedManagerId] = useState<string>(() => {
    if (isCurrentUserManager) return currentStaff.id;
    return managers[0]?.id || '';
  });
  const [authError, setAuthError] = useState<string | null>(null);

  // Completed State & Printable Voucher
  const [completedRecord, setCompletedRecord] = useState<ItemExchangeRecord | null>(null);

  // Filtered replacement items
  const filteredReplacements = useMemo(() => {
    if (!replacementSearch.trim()) {
      return inventoryItems.slice(0, 8);
    }
    const q = replacementSearch.toLowerCase().trim();
    return inventoryItems
      .filter(
        (it: any) =>
          (it.itemName && it.itemName.toLowerCase().includes(q)) ||
          (it.name && it.name.toLowerCase().includes(q)) ||
          (it.barcode && it.barcode.toLowerCase().includes(q)) ||
          (it.sku && it.sku.toLowerCase().includes(q)) ||
          (it.itemId && it.itemId.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [inventoryItems, replacementSearch]);

  const selectedReplacement = useMemo(() => {
    return inventoryItems.find((it: any) => (it.itemId || it.id) === selectedReplacementId) || null;
  }, [inventoryItems, selectedReplacementId]);

  // Calculations
  const returnUnitPrice = selectedReturnItem ? Number(selectedReturnItem.price) || 0 : 0;
  const returnTotalCredit = Math.round(returnUnitPrice * returnQty * 100) / 100;

  const replacementUnitPrice = selectedReplacement
    ? Number(selectedReplacement.sellingPrice || selectedReplacement.price || 0)
    : 0;
  const replacementTotalCost = Math.round(replacementUnitPrice * replacementQty * 100) / 100;

  const netDifference = Math.round((replacementTotalCost - returnTotalCredit) * 100) / 100;

  const tenderedNum = parseFloat(tenderedAmount) || 0;
  const changeDue = netDifference > 0 && tenderedNum >= netDifference ? Math.round((tenderedNum - netDifference) * 100) / 100 : 0;

  // Submission handler
  const handleProcessExchange = () => {
    setAuthError(null);

    if (!selectedReturnItem) {
      setAuthError('Please select an item being returned.');
      return;
    }
    if (!selectedReplacement) {
      setAuthError('Please select a new replacement item from inventory.');
      return;
    }
    if (returnQty < 1 || returnQty > maxReturnQty) {
      setAuthError(`Return quantity must be between 1 and ${maxReturnQty}.`);
      return;
    }
    if (replacementQty < 1) {
      setAuthError('Replacement quantity must be at least 1.');
      return;
    }

    // Check manager authorization
    let authorizingManager: Salesperson = currentStaff;
    if (!isCurrentUserManager) {
      const targetMgr = managers.find((m: any) => m.id === selectedManagerId);
      if (!targetMgr) {
        setAuthError('Please select an authorizing supervisor or manager.');
        return;
      }
      const expectedPin = String(targetMgr.securityPin || targetMgr.pin || '1234').trim();
      const enteredPin = managerPin.trim();
      if (!enteredPin || enteredPin !== expectedPin) {
        setAuthError('Invalid supervisor/manager PIN. Please try again.');
        return;
      }
      authorizingManager = targetMgr;
    }

    const effectiveReason = returnReason === 'Other' ? (customReason.trim() || 'Other') : returnReason;

    const res = exchangeSaleItems({
      invoiceId: invoice.id,
      cashier: currentStaff,
      manager: authorizingManager,
      returnedItem: {
        id: selectedReturnItem.id,
        name: selectedReturnItem.name || selectedReturnItem.itemName || 'Item',
        price: returnUnitPrice,
        quantity: returnQty,
        totalCredit: returnTotalCredit,
        restockCondition,
        reason: effectiveReason,
      },
      replacementItem: {
        id: selectedReplacement.itemId || selectedReplacement.id,
        name: selectedReplacement.itemName || selectedReplacement.name || 'Replacement',
        price: replacementUnitPrice,
        quantity: replacementQty,
        totalCost: replacementTotalCost,
      },
      paymentMethod,
      tenderedAmount: tenderedNum > 0 ? tenderedNum : undefined,
      changeGiven: changeDue > 0 ? changeDue : undefined,
      notes: notes.trim() || undefined,
    });

    if (res.success && res.exchangeRecord) {
      setCompletedRecord(res.exchangeRecord);
      if (onExchangeSuccess) {
        onExchangeSuccess(res.exchangeRecord);
      }
    } else {
      setAuthError(res.message || 'Failed to complete exchange.');
    }
  };

  const handlePrintVoucher = async () => {
    if (!completedRecord) return;
    try {
      const compId = invoice.company_id || invoice.companyId || getCurrentCompanyId();
      const companies = getCompanies();
      const comp = companies.find((c: any) => c.company_id === compId || c.id === compId) || getCurrentCompany();
      const storeName = (comp as any)?.business_name || (comp as any)?.name || 'SAIMETRIC RETAIL';

      // Format voucher text for thermal printer
      const lines = [
        '================================',
        storeName.toUpperCase(),
        'ITEM EXCHANGE VOUCHER',
        '================================',
        `Voucher #: ${completedRecord.exchangeId}`,
        `Original Receipt: #${completedRecord.invoiceId}`,
        `Date: ${new Date(completedRecord.timestamp).toLocaleString()}`,
        `Cashier: ${completedRecord.cashierName}`,
        completedRecord.authorizedByName ? `Auth By: ${completedRecord.authorizedByName}` : '',
        '--------------------------------',
        'RETURNED ITEM:',
        ` ${completedRecord.returnedItem.name}`,
        ` Qty: ${completedRecord.returnedItem.quantity} @ $${completedRecord.returnedItem.price.toFixed(2)}`,
        ` Credit: -$${completedRecord.returnedItem.totalCredit.toFixed(2)}`,
        ` Reason: ${completedRecord.returnedItem.reason}`,
        ` Restock: ${completedRecord.returnedItem.restockCondition === 'restock' ? 'Restocked to Inventory' : 'Damaged / Write-Off'}`,
        '--------------------------------',
        'NEW REPLACEMENT ITEM:',
        ` ${completedRecord.replacementItem.name}`,
        ` Qty: ${completedRecord.replacementItem.quantity} @ $${completedRecord.replacementItem.price.toFixed(2)}`,
        ` Cost: +$${completedRecord.replacementItem.totalCost.toFixed(2)}`,
        '--------------------------------',
        `NET BALANCE: $${completedRecord.netDifference >= 0 ? '+' : ''}${completedRecord.netDifference.toFixed(2)}`,
        completedRecord.netDifference > 0
          ? `Tender: ${completedRecord.paymentMethod || 'Cash'}`
          : completedRecord.netDifference < 0
          ? 'Refunded from Till Drawer'
          : 'Even Exchange (No Money Due)',
        '================================',
        'Thank you for your business!',
        'Original sale lines remain immutable.',
        '================================',
      ].filter(Boolean);

      // Attempt thermal print, fallback to system print dialog
      await bluetoothPrinter.printReceipt(
        {
          id: completedRecord.exchangeId,
          companyId: compId,
          total: Math.abs(completedRecord.netDifference),
          currency: invoice.currency || 'USD',
          paymentMethod: completedRecord.paymentMethod || 'Cash',
          items: [
            {
              name: `[RETURN] ${completedRecord.returnedItem.name}`,
              quantity: completedRecord.returnedItem.quantity,
              price: -completedRecord.returnedItem.price,
            },
            {
              name: `[REPLACE] ${completedRecord.replacementItem.name}`,
              quantity: completedRecord.replacementItem.quantity,
              price: completedRecord.replacementItem.price,
            },
          ],
          customerName: invoice.customerName,
          staffName: completedRecord.cashierName,
        } as any,
        compId
      );
    } catch {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white">Item Exchange Workflow</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  Sale Immutable
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Receipt #{invoice.id} • Cashier: {invoice.staffName || 'Till'} • Customer: {invoice.customerName || 'Walk-in'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {completedRecord ? (
          /* Completion / Printable Voucher Screen */
          <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-in zoom-in-75">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-xl font-bold text-white">Item Exchange Completed Successfully!</h3>
              <p className="text-sm text-slate-400">
                Exchange Voucher #{completedRecord.exchangeId} has been linked to Receipt #{completedRecord.invoiceId}.
              </p>
            </div>

            {/* Voucher Summary Card */}
            <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 font-mono text-xs">
              <div className="border-b border-dashed border-slate-700 pb-3 text-center">
                <p className="font-bold text-white text-sm">EXCHANGE VOUCHER</p>
                <p className="text-slate-400 text-[11px] mt-0.5">Original Receipt #{completedRecord.invoiceId}</p>
                <p className="text-slate-500 text-[10px]">{new Date(completedRecord.timestamp).toLocaleString()}</p>
              </div>

              <div className="space-y-2 border-b border-dashed border-slate-700 pb-3">
                <div className="flex justify-between items-start text-rose-400">
                  <div>
                    <p className="font-bold">RETURNED (-):</p>
                    <p className="text-slate-300">
                      {completedRecord.returnedItem.quantity}x {completedRecord.returnedItem.name}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Reason: {completedRecord.returnedItem.reason} ({completedRecord.returnedItem.restockCondition === 'restock' ? 'Restocked' : 'Damaged'})
                    </p>
                  </div>
                  <span className="font-bold">-${completedRecord.returnedItem.totalCredit.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-start text-emerald-400 pt-1">
                  <div>
                    <p className="font-bold">ISSUED (+):</p>
                    <p className="text-slate-300">
                      {completedRecord.replacementItem.quantity}x {completedRecord.replacementItem.name}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Stock deducted from inventory
                    </p>
                  </div>
                  <span className="font-bold">+${completedRecord.replacementItem.totalCost.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-sm font-bold pt-1">
                <span className="text-white">NET BALANCE:</span>
                <span
                  className={
                    completedRecord.netDifference > 0
                      ? 'text-emerald-400'
                      : completedRecord.netDifference < 0
                      ? 'text-amber-400'
                      : 'text-blue-400'
                  }
                >
                  {completedRecord.netDifference > 0
                    ? `+$${completedRecord.netDifference.toFixed(2)} (Paid by Customer)`
                    : completedRecord.netDifference < 0
                    ? `-$${Math.abs(completedRecord.netDifference).toFixed(2)} (Refunded to Customer)`
                    : '$0.00 (Even Exchange)'}
                </span>
              </div>

              <div className="pt-2 text-[10px] text-slate-500 text-center">
                Cashier: {completedRecord.cashierName}
                {completedRecord.authorizedByName ? ` • Authorized by: ${completedRecord.authorizedByName}` : ''}
              </div>
            </div>

            <div className="flex items-center space-x-3 w-full max-w-md">
              <button
                type="button"
                onClick={handlePrintVoucher}
                className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center space-x-2 transition-colors shadow-lg shadow-indigo-600/30"
              >
                <Printer className="w-4 h-4" />
                <span>Print Exchange Voucher</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-3 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* 3-Step Exchange Form */
          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {/* Industry Standard Info Notice */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start space-x-3 text-xs text-slate-300">
              <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-white">Square / Lightspeed Standard Immutability:</span> Original sale lines and tender on completed invoices are locked for financial integrity. Exchanging an item restocks the return, depletes the replacement, settles any net difference in the cashier till, and links an audit exchange voucher.
              </div>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-center space-x-2 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{authError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* STEP 1: Select Item to Return */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-rose-600/30 border border-rose-500/40 text-rose-300 text-[10px] font-bold flex items-center justify-center">
                      1
                    </span>
                    <h3 className="text-sm font-bold text-white">Select Item to Return</h3>
                  </div>
                  <span className="text-[11px] text-slate-500">From Original Receipt</span>
                </div>

                {/* Original Items Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400">Purchased Item</label>
                  <select
                    value={selectedReturnItemId}
                    onChange={(e) => {
                      setSelectedReturnItemId(e.target.value);
                      setReturnQty(1);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {originalItems.map((it: any) => {
                      const already = exchangedQtyMap[it.id] || 0;
                      const remain = Math.max(0, (it.quantity || 1) - already);
                      return (
                        <option key={it.id} value={it.id} disabled={remain <= 0}>
                          {it.name || it.itemName} — ${Number(it.price || 0).toFixed(2)} (Qty: {remain} of {it.quantity} avail)
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Return Quantity */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-400">Return Quantity</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min={1}
                        max={maxReturnQty}
                        value={returnQty}
                        onChange={(e) => setReturnQty(Math.min(maxReturnQty, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-xs text-slate-500 whitespace-nowrap">/ {maxReturnQty} max</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-400">Return Credit</label>
                    <div className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-rose-400">
                      -${returnTotalCredit.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Return Reason */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400">Return Reason</label>
                  <select
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Wrong Size / Variant">Wrong Size / Variant</option>
                    <option value="Defective / Damaged">Defective / Damaged</option>
                    <option value="Customer Changed Mind">Customer Changed Mind</option>
                    <option value="Wrong Product Rang Up">Wrong Product Rang Up</option>
                    <option value="Customer Preference">Customer Preference</option>
                    <option value="Other">Other (Specify below)</option>
                  </select>
                  {returnReason === 'Other' && (
                    <input
                      type="text"
                      placeholder="Enter specific return reason..."
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      className="w-full mt-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>

                {/* Restock Condition */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-slate-400">Inventory Disposition</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRestockCondition('restock')}
                      className={`p-2 rounded-xl text-left border text-xs transition-all ${
                        restockCondition === 'restock'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <p className="font-bold flex items-center space-x-1">
                        <span>Restock</span>
                        {restockCondition === 'restock' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Good condition, +{returnQty} to stock</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRestockCondition('damaged')}
                      className={`p-2 rounded-xl text-left border text-xs transition-all ${
                        restockCondition === 'damaged'
                          ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <p className="font-bold flex items-center space-x-1">
                        <span>Write-Off</span>
                        {restockCondition === 'damaged' && <CheckCircle2 className="w-3 h-3 text-rose-400" />}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Defective, do not restock</p>
                    </button>
                  </div>
                </div>
              </div>

              {/* STEP 2: Select Replacement Item */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-[10px] font-bold flex items-center justify-center">
                      2
                    </span>
                    <h3 className="text-sm font-bold text-white">Select Replacement Item</h3>
                  </div>
                  <span className="text-[11px] text-slate-500">From Active Catalog</span>
                </div>

                {/* Replacement Search */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400">Search Replacement Product</label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Type name, barcode, or SKU..."
                      value={replacementSearch}
                      onChange={(e) => setReplacementSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Replacement Options List */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {filteredReplacements.map((it: any) => {
                    const id = it.itemId || it.id;
                    const name = it.itemName || it.name;
                    const price = Number(it.sellingPrice || it.price || 0);
                    const stock = (Number(it.stockCases || 0) * Number(it.unitsPerCase || 1)) + Number(it.stockSingles || 0);
                    const isSelected = selectedReplacementId === id;

                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedReplacementId(id)}
                        className={`w-full p-2 rounded-xl text-left border text-xs flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-indigo-950/70 border-indigo-500 text-white'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="truncate mr-2">
                          <p className="font-semibold text-white truncate">{name}</p>
                          <p className="text-[10px] text-slate-500">Stock: {stock} units</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold text-emerald-400">${price.toFixed(2)}</span>
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-indigo-400 ml-auto mt-0.5" />}
                        </div>
                      </button>
                    );
                  })}
                  {filteredReplacements.length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-4">No products found</p>
                  )}
                </div>

                {/* Replacement Quantity & Cost */}
                {selectedReplacement && (
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400">Issue Quantity</label>
                      <input
                        type="number"
                        min={1}
                        value={replacementQty}
                        onChange={(e) => setReplacementQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400">Replacement Cost</label>
                      <div className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-emerald-400">
                        +${replacementTotalCost.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* STEP 3: Net Difference & Settlement */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-amber-600/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center justify-center">
                    3
                  </span>
                  <h3 className="text-sm font-bold text-white">Net Settlement & Authorization</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Net Balance:</span>
                  <span
                    className={`text-base font-black font-mono ${
                      netDifference > 0
                        ? 'text-emerald-400'
                        : netDifference < 0
                        ? 'text-amber-400'
                        : 'text-blue-400'
                    }`}
                  >
                    {netDifference > 0
                      ? `+$${netDifference.toFixed(2)} (Customer Pays)`
                      : netDifference < 0
                      ? `-$${Math.abs(netDifference).toFixed(2)} (Refund to Customer)`
                      : '$0.00 (Even Exchange)'}
                  </span>
                </div>
              </div>

              {/* Settlement Method if Net Difference != 0 */}
              {netDifference > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-400">Customer Tender Method</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Cash', 'EcoCash', 'Card'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                            paymentMethod === method
                              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMethod === 'Cash' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-400">Amount Tendered</label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder={netDifference.toFixed(2)}
                          value={tenderedAmount}
                          onChange={(e) => setTenderedAmount(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-400">Change Due</label>
                        <div className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono font-bold text-amber-400">
                          ${changeDue.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : netDifference < 0 ? (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center space-x-2">
                  <RotateCcw className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>
                    Store owes customer <b>${Math.abs(netDifference).toFixed(2)}</b>. This will be automatically recorded as an exchange refund in the cashier's till drawer ledger.
                  </span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-800/60 text-xs text-blue-300 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-400" />
                  <span>
                    Even swap: Both items have equal value. No money will be added or removed from the cash drawer.
                  </span>
                </div>
              )}

              {/* Manager PIN Authorization */}
              <div className="pt-2 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                {isCurrentUserManager ? (
                  <div className="flex items-center space-x-2 text-xs text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Authorized directly by you as <b>{currentStaff.role}</b></span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-400">Authorizing Supervisor</label>
                      <select
                        value={selectedManagerId}
                        onChange={(e) => setSelectedManagerId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        {managers.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-400">Supervisor 4-Digit PIN</label>
                      <input
                        type="password"
                        maxLength={6}
                        placeholder="••••"
                        value={managerPin}
                        onChange={(e) => setManagerPin(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono tracking-widest text-center"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-400">Exchange Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Swapped for larger size as requested by customer"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        {!completedRecord && (
          <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleProcessExchange}
              className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-2 transition-colors shadow-lg shadow-indigo-600/30"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>Confirm & Process Exchange</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
