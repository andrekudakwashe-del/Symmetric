import React, { useState, useEffect } from 'react';
import { SaleInvoice } from '../../types';
import {
  X,
  Printer,
  Share2,
  Check,
  Download,
  Sparkles,
  Bluetooth,
  Settings,
  AlertCircle,
  ExternalLink,
  Info,
} from 'lucide-react';
import {
  bluetoothPrinter,
  getPrinterConfig,
  savePrinterConfig,
  PaperWidth,
  PrinterDeviceStatus,
  isRunningInIframe,
  isBluetoothPermissionsBlocked,
} from '../../services/bluetoothPrinter';
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
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(
    () => getPrinterConfig().paperWidth
  );
  const [printerStatus, setPrinterStatus] = useState<PrinterDeviceStatus>(() =>
    bluetoothPrinter.getStatus()
  );
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isPrintingBt, setIsPrintingBt] = useState(false);
  const [printStatusMsg, setPrintStatusMsg] = useState<{
    text: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  const isIframe = isRunningInIframe();

  useEffect(() => {
    const unsub = bluetoothPrinter.subscribe((status) => {
      setPrinterStatus(status);
    });
    return () => unsub();
  }, []);

  if (!isOpen || !invoice) return null;

  const handlePaperWidthChange = (w: PaperWidth) => {
    setPaperWidth(w);
    savePrinterConfig({ paperWidth: w });
    document.documentElement.style.setProperty('--receipt-width', w);
  };

  const handlePrint = () => {
    document.documentElement.style.setProperty('--receipt-width', paperWidth);
    window.print();
  };

  const handleBluetoothPrint = async () => {
    // If running in an iframe (e.g. preview pane), permissions policy blocks Web Bluetooth.
    // Seamlessly fallback to System thermal print and inform the user.
    if (isIframe) {
      setPrintStatusMsg({
        text: 'Preview mode: Direct Bluetooth is restricted in iframes. Using System Print...',
        type: 'info',
      });
      handlePrint();
      return;
    }

    try {
      setIsPrintingBt(true);
      setPrintStatusMsg({
        text: 'Connecting to Bluetooth thermal printer...',
        type: 'info',
      });

      await bluetoothPrinter.printReceipt({
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
        total: invoice.total,
        amountPaid: invoice.total,
        paymentMethod: invoice.paymentMethod,
        paperWidth: paperWidth,
      });

      setPrintStatusMsg({
        text: `✓ Printed successfully on ${paperWidth} thermal printer!`,
        type: 'success',
      });
      setTimeout(() => setPrintStatusMsg(null), 4000);
    } catch (err: any) {
      const isPolicy = isBluetoothPermissionsBlocked(err);
      const isCancelled =
        err?.name === 'NotFoundError' ||
        (typeof err?.message === 'string' &&
          err.message.toLowerCase().includes('cancelled'));

      if (isPolicy) {
        console.warn('Bluetooth restricted by browser permissions policy:', err?.message);
        setPrintStatusMsg({
          text: 'Bluetooth restricted in preview iframe. Opening System Print...',
          type: 'info',
        });
        handlePrint();
      } else if (isCancelled) {
        setPrintStatusMsg({
          text: 'Bluetooth pairing dialog was cancelled.',
          type: 'info',
        });
      } else {
        console.warn('Bluetooth print notice:', err?.message);
        setPrintStatusMsg({
          text: `Notice: ${err?.message || 'Printer unavailable'}`,
          type: 'error',
        });

        if (!bluetoothPrinter.isSupported()) {
          setTimeout(() => {
            handlePrint();
          }, 1200);
        }
      }
    } finally {
      setIsPrintingBt(false);
    }
  };

  const handleShareWhatsApp = () => {
    const text =
      `*SAIMETRIC OFFICIAL RECEIPT*\n` +
      `Invoice #: ${invoice.id}\n` +
      `Date: ${invoice.date}\n` +
      `Customer: ${invoice.customerName} (${invoice.customerId})\n` +
      `Staff: ${invoice.staffName}\n` +
      `-------------------------\n` +
      invoice.items
        .map((i) => `${i.name} x${i.quantity} = $${i.total.toFixed(2)}`)
        .join('\n') +
      `\n-------------------------\n` +
      `*Total: $${invoice.total.toFixed(2)}* (${invoice.paymentMethod})\n` +
      `Status: ${invoice.status}\n` +
      `Thank you for your business!`;

    window.open(
      `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn select-none">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[92vh] animate-scaleUp">
          {/* Top Action Bar */}
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-1.5">
                <Printer className="w-4 h-4 text-blue-400" />
                <span>Thermal Invoice Slip</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {paperWidth}
              </span>
            </div>

            <div className="flex items-center space-x-1">
              {isIframe && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-xl bg-blue-950/80 hover:bg-blue-900 border border-blue-700/60 text-blue-300 hover:text-white transition flex items-center space-x-1 text-[11px] font-bold px-2.5"
                  title="Open in new window for direct Bluetooth device pairing"
                >
                  <span>New Tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setShowConfigModal(true)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                title="Bluetooth Printer Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Iframe Preview Notice */}
          {isIframe && (
            <div className="bg-gradient-to-r from-blue-950/90 via-indigo-950/80 to-slate-900 px-4 py-2 border-b border-blue-900/50 flex items-center justify-between text-[11px] text-blue-200">
              <div className="flex items-center space-x-1.5 truncate">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">
                  Embedded preview blocks Web Bluetooth. Open in new tab for direct wireless print.
                </span>
              </div>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 font-bold text-blue-300 hover:text-white underline ml-2"
              >
                Launch Tab ↗
              </a>
            </div>
          )}

          {/* Paper Width & Quick Printer Bar */}
          <div className="bg-slate-950/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 text-xs">
            {/* 58mm vs 80mm Toggle */}
            <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => handlePaperWidthChange('58mm')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  paperWidth === '58mm'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                58mm Roll
              </button>
              <button
                type="button"
                onClick={() => handlePaperWidthChange('80mm')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  paperWidth === '80mm'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                80mm Roll
              </button>
            </div>

            {/* Bluetooth Quick Status */}
            <div className="flex items-center space-x-2">
              <div
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold ${
                  printerStatus.connected
                    ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <Bluetooth className="w-3.5 h-3.5 text-blue-400" />
                <span className="truncate max-w-[110px]">
                  {printerStatus.connected
                    ? printerStatus.deviceName || 'BT Connected'
                    : 'BT Paired/Ready'}
                </span>
              </div>
            </div>
          </div>

          {/* Status Message Notification */}
          {printStatusMsg && (
            <div
              className={`px-4 py-2 border-b text-xs flex items-center justify-between ${
                printStatusMsg.type === 'success'
                  ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
                  : printStatusMsg.type === 'error'
                  ? 'bg-rose-950/80 border-rose-800/80 text-rose-300'
                  : 'bg-blue-950/80 border-blue-800/80 text-blue-300'
              }`}
            >
              <span>{printStatusMsg.text}</span>
              <button
                onClick={() => setPrintStatusMsg(null)}
                className="text-slate-400 hover:text-white ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* The Printable Paper Receipt (Material Thermal Look) */}
          <div className="flex-1 overflow-y-auto p-4 bg-slate-950/50 flex justify-center">
            <div
              id="thermal-receipt-print"
              className={`bg-white text-slate-950 rounded-2xl p-4 shadow-lg border border-slate-200 font-mono-num text-xs relative overflow-hidden transition-all ${
                paperWidth === '80mm'
                  ? 'w-full max-w-[360px]'
                  : 'w-full max-w-[280px]'
              }`}
            >
              {/* Top Logo */}
              <div className="text-center pb-2.5 border-b border-dashed border-slate-400">
                <h2 className="text-sm font-black tracking-wider uppercase font-sans">
                  SAIMETRIC ENERGY
                </h2>
                <p className="text-[10px] text-slate-600 font-sans">
                  Harare Commercial Hub • Reg #2026/09
                </p>
                <p className="text-[10px] text-slate-600 font-sans">
                  Tel: +263 77 123 4567 • info@saimetric.co.zw
                </p>
              </div>

              {/* Receipt Metadata */}
              <div className="py-2 border-b border-dashed border-slate-400 text-[11px] space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-slate-600">INVOICE:</span>
                  <span className="font-bold">{invoice.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">DATE / TIME:</span>
                  <span>
                    {new Date(invoice.timestamp || invoice.date).toLocaleString([], {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">CUSTOMER:</span>
                  <span className="font-bold truncate max-w-[150px]">
                    {invoice.customerName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">CASHIER:</span>
                  <span>{invoice.staffName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">PAY METHOD:</span>
                  <span className="font-bold">{invoice.paymentMethod}</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>FORMAT:</span>
                  <span>{paperWidth} Thermal ESC/POS</span>
                </div>
              </div>

              {/* Status Stamp for Refunded or Voided */}
              {invoice.status === 'Refunded' && (
                <div className="my-2 p-2 border-2 border-amber-600 rounded-lg text-center bg-amber-50">
                  <div className="text-xs font-black text-amber-800 tracking-wider">*** REFUNDED INVOICE ***</div>
                  {invoice.refundReason && <div className="text-[10px] text-amber-700 font-medium">Reason: {invoice.refundReason}</div>}
                  {invoice.refundApprovedBy && <div className="text-[10px] text-amber-700 font-medium">Authorized: {invoice.refundApprovedBy}</div>}
                </div>
              )}
              {invoice.status === 'Voided' && (
                <div className="my-2 p-2 border-2 border-rose-600 rounded-lg text-center bg-rose-50">
                  <div className="text-xs font-black text-rose-800 tracking-wider">*** VOIDED TRANSACTION ***</div>
                  {invoice.voidReason && <div className="text-[10px] text-rose-700 font-medium">Reason: {invoice.voidReason}</div>}
                  {invoice.voidApprovedBy && <div className="text-[10px] text-rose-700 font-medium">Authorized: {invoice.voidApprovedBy}</div>}
                </div>
              )}

              {/* Items Table */}
              <div className="py-2 border-b border-dashed border-slate-400">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-slate-600 border-b border-slate-300 pb-1">
                      <th>ITEM</th>
                      <th className="text-center">QTY</th>
                      <th className="text-right">PRICE</th>
                      <th className="text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.items.map((item, idx) => (
                      <tr key={idx} className="py-1">
                        <td className="py-1 pr-1 font-sans font-medium text-[10px] leading-tight">
                          {item.name}
                        </td>
                        <td className="py-1 text-center font-bold">
                          {item.quantity % 1 === 0
                            ? item.quantity
                            : item.quantity.toFixed(2)}
                        </td>
                        <td className="py-1 text-right text-slate-600 font-mono-num">
                          ${item.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-1 text-right font-bold font-mono-num">
                          ${item.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Breakdown */}
              <div className="py-2 border-b border-dashed border-slate-400 space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-600">SUBTOTAL:</span>
                  <span className="font-mono-num">${invoice.subtotal.toFixed(2)}</span>
                </div>
                {invoice.discount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>DISCOUNT:</span>
                    <span className="font-mono-num">
                      -${invoice.discount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black pt-1 border-t border-slate-300">
                  <span>TOTAL DUE:</span>
                  <span className="font-mono-num">${invoice.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Simulated Barcode */}
              <div className="pt-2.5 text-center">
                <div className="h-7 w-3/4 mx-auto bg-slate-950 flex items-center justify-around px-2 py-0.5 rounded">
                  <div className="h-full w-1 bg-white" />
                  <div className="h-full w-2 bg-white" />
                  <div className="h-full w-0.5 bg-white" />
                  <div className="h-full w-1.5 bg-white" />
                  <div className="h-full w-0.5 bg-white" />
                  <div className="h-full w-2 bg-white" />
                  <div className="h-full w-1 bg-white" />
                </div>
                <p className="text-[9px] text-slate-500 mt-1 font-mono-num">
                  {invoice.id} • SYNCED TO ROOM DB & SHEETS
                </p>
                <p className="text-[9px] font-sans text-slate-700 mt-0.5 font-semibold">
                  Thank you for choosing SAIMETRIC!
                </p>
              </div>
            </div>
          </div>

          {/* Footer Actions: Bluetooth Print & System Print */}
          <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-2">
            <div className="flex items-center space-x-2">
              {/* Main Action: Bluetooth Print */}
              <button
                id="btn-bluetooth-print-receipt"
                type="button"
                onClick={handleBluetoothPrint}
                disabled={isPrintingBt}
                className="flex-1 py-3 px-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black flex items-center justify-center space-x-2 shadow-lg active:scale-95 disabled:opacity-50 transition"
              >
                <Bluetooth className="w-4 h-4 animate-pulse" />
                <span>
                  {isPrintingBt
                    ? 'Sending to Printer...'
                    : `Print Bluetooth (${paperWidth})`}
                </span>
              </button>

              {/* Secondary: Browser System Print Dialog */}
              <button
                id="btn-print-receipt"
                type="button"
                onClick={handlePrint}
                className="py-3 px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 border border-slate-700 active:scale-95 transition"
                title="Print via standard System Print dialog (USB / WiFi / PDF)"
              >
                <Printer className="w-4 h-4" />
                <span>System</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button
                id="btn-share-receipt"
                type="button"
                onClick={handleShareWhatsApp}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-1.5 shadow transition"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>WhatsApp Slip</span>
              </button>

              <button
                type="button"
                onClick={() => setShowConfigModal(true)}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center space-x-1.5 border border-slate-700 transition"
              >
                <Settings className="w-3.5 h-3.5 text-blue-400" />
                <span>Setup Printer</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bluetooth Printer Setup Modal */}
      {showConfigModal && (
        <BluetoothPrinterModal
          isOpen={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            setPaperWidth(getPrinterConfig().paperWidth);
          }}
        />
      )}
    </>
  );
};

