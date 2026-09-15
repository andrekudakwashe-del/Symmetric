import React, { useState, useEffect, useRef } from 'react';
import { SaleInvoice } from '../../types';
import {
  X,
  Printer,
  Share2,
  CheckCircle2,
  Settings,
  Banknote,
  CreditCard,
  Smartphone,
  ArrowRight,
  ExternalLink,
  Check,
  Clock,
  Radio,
  WifiOff,
  Bluetooth,
} from 'lucide-react';
import {
  bluetoothPrinter,
  getPrinterConfig,
  savePrinterConfig,
  PaperWidth,
  BluetoothPrinterConfig,
  PrinterDeviceStatus,
  QueuedPrintJob,
  isRunningInIframe,
  isBluetoothPermissionsBlocked,
} from '../../services/bluetoothPrinter';
import {
  getCurrentCompany,
  getCurrentBranch,
  getCompanies,
  getBranches,
} from '../../db/roomDatabase';
import { BluetoothPrinterModal } from './BluetoothPrinterModal';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: SaleInvoice | null;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  invoice,
}) => {
  const invoiceCompanyId = invoice?.company_id || invoice?.companyId;
  const companiesList = getCompanies();
  const invoiceCompany =
    (invoiceCompanyId ? companiesList.find((c) => c.company_id === invoiceCompanyId) : null) ||
    getCurrentCompany();
  const branchesList = getBranches();
  const invoiceBranch =
    (invoice?.branch_id || invoice?.branchId
      ? branchesList.find((b) => b.branchId === (invoice.branch_id || invoice.branchId))
      : null) || getCurrentBranch();

  const [printerConfig, setPrinterConfig] = useState<BluetoothPrinterConfig>(() =>
    getPrinterConfig(invoiceCompanyId)
  );
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(
    () => printerConfig.paperWidth
  );
  const [printerStatus, setPrinterStatus] = useState<PrinterDeviceStatus>(() =>
    bluetoothPrinter.getStatus()
  );
  const [queuedJobs, setQueuedJobs] = useState<QueuedPrintJob[]>(() =>
    bluetoothPrinter.getPrintQueue()
  );
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccessToast, setPrintSuccessToast] = useState<string | null>(null);

  const isIframe = isRunningInIframe();
  const autoPrintedRef = useRef<string | null>(null);

  // Sync printer configuration whenever company or modal opens
  useEffect(() => {
    if (isOpen && invoice) {
      const activeCompId = invoice.company_id || invoice.companyId;
      const cfg = getPrinterConfig(activeCompId);
      setPrinterConfig(cfg);
      setPaperWidth(cfg.paperWidth);
    }
  }, [isOpen, invoice?.id, invoice?.company_id, showConfigModal]);

  // Subscribe to live printer status (connection state, reconnecting)
  useEffect(() => {
    const unsub = bluetoothPrinter.subscribe((status) => {
      setPrinterStatus(status);
    });
    return () => unsub();
  }, []);

  // Subscribe to live print queue (detects automatic printing when printer is turned on)
  useEffect(() => {
    const unsub = bluetoothPrinter.subscribeQueue((queue, lastProcessed) => {
      setQueuedJobs(queue);
      if (lastProcessed && lastProcessed.invoiceId === invoice?.id) {
        setPrintSuccessToast(
          `✓ Printer turned on: Auto-printed receipt for Invoice #${lastProcessed.invoiceId}!`
        );
        setTimeout(() => setPrintSuccessToast(null), 5000);
      }
    });
    return () => unsub();
  }, [invoice?.id]);

  // Automatic Printing on checkout if configured
  useEffect(() => {
    if (isOpen && invoice && invoice.id && autoPrintedRef.current !== invoice.id) {
      autoPrintedRef.current = invoice.id;
      const cfg = getPrinterConfig(invoice.company_id || invoice.companyId);
      if (cfg.autoPrintOnCheckout) {
        const timer = setTimeout(() => {
          handlePrintReceipt();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, invoice?.id]);

  if (!isOpen || !invoice) return null;

  // Tendered and Change calculations ensuring customer change is ALWAYS accurate
  const effectivePaid =
    invoice.cashTendered !== undefined && invoice.cashTendered > 0
      ? invoice.cashTendered
      : invoice.paymentMethod === 'Cash'
      ? invoice.total
      : invoice.total;

  const effectiveChange =
    invoice.changeDue !== undefined
      ? invoice.changeDue
      : invoice.cashTendered !== undefined && invoice.cashTendered > invoice.total
      ? Math.max(0, invoice.cashTendered - invoice.total)
      : 0;

  // Dynamically resolve exact company & branch details for this invoice
  const isPrinterContaminated = Boolean(
    printerConfig.storeName &&
    printerConfig.storeName.toLowerCase().includes('chapwanya') &&
    !(invoice.companyName || invoiceCompany?.company_name || '').toLowerCase().includes('chapwanya')
  );

  const effectiveStoreName =
    invoice.companyName ||
    invoiceCompany?.company_name ||
    (!isPrinterContaminated && printerConfig.storeName) ||
    'SAIMETRIC POS';

  const effectiveBranchName =
    invoice.branchName ||
    invoiceBranch?.name ||
    (invoiceBranch as any)?.branch_name ||
    (!isPrinterContaminated && printerConfig.branchName) ||
    'Main Branch';

  const effectiveAddress =
    invoiceBranch?.location ||
    (invoiceBranch as any)?.address ||
    (invoiceBranch as any)?.branch_address ||
    (!isPrinterContaminated && printerConfig.storeAddress) ||
    (invoiceCompany as any)?.address ||
    '4th Street Commercial Center, Harare';

  const effectivePhone =
    invoiceBranch?.phone ||
    (!isPrinterContaminated && printerConfig.storePhone) ||
    invoiceCompany?.phone ||
    '';

  const effectiveEmail =
    invoiceCompany?.owner_email || (!isPrinterContaminated && printerConfig.storeEmail) || '';

  const effectiveTaxNumber =
    (invoiceCompany as any)?.tax_number ||
    (invoiceCompany as any)?.taxNumber ||
    printerConfig.taxNumber ||
    'VAT-2026/09';

  const isCurrentJobQueued = queuedJobs.some(
    (j) => j.invoiceId === invoice.id && j.status !== 'completed'
  );

  const handlePaperWidthChange = (w: PaperWidth) => {
    setPaperWidth(w);
    savePrinterConfig({ paperWidth: w }, invoiceCompanyId);
    document.documentElement.style.setProperty('--receipt-width', w);
  };

  const handleSystemPrint = () => {
    document.documentElement.style.setProperty('--receipt-width', paperWidth);
    window.print();
  };

  const handlePrintReceipt = async () => {
    if (isIframe) {
      handleSystemPrint();
      return;
    }

    try {
      setIsPrinting(true);
      const res = await bluetoothPrinter.printReceipt(
        {
          invoiceId: invoice.id,
          date: invoice.timestamp || invoice.date || new Date().toLocaleString(),
          cashierName: invoice.staffName || 'Cashier',
          customerName: invoice.customerName,
          items: invoice.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
          })),
          subtotal: invoice.subtotal,
          discount: invoice.discount,
          tax: invoice.tax,
          total: invoice.total,
          amountPaid: effectivePaid,
          change: effectiveChange,
          paymentMethod: invoice.paymentMethod,
          paperWidth: paperWidth,
          companyId: invoiceCompanyId,
          storeName: effectiveStoreName,
          branchName: effectiveBranchName,
          storeAddress: effectiveAddress,
          storePhone: effectivePhone,
        },
        { companyId: invoiceCompanyId, allowQueue: true }
      );

      if (res.queued) {
        setPrintSuccessToast(
          '⏳ Printer is turned off. Receipt queued — it will automatically print as soon as you turn the printer on!'
        );
        setTimeout(() => setPrintSuccessToast(null), 6000);
      } else {
        setPrintSuccessToast('✓ Receipt printed to thermal printer!');
        setTimeout(() => setPrintSuccessToast(null), 3000);
      }
    } catch (err: any) {
      console.warn('Bluetooth print error, falling back to system print:', err);
      handleSystemPrint();
    } finally {
      setIsPrinting(false);
    }
  };

  const handleShareWhatsApp = () => {
    const text =
      `*${effectiveStoreName.toUpperCase()} OFFICIAL RECEIPT*\n` +
      (effectiveBranchName ? `${effectiveBranchName}\n` : '') +
      `Invoice #: ${invoice.id}\n` +
      `Date: ${invoice.date}\n` +
      `Customer: ${invoice.customerName || 'Walk-in Customer'}\n` +
      `Cashier: ${invoice.staffName}\n` +
      `-------------------------\n` +
      invoice.items
        .map((i) => `${i.name} x${i.quantity} = $${i.total.toFixed(2)}`)
        .join('\n') +
      `\n-------------------------\n` +
      `Subtotal: $${invoice.subtotal.toFixed(2)}\n` +
      (invoice.discount > 0 ? `Discount: -$${invoice.discount.toFixed(2)}\n` : '') +
      `*TOTAL: $${invoice.total.toFixed(2)}* (${invoice.paymentMethod})\n` +
      (invoice.paymentMethod === 'Cash' || effectivePaid > 0
        ? `Tendered: $${effectivePaid.toFixed(2)}\n*CHANGE DUE: $${effectiveChange.toFixed(2)}*\n`
        : '') +
      `Status: Completed\n` +
      `Thank you for your business!`;

    window.open(
      `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn select-none">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden text-slate-900 flex flex-col max-h-[92vh] border border-slate-200 animate-scaleUp">
          
          {/* 1. Header: Friendly Sale Completion Status */}
          <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 leading-tight">
                  Sale Receipt Preview
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  Invoice #{invoice.id} • {effectiveStoreName}
                </p>
              </div>
            </div>

            {/* Quick Actions & Close */}
            <div className="flex items-center space-x-1.5">
              {/* Paper Width Switcher */}
              <div className="bg-slate-200/80 p-0.5 rounded-lg flex items-center text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => handlePaperWidthChange('58mm')}
                  className={`px-2 py-0.5 rounded-md transition ${
                    paperWidth === '58mm'
                      ? 'bg-white text-slate-900 shadow-xs font-black'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  58mm
                </button>
                <button
                  type="button"
                  onClick={() => handlePaperWidthChange('80mm')}
                  className={`px-2 py-0.5 rounded-md transition ${
                    paperWidth === '80mm'
                      ? 'bg-white text-slate-900 shadow-xs font-black'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  80mm
                </button>
              </div>

              {/* Printer Settings Gear */}
              <button
                type="button"
                onClick={() => setShowConfigModal(true)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                title="Bluetooth Printer Setup & Automatic Connection"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2. Highlights Banner (Customer Change Due Summary) */}
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 px-5 py-3 border-b border-emerald-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 block">
                Total Paid ({invoice.paymentMethod})
              </span>
              <span className="text-xl font-black font-mono-num text-slate-950">
                ${invoice.total.toFixed(2)}
              </span>
            </div>

            {/* Prominent Change Due Pill for Cash Sales */}
            {(invoice.paymentMethod === 'Cash' || effectivePaid > 0) && (
              <div className="text-right">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 block">
                  Change Due to Customer
                </span>
                <span className="text-xl font-black font-mono-num text-emerald-700">
                  ${effectiveChange.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Persistent Printer & Auto-Print Queue Status Banner */}
          {isCurrentJobQueued ? (
            <div className="bg-amber-500 text-white px-4 py-2 text-xs font-bold flex items-center justify-between animate-fadeIn">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 animate-spin" />
                <span>Printer is turned off. Receipt queued &amp; will auto-print when powered on!</span>
              </div>
            </div>
          ) : !printerStatus.isRadioAvailable ? (
            <div className="bg-amber-50 text-amber-900 px-4 py-1.5 text-[11px] font-medium border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Bluetooth className="w-3.5 h-3.5 text-amber-600" />
                <span>Phone Bluetooth is OFF. Turn ON in settings to auto-print</span>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(true)}
                className="text-amber-800 hover:text-amber-950 underline text-[10px] font-bold"
              >
                Setup
              </button>
            </div>
          ) : printerStatus.connected ? (
            <div className="bg-emerald-50 text-emerald-800 px-4 py-1.5 text-[11px] font-medium border-b border-emerald-100 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Connected: <b>{printerStatus.deviceName || 'Thermal Printer'}</b></span>
              </div>
              <span className="text-emerald-700 text-[10px] font-semibold">Ready</span>
            </div>
          ) : printerStatus.savedDeviceName ? (
            <div className="bg-indigo-50 text-indigo-900 px-4 py-1.5 text-[11px] font-medium border-b border-indigo-100 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Radio className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                <span>Saved Printer: <b>{printerStatus.savedDeviceName}</b></span>
              </div>
              <span className="text-indigo-600 text-[10px] font-semibold">
                {printerStatus.isReconnecting ? 'Auto-reconnecting...' : 'Auto-connects when turned on'}
              </span>
            </div>
          ) : null}

          {/* Print Success Toast */}
          {printSuccessToast && (
            <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between animate-fadeIn shadow-md">
              <span>{printSuccessToast}</span>
              <button onClick={() => setPrintSuccessToast(null)} className="text-white/80 hover:text-white ml-2">✕</button>
            </div>
          )}

          {/* 3. The Actual Paper Receipt Canvas */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-100/80 flex justify-center items-start">
            <div
              id="thermal-receipt-print"
              className={`bg-white text-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200/90 font-mono-num text-xs relative transition-all ${
                paperWidth === '80mm'
                  ? 'w-full max-w-[360px]'
                  : 'w-full max-w-[290px]'
              }`}
            >
              {/* Receipt Header: Company Branding Scoped to this Invoice */}
              <div className="text-center pb-3 border-b border-dashed border-slate-300">
                <h2 className="text-base font-black tracking-wider uppercase font-sans text-slate-900">
                  {effectiveStoreName}
                </h2>
                {effectiveBranchName && (
                  <p className="text-xs font-bold text-slate-700 font-sans mt-0.5">
                    {effectiveBranchName}
                  </p>
                )}
                {effectiveAddress && (
                  <p className="text-[11px] text-slate-500 font-sans mt-0.5">
                    {effectiveAddress}
                  </p>
                )}
                {(effectivePhone || effectiveEmail) && (
                  <p className="text-[10px] text-slate-500 font-sans">
                    {[effectivePhone && `Tel: ${effectivePhone}`, effectiveEmail]
                      .filter(Boolean)
                      .join(' • ')}
                  </p>
                )}
                {effectiveTaxNumber && (
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    TIN / VAT: {effectiveTaxNumber}
                  </p>
                )}
              </div>

              {/* Receipt Meta (Date, Invoice #, Cashier, Customer) */}
              <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">INVOICE:</span>
                  <span className="font-bold font-mono">{invoice.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">DATE:</span>
                  <span>
                    {new Date(invoice.timestamp || invoice.date).toLocaleString([], {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">CUSTOMER:</span>
                  <span className="font-bold truncate max-w-[170px]">
                    {invoice.customerName || 'Walk-in Customer'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">CASHIER:</span>
                  <span>{invoice.staffName || 'Staff'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">PAY METHOD:</span>
                  <span className="font-bold text-slate-800">{invoice.paymentMethod}</span>
                </div>
              </div>

              {/* Items List Table */}
              <div className="py-2.5 border-b border-dashed border-slate-300">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-200 pb-1 font-sans text-[10px] uppercase font-bold">
                      <th className="pb-1">Item</th>
                      <th className="text-center pb-1">Qty</th>
                      <th className="text-right pb-1">Price</th>
                      <th className="text-right pb-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.items.map((item, idx) => (
                      <tr key={idx} className="py-1">
                        <td className="py-1 pr-1 font-sans text-slate-800 font-medium">
                          {item.name}
                        </td>
                        <td className="py-1 px-1 text-center font-mono text-slate-600">
                          {item.quantity}
                        </td>
                        <td className="py-1 px-1 text-right font-mono text-slate-600">
                          ${item.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-1 pl-1 text-right font-mono font-bold text-slate-900">
                          ${item.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals & Calculations */}
              <div className="py-2.5 border-b border-dashed border-slate-300 text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span className="font-sans">Subtotal:</span>
                  <span>${invoice.subtotal.toFixed(2)}</span>
                </div>

                {invoice.discount > 0 && (
                  <div className="flex justify-between text-rose-600 font-bold">
                    <span className="font-sans">Discount:</span>
                    <span>-${invoice.discount.toFixed(2)}</span>
                  </div>
                )}

                {invoice.tax && invoice.tax > 0 ? (
                  <div className="flex justify-between text-slate-600">
                    <span className="font-sans">Tax (VAT):</span>
                    <span>${invoice.tax.toFixed(2)}</span>
                  </div>
                ) : null}

                <div className="flex justify-between text-sm font-black pt-1.5 border-t border-slate-200 text-slate-950 font-sans">
                  <span>TOTAL DUE:</span>
                  <span className="font-mono text-base">${invoice.total.toFixed(2)}</span>
                </div>

                {/* Tendered & Change Calculation */}
                {(invoice.paymentMethod === 'Cash' || effectivePaid > 0) && (
                  <div className="pt-2 border-t border-slate-100 space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-600">
                      <span className="font-sans">Amount Tendered:</span>
                      <span>${effectivePaid.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between text-emerald-700 font-black text-xs py-0.5 bg-emerald-50/60 px-1.5 rounded-sm">
                      <span className="font-sans uppercase">Change Due:</span>
                      <span>${effectiveChange.toFixed(2)}</span>
                    </div>

                    {invoice.changeLeftBehind && (
                      <div className="text-[10px] text-amber-700 italic text-right">
                        Customer opted to store change in Credit Fund
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Receipt Footer Barcode & Friendly Message */}
              <div className="pt-2 text-center border-t border-dashed border-slate-300 space-y-1.5">
                {/* Simulated Barcode */}
                <div className="h-6 w-3/4 mx-auto bg-slate-900 flex items-center justify-around px-2 py-0.5 rounded-xs">
                  <div className="h-full w-1 bg-white" />
                  <div className="h-full w-2 bg-white" />
                  <div className="h-full w-0.5 bg-white" />
                  <div className="h-full w-1.5 bg-white" />
                  <div className="h-full w-0.5 bg-white" />
                  <div className="h-full w-2 bg-white" />
                  <div className="h-full w-1 bg-white" />
                </div>

                <p className="text-[10px] font-sans font-semibold text-slate-700">
                  {printerConfig.footerNote || 'Thank you for your business!'}
                </p>
                <p className="text-[9px] text-slate-400 font-mono">
                  Powered by {effectiveStoreName}
                </p>
              </div>
            </div>
          </div>

          {/* 5. User-Friendly Action Bar: Quick Print, Share & Done */}
          <div className="p-4 bg-white border-t border-slate-200 space-y-2.5">
            <div className="flex items-center space-x-2.5">
              {/* Primary Action: Big "Print Receipt" Button */}
              <button
                id="btn-print-receipt"
                type="button"
                onClick={handlePrintReceipt}
                disabled={isPrinting}
                className="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm tracking-wide shadow-lg shadow-blue-600/25 flex items-center justify-center space-x-2 transition transform active:scale-95 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>
                  {isPrinting
                    ? 'Printing...'
                    : isCurrentJobQueued
                    ? 'Queued (Auto-Prints on Power On)'
                    : `Print Receipt (${paperWidth})`}
                </span>
              </button>

              {/* WhatsApp Share Button */}
              <button
                id="btn-share-receipt"
                type="button"
                onClick={handleShareWhatsApp}
                className="py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-sm flex items-center justify-center space-x-1.5 shadow-md shadow-emerald-600/20 transition transform active:scale-95"
                title="Send receipt slip via WhatsApp"
              >
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </button>
            </div>

            {/* "Done / Next Sale" Button */}
            <button
              id="btn-done-receipt"
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center space-x-1.5 transition active:scale-98"
            >
              <span>Done &bull; Start Next Sale</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>
      </div>

      {/* Printer Setup Modal (Only opened when user explicitly clicks the Settings gear icon) */}
      {showConfigModal && (
        <BluetoothPrinterModal
          isOpen={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            if (invoice) {
              const cfg = getPrinterConfig(invoice.company_id || invoice.companyId);
              setPrinterConfig(cfg);
              setPaperWidth(cfg.paperWidth);
            }
          }}
        />
      )}
    </>
  );
};
