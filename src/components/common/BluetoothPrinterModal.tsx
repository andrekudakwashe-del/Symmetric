import React, { useState, useEffect } from 'react';
import {
  bluetoothPrinter,
  getPrinterConfig,
  savePrinterConfig,
  PaperWidth,
  PrinterDeviceStatus,
  isRunningInIframe,
  isBluetoothPermissionsBlocked,
} from '../../services/bluetoothPrinter';
import {
  Bluetooth,
  Printer,
  CheckCircle2,
  XCircle,
  Settings,
  RefreshCw,
  Zap,
  Info,
  Sliders,
  Scissors,
  Store,
  MapPin,
  Phone,
  ExternalLink,
} from 'lucide-react';

interface BluetoothPrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPrintTest?: () => void;
}

export const BluetoothPrinterModal: React.FC<BluetoothPrinterModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [status, setStatus] = useState<PrinterDeviceStatus>(() =>
    bluetoothPrinter.getStatus()
  );
  const [config, setConfig] = useState(() => getPrinterConfig());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const isSupported = bluetoothPrinter.isSupported();
  const isIframe = isRunningInIframe();

  useEffect(() => {
    const unsub = bluetoothPrinter.subscribe((s) => {
      setStatus(s);
    });
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const handleConnect = async () => {
    if (isIframe) {
      setErrorMsg(
        'Web Bluetooth is restricted inside embedded preview frames by browser policy. Please click "Open App in Full Browser Tab" above to pair your printer.'
      );
      return;
    }

    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsBusy(true);
      await bluetoothPrinter.connect();
      setSuccessMsg(
        `Connected to ${bluetoothPrinter.getConnectedDeviceName() || 'Thermal Printer'}!`
      );
    } catch (err: any) {
      const isPolicy = isBluetoothPermissionsBlocked(err);
      if (isPolicy) {
        console.warn('Bluetooth restricted by permissions policy:', err?.message);
        setErrorMsg(
          'Web Bluetooth access is disallowed inside this embedded preview frame by browser policy. Please open in a dedicated tab.'
        );
      } else {
        const isCancelled =
          err?.name === 'NotFoundError' ||
          (typeof err?.message === 'string' &&
            err.message.toLowerCase().includes('cancelled'));

        if (isCancelled) {
          setErrorMsg('Device selection dialog was closed without selecting a printer.');
        } else {
          console.warn('Bluetooth connection error:', err?.message);
          setErrorMsg(
            err.message || 'Bluetooth connection failed. Ensure printer is on and in range.'
          );
        }
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await bluetoothPrinter.disconnect();
      setSuccessMsg('Printer disconnected.');
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handlePaperWidth = (width: PaperWidth) => {
    const updated = savePrinterConfig({ paperWidth: width });
    setConfig(updated);
    document.documentElement.style.setProperty('--receipt-width', width);
  };

  const handleUpdateConfig = (updates: Partial<typeof config>) => {
    const updated = savePrinterConfig(updates);
    setConfig(updated);
  };

  const handleTestPrint = async () => {
    if (isIframe) {
      setErrorMsg(
        'Direct Bluetooth test print is restricted in embedded preview. Open in a full browser tab to test Bluetooth ESC/POS printing.'
      );
      return;
    }

    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsBusy(true);

      await bluetoothPrinter.printReceipt({
        invoiceId: 'TEST-' + Math.floor(1000 + Math.random() * 9000),
        date: new Date().toLocaleString(),
        cashierName: 'Admin / POS Test',
        customerName: 'Sample Customer',
        items: [
          { name: 'Solar Inverter 5kVA', quantity: 1, unitPrice: 420.0, total: 420.0 },
          { name: 'Lithium Battery 48V', quantity: 1, unitPrice: 650.0, total: 650.0 },
          { name: 'Solar Cable 6mm (m)', quantity: 20, unitPrice: 1.5, total: 30.0 },
        ],
        subtotal: 1100.0,
        discount: 20.0,
        total: 1080.0,
        amountPaid: 1100.0,
        change: 20.0,
        paymentMethod: 'Cash (USD)',
        paperWidth: config.paperWidth,
      });

      setSuccessMsg(`✓ Test receipt printed successfully on ${config.paperWidth}!`);
    } catch (err: any) {
      const isPolicy = isBluetoothPermissionsBlocked(err);
      if (isPolicy) {
        console.warn('Bluetooth test print disallowed by browser policy:', err?.message);
        setErrorMsg(
          'Bluetooth is restricted inside embedded previews. Open app in a new tab to test.'
        );
      } else {
        console.warn('Test print notice:', err?.message);
        setErrorMsg(err.message || 'Failed to print test slip.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900/60 via-indigo-900/50 to-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Bluetooth className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">
                Bluetooth Thermal Printer
              </h2>
              <p className="text-xs text-slate-400">
                Web Bluetooth ESC/POS for 58mm & 80mm Rollers
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isIframe && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-1 transition shadow"
                title="Launch app in dedicated tab to access Web Bluetooth"
              >
                <span>Open in Tab</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-slate-200">
          {/* Iframe Preview Notice */}
          {isIframe && (
            <div className="bg-amber-950/40 border border-amber-500/30 p-4 rounded-2xl text-xs text-amber-200 flex items-start space-x-3">
              <Info className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="font-bold text-amber-300">Embedded Preview Restriction</p>
                <p className="text-amber-200/90 leading-relaxed text-[11px]">
                  Web browsers block Bluetooth pairing inside embedded preview frames by security policy. To scan, pair, or print directly to your Bluetooth thermal printer, launch the app in a dedicated browser tab.
                </p>
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-bold text-xs transition"
                >
                  <span>Open App in Dedicated Tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* Browser Support Warning */}
          {!isSupported && (
            <div className="bg-rose-950/50 border border-rose-800/80 p-4 rounded-2xl text-xs text-rose-300 flex items-start space-x-3">
              <Info className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
              <div>
                <p className="font-bold mb-1">Web Bluetooth Not Detected</p>
                <p className="text-rose-300/80 leading-relaxed">
                  Your current browser does not have Web Bluetooth enabled. For direct wireless printing without drivers, please use <strong>Google Chrome</strong> (Android or Desktop) or <strong>Microsoft Edge</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Connection Status Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-3 w-full sm:w-auto">
              <div
                className={`w-3 h-3 rounded-full ${
                  status.connected
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-slate-600'
                }`}
              />
              <div>
                <p className="text-xs font-bold text-white">
                  {status.connected
                    ? `Connected: ${status.deviceName || 'Wireless Thermal Printer'}`
                    : 'Printer Disconnected'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {status.connected
                    ? 'GATT ESC/POS channel ready for printing'
                    : 'Pair via Web Bluetooth dialog'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
              {status.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isBusy || !isSupported}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md active:scale-95"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>{isBusy ? 'Scanning...' : 'Scan & Pair Printer'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          {errorMsg && (
            <div className="bg-rose-950/60 border border-rose-800 text-rose-300 p-3 rounded-xl text-xs flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 p-3 rounded-xl text-xs flex items-center justify-between">
              <span>{successMsg}</span>
              <button
                onClick={() => setSuccessMsg(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* Paper Width Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Paper Width Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handlePaperWidth('58mm')}
                className={`p-4 rounded-2xl border text-left transition ${
                  config.paperWidth === '58mm'
                    ? 'bg-gradient-to-br from-blue-950/80 to-slate-900 border-blue-500 text-white shadow-lg'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-white">58mm Paper</span>
                  {config.paperWidth === '58mm' && (
                    <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Standard mobile handheld POS (32 columns per line).
                </p>
              </button>

              <button
                type="button"
                onClick={() => handlePaperWidth('80mm')}
                className={`p-4 rounded-2xl border text-left transition ${
                  config.paperWidth === '80mm'
                    ? 'bg-gradient-to-br from-blue-950/80 to-slate-900 border-blue-500 text-white shadow-lg'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-white">80mm Paper</span>
                  {config.paperWidth === '80mm' && (
                    <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Wide desktop counter printer (48 columns per line).
                </p>
              </button>
            </div>
          </div>

          {/* Receipt Customization Settings */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Settings className="w-3.5 h-3.5" />
              <span>Receipt Header & Footer Content</span>
            </h3>

            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Store Business Name
                </label>
                <div className="relative">
                  <Store className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={config.storeName}
                    onChange={(e) => handleUpdateConfig({ storeName: e.target.value })}
                    className="w-full py-2 pl-9 pr-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                    placeholder="e.g. SAIMETRIC POS"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Store Address
                  </label>
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={config.storeAddress || ''}
                      onChange={(e) => handleUpdateConfig({ storeAddress: e.target.value })}
                      className="w-full py-2 pl-9 pr-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                      placeholder="e.g. Harare Commercial Hub"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Contact Phone
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={config.storePhone || ''}
                      onChange={(e) => handleUpdateConfig({ storePhone: e.target.value })}
                      className="w-full py-2 pl-9 pr-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                      placeholder="e.g. +263 77 123 4567"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Footer Note / Policy
                </label>
                <input
                  type="text"
                  value={config.footerNote || ''}
                  onChange={(e) => handleUpdateConfig({ footerNote: e.target.value })}
                  className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                  placeholder="Thank you for your business!"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-300 flex items-center space-x-1.5">
                  <Scissors className="w-3.5 h-3.5 text-slate-400" />
                  <span>Send Auto-Cut Command (80mm only)</span>
                </span>
                <input
                  type="checkbox"
                  checked={config.autoCut}
                  onChange={(e) => handleUpdateConfig({ autoCut: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleTestPrint}
            disabled={isBusy}
            className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 active:scale-95"
          >
            <Printer className="w-4 h-4 text-slate-400" />
            <span>Print Test Slip ({config.paperWidth})</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
