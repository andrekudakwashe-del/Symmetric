import React, { useState, useEffect } from 'react';
import {
  bluetoothPrinter,
  getPrinterConfig,
  savePrinterConfig,
  getDefaultPrinterConfig,
  PaperWidth,
  PrinterDeviceStatus,
  isRunningInIframe,
  isBluetoothPermissionsBlocked,
  BluetoothPrinterConfig,
} from '../../services/bluetoothPrinter';
import { getCurrentCompany, getCurrentBranch } from '../../db/roomDatabase';
import {
  Printer,
  Bluetooth,
  Store,
  MapPin,
  Phone,
  Settings,
  Scissors,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Info,
  Layers,
  RotateCcw,
  Zap,
  Eye,
  DollarSign,
  FileText,
  Building2,
  Check,
  Clock,
  Radio,
  Trash2,
  Play,
  RefreshCw,
} from 'lucide-react';

interface BluetoothPrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BluetoothPrinterModal: React.FC<BluetoothPrinterModalProps> = ({
  isOpen,
  onClose,
}) => {
  const currentTenant = getCurrentCompany();
  const currentBranch = getCurrentBranch();

  const [config, setConfig] = useState<BluetoothPrinterConfig>(() =>
    getPrinterConfig(currentTenant?.company_id)
  );
  const [activeTab, setActiveTab] = useState<'receipt' | 'hardware' | 'preview'>('receipt');
  const [status, setStatus] = useState<PrinterDeviceStatus>(() =>
    bluetoothPrinter.getStatus()
  );
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isIframe = isRunningInIframe();
  const isSupported = bluetoothPrinter.isSupported();

  useEffect(() => {
    const unsub = bluetoothPrinter.subscribe((newStatus) => {
      setStatus(newStatus);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isOpen && currentTenant?.company_id) {
      const activeBranchName = currentBranch.name || (currentBranch as any).branch_name || 'Main Branch';
      const activeBranchAddress = currentBranch.location || currentBranch.address || '';
      
      const loaded = getPrinterConfig(currentTenant.company_id);
      // Auto-heal if loaded config still has "chapwanya" or outdated fallback address while tenant is different
      const isContaminated = Boolean(
        loaded.storeName &&
        loaded.storeName.toLowerCase().includes('chapwanya') &&
        !currentTenant.company_name.toLowerCase().includes('chapwanya')
      );

      if (isContaminated || !loaded.storeAddress || loaded.storeAddress.toLowerCase().includes('harare commercial hub')) {
        const sanitized = savePrinterConfig(
          {
            storeName: isContaminated ? currentTenant.company_name : (loaded.storeName || currentTenant.company_name),
            branchName: isContaminated ? activeBranchName : (loaded.branchName || activeBranchName),
            storeAddress: activeBranchAddress || loaded.storeAddress,
            storePhone: currentBranch.phone || currentTenant.phone || loaded.storePhone,
          },
          currentTenant.company_id
        );
        setConfig(sanitized);
      } else {
        setConfig(loaded);
      }
    }
  }, [isOpen, currentTenant?.company_id, currentTenant?.company_name, currentBranch?.name, currentBranch?.location]);

  if (!isOpen) return null;

  const handleConnect = async () => {
    if (isIframe) {
      setErrorMsg(
        'Web Bluetooth is restricted inside embedded preview frames by browser security policy. Please click "Open App in Tab" above to pair your printer.'
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
        setErrorMsg(
          'Web Bluetooth access is disallowed inside this embedded preview frame. Please open in a dedicated tab.'
        );
      } else {
        const isCancelled =
          err?.name === 'NotFoundError' ||
          (typeof err?.message === 'string' &&
            err.message.toLowerCase().includes('cancelled'));

        if (isCancelled) {
          setErrorMsg('Device selection dialog was closed without selecting a printer.');
        } else {
          setErrorMsg(
            err.message || 'Bluetooth connection failed. Ensure printer is powered on.'
          );
        }
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsBusy(true);

      if (!status.isRadioAvailable) {
        setErrorMsg(
          "Your phone's Bluetooth is turned OFF. Please turn on Bluetooth in your phone's quick settings to reconnect."
        );
        return;
      }

      const reconnected = await bluetoothPrinter.attemptSilentReconnect();
      if (reconnected) {
        setSuccessMsg(
          `Reconnected to ${bluetoothPrinter.getConnectedDeviceName() || 'Printer'}!`
        );
      } else {
        setErrorMsg(
          'Could not auto-reconnect. Ensure printer is powered on with Bluetooth enabled, or tap "Re-pair / Switch" below.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Reconnect attempt failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleForgetPrinter = async () => {
    try {
      await bluetoothPrinter.forgetPrinter();
      setSuccessMsg('Paired printer cleared. You can now pair a new printer.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleProcessQueue = async () => {
    try {
      setIsBusy(true);
      const res = await bluetoothPrinter.processPrintQueue();
      if (res.processed > 0) {
        setSuccessMsg(`Printed ${res.succeeded} queued receipt(s)!`);
      } else {
        setSuccessMsg('Print queue is empty.');
      }
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error processing print queue.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearQueue = () => {
    bluetoothPrinter.clearPrintQueue();
    setSuccessMsg('Print queue cleared.');
    setTimeout(() => setSuccessMsg(null), 2500);
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
    const updated = savePrinterConfig({ paperWidth: width }, currentTenant?.company_id);
    setConfig(updated);
    document.documentElement.style.setProperty('--receipt-width', width);
  };

  const handleUpdateConfig = (updates: Partial<BluetoothPrinterConfig>) => {
    const updated = savePrinterConfig(updates, currentTenant?.company_id);
    setConfig(updated);
  };

  const handleResetToTenantDefaults = () => {
    const defaults = getDefaultPrinterConfig(currentTenant?.company_id);
    const activeBranchName = currentBranch.name || (currentBranch as any).branch_name || defaults.branchName;
    const activeAddress = currentBranch.location || currentBranch.address || (currentBranch as any).location || defaults.storeAddress;
    const activePhone = currentBranch.phone || currentTenant.phone || defaults.storePhone;

    const updated = savePrinterConfig(
      {
        storeName: currentTenant.company_name || defaults.storeName,
        branchName: activeBranchName,
        storeAddress: activeAddress,
        storePhone: activePhone,
        storeEmail: currentTenant.owner_email || defaults.storeEmail,
        showChange: true,
        showCashier: true,
        showCustomer: true,
        showBarcode: true,
        showPaymentMethod: true,
        autoPrintOnCheckout: false,
      },
      currentTenant?.company_id
    );
    setConfig(updated);
    setSuccessMsg(`Reset receipt info to ${currentTenant.company_name} & ${activeBranchName}!`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleTestPrint = async () => {
    if (isIframe) {
      setErrorMsg(
        'Direct Bluetooth test print is restricted in embedded preview. Launch app in a full browser tab to test wireless ESC/POS output.'
      );
      return;
    }

    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsBusy(true);

      const res = await bluetoothPrinter.printReceipt({
        invoiceId: 'TEST-' + Math.floor(1000 + Math.random() * 9000),
        date: new Date().toLocaleString(),
        cashierName: 'Admin / System Test',
        customerName: 'Walk-in Customer',
        items: [
          { name: '12V 100Ah Solar Battery', quantity: 1, unitPrice: 120.0, total: 120.0 },
          { name: '2.5mm Twin Cable (10m)', quantity: 2, unitPrice: 15.0, total: 30.0 },
        ],
        subtotal: 150.0,
        discount: 10.0,
        total: 140.0,
        amountPaid: 150.0,
        change: 10.0,
        paymentMethod: 'Cash (USD)',
        paperWidth: config.paperWidth,
        companyId: currentTenant?.company_id,
        storeName: config.storeName || currentTenant?.company_name,
        branchName: config.branchName || currentBranch?.name || 'Main Branch',
      });

      if (res?.success) {
        setSuccessMsg(`✓ Test receipt printed successfully to ${config.paperWidth} printer!`);
        setTimeout(() => setSuccessMsg(null), 3500);
      } else if (res?.queued) {
        setErrorMsg('Printer was unreachable or offline. Test slip placed in offline print queue.');
      }
    } catch (err: any) {
      const isPolicy = isBluetoothPermissionsBlocked(err);
      if (isPolicy) {
        setErrorMsg(
          'Bluetooth is restricted inside embedded previews. Open app in a new tab to test.'
        );
      } else {
        setErrorMsg(err.message || 'Failed to print test slip.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900/70 via-indigo-900/60 to-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-inner">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center space-x-2">
                <span>Printer & Receipt Setup</span>
              </h2>
              <p className="text-xs text-slate-400">
                Configure thermal receipt layout, tenant branding, & printer functions
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
                title="Open in new browser window for direct Bluetooth device pairing"
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

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-800 bg-slate-950/50 px-6 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('receipt')}
            className={`py-3 px-4 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'receipt'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Receipt Info & Branding</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hardware')}
            className={`py-3 px-4 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'hardware'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>Printer & Auto-Print</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`py-3 px-4 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'preview'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Live Slip Preview</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-slate-200">
          {/* Notifications */}
          {errorMsg && (
            <div className="bg-rose-950/60 border border-rose-800 text-rose-300 p-3 rounded-2xl text-xs flex items-center justify-between">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 p-3 rounded-2xl text-xs flex items-center justify-between">
              <span>{successMsg}</span>
              <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}

          {/* TAB 1: RECEIPT INFO & BRANDING */}
          {activeTab === 'receipt' && (
            <div className="space-y-4">
              {/* Tenant context badge */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  <Building2 className="w-4 h-4 text-blue-400" />
                  <span className="text-slate-400">Current Tenant:</span>
                  <span className="font-bold text-white">{currentTenant.company_name}</span>
                  <span className="text-slate-500 font-mono">
                    ({currentBranch.name || (currentBranch as any).branch_name || 'Main Branch'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetToTenantDefaults}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 flex items-center space-x-1 transition"
                  title="Reset receipt details to match current tenant & branch"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset to Tenant</span>
                </button>
              </div>

              {/* Business Name & Branch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Store / Business Name (Receipt Header)
                  </label>
                  <div className="relative">
                    <Store className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={config.storeName}
                      onChange={(e) => handleUpdateConfig({ storeName: e.target.value })}
                      className="w-full py-2 pl-9 pr-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500 font-bold"
                      placeholder="e.g. SAIMETRIC ENERGY"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={config.branchName || ''}
                    onChange={(e) => handleUpdateConfig({ branchName: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                    placeholder="e.g. Main Distribution Branch"
                  />
                </div>
              </div>

              {/* Address & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Physical Address / Commercial Hub
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
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Customer Service Phone / WhatsApp
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={config.storePhone || ''}
                      onChange={(e) => handleUpdateConfig({ storePhone: e.target.value })}
                      className="w-full py-2 pl-9 pr-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500 font-mono"
                      placeholder="e.g. +263 77 123 4567"
                    />
                  </div>
                </div>
              </div>

              {/* TIN / VAT & Header Greeting */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Tax / VAT / TIN Registration Number
                  </label>
                  <input
                    type="text"
                    value={config.taxNumber || ''}
                    onChange={(e) => handleUpdateConfig({ taxNumber: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500 font-mono"
                    placeholder="e.g. VAT-2026/09"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Header Greeting Note
                  </label>
                  <input
                    type="text"
                    value={config.headerNote || ''}
                    onChange={(e) => handleUpdateConfig({ headerNote: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                    placeholder="e.g. OFFICIAL TAX INVOICE & RECEIPT"
                  />
                </div>
              </div>

              {/* Footer Policy */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  Footer Return Policy / Thank You Note
                </label>
                <input
                  type="text"
                  value={config.footerNote || ''}
                  onChange={(e) => handleUpdateConfig({ footerNote: e.target.value })}
                  className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                  placeholder="e.g. Goods once sold cannot be returned without original receipt."
                />
              </div>

              {/* Information to Show on Receipts (Toggles) */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                <label className="text-xs font-bold text-slate-300 block uppercase tracking-wider">
                  Information to Show on Receipts
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.showChange}
                      onChange={(e) => handleUpdateConfig({ showChange: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-emerald-400">Cash Tendered & Change</span>
                      <p className="text-[10px] text-slate-500">Show exact change due / returned</p>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.showCashier}
                      onChange={(e) => handleUpdateConfig({ showCashier: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-white">Cashier Name</span>
                      <p className="text-[10px] text-slate-500">Include staff identification</p>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.showCustomer}
                      onChange={(e) => handleUpdateConfig({ showCustomer: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-white">Customer Name</span>
                      <p className="text-[10px] text-slate-500">Show client or walk-in tag</p>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.showBarcode}
                      onChange={(e) => handleUpdateConfig({ showBarcode: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-white">Invoice Barcode</span>
                      <p className="text-[10px] text-slate-500">Print scannable slip barcode</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PRINTER & HARDWARE FUNCTIONS */}
          {activeTab === 'hardware' && (
            <div className="space-y-4">
              {/* Auto-Print on Everyday Sales Toggle */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border border-blue-500/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Automatic Printing on Every Checkout
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        Automatically triggers thermal receipt printing whenever a cashier completes a sale.
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.autoPrintOnCheckout}
                      onChange={(e) => handleUpdateConfig({ autoPrintOnCheckout: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <div className="text-[11px] text-slate-400 pl-9">
                  {config.autoPrintOnCheckout ? (
                    <span className="text-emerald-400 font-bold flex items-center space-x-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>Active: Every sale automatically sends receipt to printer.</span>
                    </span>
                  ) : (
                    <span>Disabled: Cashier clicks "Print" manually when needed.</span>
                  )}
                </div>
              </div>

              {/* Paper Width Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  Thermal Paper Width
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handlePaperWidth('58mm')}
                    className={`p-3.5 rounded-2xl border text-left transition ${
                      config.paperWidth === '58mm'
                        ? 'bg-blue-950/60 border-blue-500 text-white shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm text-white">58mm (2-Inch)</span>
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
                    className={`p-3.5 rounded-2xl border text-left transition ${
                      config.paperWidth === '80mm'
                        ? 'bg-blue-950/60 border-blue-500 text-white shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm text-white">80mm (3-Inch)</span>
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

              {/* Number of Copies & Hardware toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 block">Print Copies per Sale</label>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateConfig({ numberOfCopies: 1 })}
                      className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition ${
                        config.numberOfCopies === 1
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      1 (Customer Only)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateConfig({ numberOfCopies: 2 })}
                      className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition ${
                        config.numberOfCopies === 2
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      2 (Customer + Store)
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2.5">
                  <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                    <span className="flex items-center space-x-1.5">
                      <Scissors className="w-3.5 h-3.5 text-slate-400" />
                      <span>Auto-Cut Paper (GS V)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.autoCut}
                      onChange={(e) => handleUpdateConfig({ autoCut: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                    <span className="flex items-center space-x-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                      <span>Open Cash Drawer (ESC p)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.openCashDrawer}
                      onChange={(e) => handleUpdateConfig({ openCashDrawer: e.target.checked })}
                      className="rounded text-blue-600 bg-slate-900 border-slate-700 w-4 h-4"
                    />
                  </label>
                </div>
              </div>

              {/* Phone Bluetooth Radio OFF Warning */}
              {!status.isRadioAvailable && (
                <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl p-3.5 flex items-start space-x-3 text-xs text-amber-200 animate-pulse">
                  <Bluetooth className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-amber-300">Phone Bluetooth is turned OFF</p>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Please enable Bluetooth in your phone's quick settings or control center. The app will automatically reconnect to your printer once turned back on.
                    </p>
                  </div>
                </div>
              )}

              {/* Bluetooth Pairing & Auto-Reconnect Status Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-3.5 h-3.5 rounded-full shrink-0 ${
                        status.connected
                          ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]'
                          : !status.isRadioAvailable
                          ? 'bg-amber-500 animate-pulse'
                          : status.isReconnecting
                          ? 'bg-indigo-400 animate-ping'
                          : status.savedDeviceName
                          ? 'bg-indigo-400 animate-pulse'
                          : 'bg-slate-600'
                      }`}
                    />
                    <div>
                      <p className="text-xs font-bold text-white flex items-center space-x-2">
                        <span>
                          {status.connected
                            ? `Connected: ${status.deviceName || 'Thermal Printer'}`
                            : !status.isRadioAvailable
                            ? 'Phone Bluetooth is OFF'
                            : status.savedDeviceName
                            ? `Paired Printer: ${status.savedDeviceName}`
                            : 'No Printer Paired'}
                        </span>
                        {status.isReconnecting && (
                          <span className="text-[10px] text-indigo-400 font-normal animate-pulse">
                            (Auto-reconnecting...)
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {status.connected
                          ? 'Wireless Web Bluetooth active & ready for instant checkout printing'
                          : !status.isRadioAvailable
                          ? 'Turn Bluetooth ON in your phone settings to resume automatic printing.'
                          : status.savedDeviceName
                          ? 'Device saved. Turning printer ON will automatically reconnect and resume printing.'
                          : 'Pair your BLE 58mm / 80mm thermal receipt printer once'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                    {status.connected ? (
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={handleDisconnect}
                          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={handleConnect}
                          disabled={isBusy || !isSupported}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow"
                          title="Re-pair or refresh printer channel permissions"
                        >
                          <Bluetooth className="w-3.5 h-3.5" />
                          <span>Re-pair / Switch</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        {status.savedDeviceName && (
                          <>
                            <button
                              type="button"
                              onClick={handleReconnect}
                              disabled={isBusy}
                              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1"
                              title="Connect to saved printer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                              <span>Reconnect</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleForgetPrinter}
                              className="px-2.5 py-2 bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 rounded-xl text-xs font-bold transition"
                              title="Forget this printer to pair a different device"
                            >
                              Forget
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={handleConnect}
                          disabled={isBusy || !isSupported}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md active:scale-95"
                          title={status.savedDeviceName ? 'Re-pair or switch to another printer' : 'Pair printer'}
                        >
                          <Bluetooth className="w-4 h-4" />
                          <span>
                            {isBusy
                              ? 'Scanning...'
                              : status.savedDeviceName
                              ? 'Re-pair / Switch'
                              : 'Pair New Printer'}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Auto-Reconnect & Queue explanation badge */}
                <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center space-x-1.5 text-slate-400">
                    <Radio className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Auto-reconnect on power cycle & radio toggle is active</span>
                  </span>
                  {!status.isRadioAvailable ? (
                    <span className="text-amber-400 font-medium">Phone Bluetooth Disabled</span>
                  ) : status.savedDeviceName && !status.connected ? (
                    <span className="text-amber-400 font-medium">
                      {status.isReconnecting ? 'Searching for Printer...' : 'Standby / Printer Powered Off'}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Offline Print Queue Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center space-x-2">
                        <span>Offline Print Queue</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">
                          {status.queueCount} Pending
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Receipts printed while the printer is off are queued safely and print automatically when turned back on.
                      </p>
                    </div>
                  </div>

                  {status.queueCount > 0 && (
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleProcessQueue}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1 transition shadow"
                        title="Print all queued receipts now"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Print Queue</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearQueue}
                        className="p-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 rounded-xl text-xs transition"
                        title="Clear pending print queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LIVE SLIP PREVIEW */}
          {activeTab === 'preview' && (
            <div className="flex flex-col items-center justify-center py-2 space-y-3">
              <p className="text-xs text-slate-400">
                Live layout preview matching configured tenant branding, paper width, and change format:
              </p>
              <div
                className={`bg-white text-slate-950 rounded-2xl p-4 shadow-xl border border-slate-300 font-mono text-[11px] transition-all ${
                  config.paperWidth === '80mm' ? 'w-[340px]' : 'w-[260px]'
                }`}
              >
                {/* Header */}
                <div className="text-center pb-2 border-b border-dashed border-slate-400">
                  <h3 className="font-black text-xs uppercase tracking-wider">{config.storeName}</h3>
                  {config.branchName && <p className="text-[10px] font-bold text-slate-800">{config.branchName}</p>}
                  {config.storeAddress && <p className="text-[9px] text-slate-600">{config.storeAddress}</p>}
                  {config.storePhone && <p className="text-[9px] text-slate-600">Tel: {config.storePhone}</p>}
                  {config.taxNumber && <p className="text-[9px] text-slate-500 font-mono">TIN: {config.taxNumber}</p>}
                  {config.headerNote && (
                    <div className="mt-1 px-1 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-700">
                      {config.headerNote}
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="py-2 border-b border-dashed border-slate-400 space-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-600">INVOICE:</span>
                    <span className="font-bold">INV-PREVIEW-001</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">DATE:</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                  {config.showCashier && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">CASHIER:</span>
                      <span>Admin User</span>
                    </div>
                  )}
                  {config.showCustomer && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">CUSTOMER:</span>
                      <span>Walk-in Customer</span>
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="py-2 border-b border-dashed border-slate-400 space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-600 font-bold">
                    <span>ITEM</span>
                    <span>TOTAL</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>1x Sample Inventory SKU</span>
                    <span className="font-bold">$45.00</span>
                  </div>
                </div>

                {/* Totals & Change */}
                <div className="py-2 border-b border-dashed border-slate-400 space-y-1">
                  <div className="flex justify-between font-black text-xs">
                    <span>TOTAL DUE:</span>
                    <span>$45.00</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>CASH TENDERED:</span>
                    <span className="font-bold">$50.00</span>
                  </div>
                  {config.showChange && (
                    <div className="flex justify-between items-center py-1 px-1.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-950 font-black text-xs">
                      <span>CHANGE RETURNED:</span>
                      <span className="text-emerald-700 font-black">$5.00</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="pt-2 text-center space-y-1">
                  {config.showBarcode && (
                    <div className="h-6 w-3/4 mx-auto bg-slate-950 rounded flex items-center justify-around px-2">
                      <div className="h-full w-1 bg-white" />
                      <div className="h-full w-2 bg-white" />
                      <div className="h-full w-1 bg-white" />
                    </div>
                  )}
                  <p className="text-[9px] text-slate-600">{config.footerNote}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
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
            className="py-2.5 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md active:scale-95"
          >
            Save & Done
          </button>
        </div>
      </div>
    </div>
  );
};
