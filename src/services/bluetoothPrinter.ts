// ============================================================================
// BLUETOOTH THERMAL PRINTER SERVICE (Web Bluetooth ESC/POS 58mm & 80mm)
// Multi-Tenant Aware • Auto-Reconnect When Powered On • Persistent Print Queue
// ============================================================================

import {
  getCurrentCompany,
  getCurrentBranch,
  getCompanies,
  getBranches,
} from '../db/roomDatabase';

export type PaperWidth = '58mm' | '80mm';

export interface BluetoothPrinterConfig {
  paperWidth: PaperWidth;
  autoCut: boolean;
  autoPrintOnCheckout: boolean; // Automatic printing upon completing a sale
  storeName: string;
  branchName?: string;
  storeAddress?: string;
  storePhone?: string;
  storeEmail?: string;
  taxNumber?: string;
  headerNote?: string;
  footerNote?: string;
  showCashier: boolean;
  showCustomer: boolean;
  showChange: boolean; // Show change on receipts
  showBarcode: boolean;
  showPaymentMethod: boolean;
  numberOfCopies: 1 | 2;
  openCashDrawer: boolean;
  companyId?: string; // Tenant identifier this config is scoped to
}

export interface ReceiptPrintData {
  invoiceId: string;
  date: string;
  cashierName: string;
  customerName?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  amountPaid?: number;
  change?: number;
  paymentMethod: string;
  paperWidth?: PaperWidth;
  companyId?: string;
  storeName?: string;
  branchName?: string;
  storeAddress?: string;
  storePhone?: string;
}

export interface QueuedPrintJob {
  id: string;
  createdAt: string;
  invoiceId: string;
  companyId?: string;
  data: ReceiptPrintData;
  attempts: number;
  status: 'pending' | 'printing' | 'completed' | 'failed';
  lastError?: string;
}

export interface SavedPrinterInfo {
  id: string;
  name: string;
  savedAt: number;
}

const SAVED_PRINTER_KEY = 'saimetric_saved_bluetooth_printer';
const PRINT_QUEUE_KEY = 'saimetric_bluetooth_print_queue';
const HARDWARE_CONFIG_KEY = 'saimetric_printer_hardware_config';

export const isRunningInIframe = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
};

export const isBluetoothPermissionsBlocked = (err?: any): boolean => {
  if (isRunningInIframe()) return true;
  if (!err) return false;
  if (err.isPermissionsPolicy) return true;
  if (err.name === 'SecurityError') return true;
  if (
    typeof err.message === 'string' &&
    (err.message.includes('permissions policy') ||
      err.message.includes('disallowed') ||
      err.message.includes('SecurityError'))
  ) {
    return true;
  }
  return false;
};

// ============================================================================
// DYNAMIC MULTI-TENANT CONFIGURATION
// Scoped to active company so another company logging in never sees old company branding
// ============================================================================

export const getDefaultPrinterConfig = (companyId?: string): BluetoothPrinterConfig => {
  let tenantName = 'SAIMETRIC POS';
  let branchName = 'Main Branch';
  let address = '';
  let phone = '';
  let email = '';
  let taxNum = 'VAT-2026/09';
  let targetCompanyId = companyId;

  try {
    const companies = getCompanies();
    const comp = targetCompanyId
      ? companies.find((c) => c.company_id === targetCompanyId) || getCurrentCompany()
      : getCurrentCompany();

    targetCompanyId = comp?.company_id || 'COMP-001';
    const branches = getBranches();
    const branch = branches.find((b) => (b.company_id || b.companyId) === targetCompanyId) || getCurrentBranch();

    if (comp?.company_name) tenantName = comp.company_name;
    const bName = branch?.name || (branch as any)?.branch_name || (branch as any)?.branchName;
    if (bName) branchName = bName;
    const bLoc = branch?.location || (branch as any)?.address || (branch as any)?.branch_address;
    if (bLoc) address = bLoc;
    if (branch?.phone || comp?.phone) phone = branch?.phone || comp?.phone || phone;
    if (comp?.owner_email) email = comp.owner_email;
    if ((comp as any)?.tax_number || (comp as any)?.taxNumber) {
      taxNum = (comp as any).tax_number || (comp as any).taxNumber;
    }
  } catch {
    // fallback to safe defaults
  }

  // Read shared hardware preferences (e.g. 58mm vs 80mm persists across users on this physical register)
  let hwConfig: Partial<BluetoothPrinterConfig> = {};
  try {
    const hwSaved = localStorage.getItem(HARDWARE_CONFIG_KEY);
    if (hwSaved) hwConfig = JSON.parse(hwSaved);
  } catch {
    // ignore
  }

  return {
    paperWidth: hwConfig.paperWidth || '58mm',
    autoCut: hwConfig.autoCut ?? true,
    autoPrintOnCheckout: hwConfig.autoPrintOnCheckout ?? false,
    storeName: tenantName,
    branchName: branchName,
    storeAddress: address,
    storePhone: phone,
    storeEmail: email,
    taxNumber: taxNum,
    headerNote: 'OFFICIAL TAX INVOICE & RECEIPT',
    footerNote: 'Thank you for your business! Goods once sold cannot be returned without receipt.',
    showCashier: true,
    showCustomer: true,
    showChange: true,
    showBarcode: true,
    showPaymentMethod: true,
    numberOfCopies: (hwConfig.numberOfCopies as 1 | 2) || 1,
    openCashDrawer: hwConfig.openCashDrawer ?? true,
    companyId: targetCompanyId,
  };
};

export const getPrinterConfig = (companyId?: string): BluetoothPrinterConfig => {
  const defaults = getDefaultPrinterConfig(companyId);
  const targetCompId = defaults.companyId || 'COMP-001';

  try {
    // 1. Check company-scoped printer config
    const scopedSaved = localStorage.getItem(`saimetric_printer_config_${targetCompId}`);
    if (scopedSaved) {
      const parsed = JSON.parse(scopedSaved);

      // Sanitize: Check if stored config is contaminated with "chapwanya" or initial device data
      const isChapwanyaContaminated = Boolean(
        parsed.storeName &&
        typeof parsed.storeName === 'string' &&
        parsed.storeName.toLowerCase().includes('chapwanya') &&
        !defaults.storeName.toLowerCase().includes('chapwanya')
      );

      const isForeignStore = isChapwanyaContaminated || (parsed.companyId && parsed.companyId !== targetCompId);

      const resolvedStoreName = isForeignStore ? defaults.storeName : (parsed.storeName || defaults.storeName);
      const resolvedBranchName = isForeignStore ? defaults.branchName : (parsed.branchName || defaults.branchName);
      const resolvedAddress = (isChapwanyaContaminated || !parsed.storeAddress || parsed.storeAddress.toLowerCase().includes('harare commercial hub'))
        ? defaults.storeAddress
        : (parsed.storeAddress || defaults.storeAddress);
      const resolvedPhone = isChapwanyaContaminated ? defaults.storePhone : (parsed.storePhone || defaults.storePhone);

      const result: BluetoothPrinterConfig = {
        ...defaults,
        ...parsed,
        storeName: resolvedStoreName,
        branchName: resolvedBranchName,
        storeAddress: resolvedAddress,
        storePhone: resolvedPhone,
        storeEmail: parsed.storeEmail || defaults.storeEmail,
        taxNumber: parsed.taxNumber || defaults.taxNumber,
        companyId: targetCompId,
      };

      // If it was contaminated, heal localStorage immediately
      if (isChapwanyaContaminated) {
        localStorage.setItem(`saimetric_printer_config_${targetCompId}`, JSON.stringify(result));
      }

      return result;
    }

    // 2. Hardware preferences from hardware key or legacy key (NEVER take store branding from legacy!)
    const legacySaved = localStorage.getItem('saimetric_printer_config');
    if (legacySaved) {
      const parsed = JSON.parse(legacySaved);
      return {
        ...defaults,
        paperWidth: parsed.paperWidth || defaults.paperWidth,
        autoCut: parsed.autoCut ?? defaults.autoCut,
        autoPrintOnCheckout: parsed.autoPrintOnCheckout ?? defaults.autoPrintOnCheckout,
        openCashDrawer: parsed.openCashDrawer ?? defaults.openCashDrawer,
        numberOfCopies: parsed.numberOfCopies || defaults.numberOfCopies,
        showCashier: parsed.showCashier ?? defaults.showCashier,
        showCustomer: parsed.showCustomer ?? defaults.showCustomer,
        showChange: parsed.showChange ?? defaults.showChange,
        showBarcode: parsed.showBarcode ?? defaults.showBarcode,
        showPaymentMethod: parsed.showPaymentMethod ?? defaults.showPaymentMethod,
        // Branding strictly defaults to active company & branch!
        storeName: defaults.storeName,
        branchName: defaults.branchName,
        storeAddress: defaults.storeAddress,
        storePhone: defaults.storePhone,
        storeEmail: defaults.storeEmail,
        taxNumber: defaults.taxNumber,
        companyId: targetCompId,
      };
    }
  } catch (e) {
    console.warn('Failed to load printer config:', e);
  }
  return defaults;
};

export const savePrinterConfig = (
  config: Partial<BluetoothPrinterConfig>,
  companyId?: string
): BluetoothPrinterConfig => {
  const current = getPrinterConfig(companyId);
  const targetCompId = companyId || current.companyId || 'COMP-001';

  // Do not allow "chapwanya" to be saved if current tenant is not Chapwanya
  const sanitizedStoreName =
    config.storeName &&
    config.storeName.toLowerCase().includes('chapwanya') &&
    !current.storeName.toLowerCase().includes('chapwanya')
      ? current.storeName
      : (config.storeName ?? current.storeName);

  const updated: BluetoothPrinterConfig = {
    ...current,
    ...config,
    storeName: sanitizedStoreName,
    companyId: targetCompId,
  };

  // 1. Save company-specific branding
  try {
    localStorage.setItem(
      `saimetric_printer_config_${targetCompId}`,
      JSON.stringify(updated)
    );
  } catch (e) {
    console.warn('Could not save company printer config:', e);
  }

  // 2. Save hardware-specific preferences globally for this terminal device
  try {
    const hwPrefs = {
      paperWidth: updated.paperWidth,
      autoCut: updated.autoCut,
      autoPrintOnCheckout: updated.autoPrintOnCheckout,
      openCashDrawer: updated.openCashDrawer,
      numberOfCopies: updated.numberOfCopies,
    };
    localStorage.setItem(HARDWARE_CONFIG_KEY, JSON.stringify(hwPrefs));
  } catch (e) {
    console.warn('Could not save hardware printer config:', e);
  }

  return updated;
};

// Common Bluetooth Printer GATT Service UUIDs
export const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard BLE thermal printers (0x18F0)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Universal 58mm/80mm BLE UART (BT-583, POS-58, MTP-II, PT-210)
  '0000fff0-0000-1000-8000-00805f9b34fb', // Common printer vendor service (0xFFF0)
  '0000ff00-0000-1000-8000-00805f9b34fb', // Common serial write service (0xFF00)
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Rongta / ESC-POS
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic Semiconductor UART (NUS)
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent / WeChat standard BT printer
  '000018f1-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
  '0000e0ff-3c55-4d70-87e5-1a0670fb66d6',
];

// Known printer data write characteristic UUIDs
export const KNOWN_PRINTER_CHARACTERISTIC_UUIDS = [
  '00002af1-0000-1000-8000-00805f9b34fb', // 0x2AF1 (Standard for 0x18F0)
  '0000ffe1-0000-1000-8000-00805f9b34fb', // 0xFFE1 (Standard for 0xFFE0 / BT-583)
  '0000fff1-0000-1000-8000-00805f9b34fb', // 0xFFF1
  '0000fff2-0000-1000-8000-00805f9b34fb', // 0xFFF2
  '0000ff01-0000-1000-8000-00805f9b34fb', // 0xFF01
  '0000ff02-0000-1000-8000-00805f9b34fb', // 0xFF02
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-8841-43f4-a8d4-ecbe34729bb3', // ISSC Write
  '49535343-1e4d-4bd9-ba61-23c647249616',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Nordic TX
  '0000ae01-0000-1000-8000-00805f9b34fb',
  '0000ae32-0000-1000-8000-00805f9b34fb',
];

// Standard Bluetooth services and characteristics that MUST NEVER be used as print channels
const BLACKLISTED_UUID_PREFIXES = [
  '00001800', // Generic Access Service
  '00001801', // Generic Attribute Service
  '0000180a', // Device Information Service
  '0000180f', // Battery Service
  '00001805', // Current Time Service
  '00002a00', // Device Name characteristic
  '00002a01', // Appearance characteristic
  '00002a04', // Peripheral Preferred Connection Parameters
  '00002a05', // Service Changed
  '00002a19', // Battery Level
  '00002a24', // Model Number String
  '00002a25', // Serial Number String
  '00002a26', // Firmware Revision
  '00002a27', // Hardware Revision
  '00002a28', // Software Revision
  '00002a29', // Manufacturer Name String
];

export const isBlacklistedUuid = (uuid?: string): boolean => {
  if (!uuid) return false;
  const clean = uuid.toLowerCase();
  return BLACKLISTED_UUID_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(prefix)
  );
};

export const isKnownPrinterCharUuid = (uuid?: string): boolean => {
  if (!uuid) return false;
  const clean = uuid.toLowerCase();
  return KNOWN_PRINTER_CHARACTERISTIC_UUIDS.some(
    (k) => clean === k.toLowerCase() || clean.startsWith(k.substring(0, 8).toLowerCase())
  );
};

export interface PrinterDeviceStatus {
  connected: boolean;
  deviceName?: string;
  savedDeviceName?: string;
  isConnecting: boolean;
  isReconnecting: boolean;
  isRadioAvailable: boolean;
  queueCount: number;
  lastError?: string;
}

// ============================================================================
// BLUETOOTH THERMAL PRINTER CLASS
// ============================================================================

class BluetoothThermalPrinter {
  private device: any = null;
  private characteristic: any = null;
  private isConnecting: boolean = false;
  private isReconnecting: boolean = false;
  private isRadioAvailable: boolean = true;
  private hasBoundAdapterEvents: boolean = false;
  private activeDisconnectHandler: any = null;
  private activeListenDevice: any = null;
  private autoReconnectTimer: any = null;
  private reconnectWarmupTimer: any = null;
  private listeners: Array<(status: PrinterDeviceStatus) => void> = [];
  private queueListeners: Array<(queue: QueuedPrintJob[], lastProcessed?: QueuedPrintJob) => void> = [];

  constructor() {
    this.setupRadioListeners();

    // Attempt auto-reconnect on load if not in iframe
    if (typeof window !== 'undefined' && !isRunningInIframe()) {
      setTimeout(() => {
        this.attemptSilentReconnect().catch(() => {});
      }, 1200);
    }
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Listen for phone Bluetooth radio on/off toggles and app resume
   */
  private setupRadioListeners() {
    if (this.hasBoundAdapterEvents || typeof window === 'undefined' || isRunningInIframe()) return;
    this.hasBoundAdapterEvents = true;

    const nav = navigator as any;
    if (nav?.bluetooth && typeof nav.bluetooth.getAvailability === 'function') {
      nav.bluetooth
        .getAvailability()
        .then((avail: boolean) => {
          this.isRadioAvailable = avail;
          this.notify();
        })
        .catch(() => {});

      if (typeof nav.bluetooth.addEventListener === 'function') {
        nav.bluetooth.addEventListener('availabilitychanged', (event: any) => {
          const avail = Boolean(event.value);
          console.log('[Bluetooth] Phone Bluetooth radio status changed:', avail);
          this.handleRadioAvailabilityChange(avail);
        });
      }
    }

    // Handle user switching to phone settings to toggle Bluetooth then returning to browser
    window.addEventListener('focus', () => {
      this.handleAppResumed();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.handleAppResumed();
      }
    });
  }

  private handleRadioAvailabilityChange(avail: boolean) {
    this.isRadioAvailable = avail;
    if (!avail) {
      console.log('[Bluetooth] Phone Bluetooth turned OFF. Suspending polling and resetting stale GATT handles.');
      this.stopAutoReconnectLoop();
      // Drop stale characteristic & device because Android OS tears down the native GATT client
      if (this.device) {
        try {
          this.device.gatt?.disconnect();
        } catch {}
        this.device = null;
      }
      this.characteristic = null;
      this.notify();
    } else {
      console.log('[Bluetooth] Phone Bluetooth turned ON. Warming up adapter and scheduling auto-reconnect...');
      this.notify();
      if (this.reconnectWarmupTimer) clearTimeout(this.reconnectWarmupTimer);
      // Wait ~1.5s for Android Bluetooth adapter to stabilize radio scanning
      this.reconnectWarmupTimer = setTimeout(() => {
        this.attemptSilentReconnect().then((success) => {
          if (!success) {
            this.startAutoReconnectLoop();
          }
        });
      }, 1500);
    }
  }

  private handleAppResumed() {
    if (isRunningInIframe() || !this.isSupported()) return;
    const saved = this.getSavedPrinter();
    if (!saved) return;

    const nav = navigator as any;
    if (nav?.bluetooth && typeof nav.bluetooth.getAvailability === 'function') {
      nav.bluetooth
        .getAvailability()
        .then((avail: boolean) => {
          this.isRadioAvailable = avail;
          this.notify();
          if (avail && !this.isConnected() && !this.isConnecting && !this.isReconnecting) {
            this.attemptSilentReconnect().then((success) => {
              if (!success) {
                this.startAutoReconnectLoop();
              }
            });
          }
        })
        .catch(() => {});
    } else if (!this.isConnected() && !this.isConnecting && !this.isReconnecting) {
      this.attemptSilentReconnect().then((success) => {
        if (!success) {
          this.startAutoReconnectLoop();
        }
      });
    }
  }

  public subscribe(cb: (status: PrinterDeviceStatus) => void): () => void {
    this.listeners.push(cb);
    cb(this.getStatus());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public subscribeQueue(cb: (queue: QueuedPrintJob[], lastProcessed?: QueuedPrintJob) => void): () => void {
    this.queueListeners.push(cb);
    cb(this.getPrintQueue());
    return () => {
      this.queueListeners = this.queueListeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    const status = this.getStatus();
    this.listeners.forEach((l) => l(status));
  }

  private notifyQueue(lastProcessed?: QueuedPrintJob) {
    const q = this.getPrintQueue();
    this.queueListeners.forEach((l) => l(q, lastProcessed));
    this.notify();
  }

  public getStatus(): PrinterDeviceStatus {
    const saved = this.getSavedPrinter();
    const queue = this.getPrintQueue();
    return {
      connected: this.isConnected(),
      deviceName: this.device?.name || (this.isConnected() ? 'Bluetooth Printer' : undefined),
      savedDeviceName: saved?.name,
      isConnecting: this.isConnecting,
      isReconnecting: this.isReconnecting,
      isRadioAvailable: this.isRadioAvailable,
      queueCount: queue.length,
    };
  }

  public getConnectedDeviceName(): string | null {
    return this.device?.name || null;
  }

  public getSavedPrinter(): SavedPrinterInfo | null {
    try {
      const saved = localStorage.getItem(SAVED_PRINTER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  private savePrinterInfo(device: any) {
    if (!device) return;
    try {
      const info: SavedPrinterInfo = {
        id: device.id || 'bt-printer',
        name: device.name || 'Thermal Bluetooth Printer',
        savedAt: Date.now(),
      };
      localStorage.setItem(SAVED_PRINTER_KEY, JSON.stringify(info));
    } catch {
      // ignore
    }
  }

  public async forgetPrinter(): Promise<void> {
    try {
      localStorage.removeItem(SAVED_PRINTER_KEY);
    } catch {
      // ignore
    }
    this.stopAutoReconnectLoop();
    await this.disconnect();
  }

  public isConnected(): boolean {
    return !!(
      this.device &&
      this.device.gatt &&
      this.device.gatt.connected &&
      this.characteristic &&
      !isBlacklistedUuid(this.characteristic.uuid)
    );
  }

  public isInIframe(): boolean {
    return isRunningInIframe();
  }

  public async disconnect(): Promise<void> {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        await this.device.gatt.disconnect();
      } catch (e) {
        console.warn('Error disconnecting bluetooth:', e);
      }
    }
    this.device = null;
    this.characteristic = null;
    this.notify();
  }

  private attachDeviceListeners(device: any) {
    if (!device) return;

    if (this.activeListenDevice === device && this.activeDisconnectHandler) {
      return; // listener already active on this exact instance
    }

    if (this.activeListenDevice && this.activeDisconnectHandler) {
      try {
        this.activeListenDevice.removeEventListener('gattserverdisconnected', this.activeDisconnectHandler);
      } catch {}
    }

    this.activeDisconnectHandler = () => {
      console.log('[Bluetooth] Printer disconnected or out of range.');
      this.characteristic = null;
      this.notify();
      // If phone radio is still active, poll for printer reboot
      if (this.isRadioAvailable) {
        this.startAutoReconnectLoop();
      }
    };

    this.activeListenDevice = device;
    device.addEventListener('gattserverdisconnected', this.activeDisconnectHandler);
  }

  /**
   * Request Bluetooth device pair and discover GATT write characteristics
   */
  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error(
        'Web Bluetooth API is not supported in this browser. Please use Google Chrome (Desktop, Mac, or Android) or Microsoft Edge.'
      );
    }

    if (isRunningInIframe()) {
      const err = new Error(
        'Web Bluetooth is disallowed inside embedded preview frames by browser permissions policy. Please open the application in a new tab to pair and print via Bluetooth, or use System Print.'
      );
      (err as any).name = 'SecurityError';
      (err as any).isPermissionsPolicy = true;
      throw err;
    }

    if (this.isConnected()) {
      return true;
    }

    // Clean up any lingering previous device GATT connection
    if (this.device && this.device.gatt) {
      try {
        await this.device.gatt.disconnect();
      } catch {}
    }

    try {
      this.isConnecting = true;
      this.notify();
      const nav = navigator as any;

      let device: any;
      try {
        device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: PRINTER_SERVICE_UUIDS,
        });
      } catch (reqErr: any) {
        if (
          reqErr?.name === 'SecurityError' ||
          (typeof reqErr?.message === 'string' &&
            (reqErr.message.includes('permissions policy') ||
              reqErr.message.includes('disallowed')))
        ) {
          const customErr = new Error(
            'Web Bluetooth is disallowed inside embedded preview frames by browser permissions policy. Please open the application in a new tab to pair and print via Bluetooth, or use System Print.'
          );
          (customErr as any).name = 'SecurityError';
          (customErr as any).isPermissionsPolicy = true;
          throw customErr;
        }
        throw reqErr;
      }

      if (!device) {
        throw new Error('No Bluetooth printer was selected.');
      }

      this.device = device;
      this.attachDeviceListeners(device);
      this.savePrinterInfo(device);

      const writeChar = await this.connectGattAndFindCharacteristic(device);
      if (!writeChar) {
        throw new Error(
          'Connected to device, but could not find a writeable communication channel. Ensure the printer is turned on and paired.'
        );
      }

      this.characteristic = writeChar;
      this.stopAutoReconnectLoop();
      this.notify();

      // Automatically drain any queued print jobs!
      this.processPrintQueue().catch((e) => {
        console.warn('Error processing print queue on connect:', e);
      });

      return true;
    } finally {
      this.isConnecting = false;
      this.notify();
    }
  }

  private async connectWithTimeout(gatt: any, timeoutMs = 7000): Promise<any> {
    let timer: any;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Bluetooth GATT connection timed out'));
      }, timeoutMs);
    });
    try {
      const server = await Promise.race([gatt.connect(), timeoutPromise]);
      clearTimeout(timer);
      return server;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  private async connectGattAndFindCharacteristic(device: any): Promise<any> {
    if (!device || !device.gatt) {
      throw new Error('Device GATT is not available');
    }

    // If already connected and characteristic is already valid, return it
    if (
      device.gatt.connected &&
      this.characteristic &&
      !isBlacklistedUuid(this.characteristic.uuid) &&
      (this.characteristic.properties?.write || this.characteristic.properties?.writeWithoutResponse)
    ) {
      return this.characteristic;
    }

    // Disconnect first to reset any dangling Android GATT handle / prevent GATT error 133
    try {
      if (device.gatt.connected) {
        await device.gatt.disconnect();
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch {
      // ignore
    }

    const server = await this.connectWithTimeout(device.gatt, 7500);

    let writeChar: any = null;

    // STEP 1: Search explicitly through PRINTER_SERVICE_UUIDS first!
    for (const sUuid of PRINTER_SERVICE_UUIDS) {
      try {
        const s = await server.getPrimaryService(sUuid);
        if (!s) continue;
        const chars = await s.getCharacteristics();

        // 1a: Check if any characteristic is a known printer characteristic
        for (const c of chars) {
          if (isKnownPrinterCharUuid(c.uuid) && (c.properties.write || c.properties.writeWithoutResponse)) {
            writeChar = c;
            console.log('[Bluetooth] Identified known thermal printer characteristic:', c.uuid, 'in service:', sUuid);
            break;
          }
        }
        if (writeChar) break;

        // 1b: Otherwise, check if any characteristic in this printer service has writeWithoutResponse or write
        for (const c of chars) {
          if (!isBlacklistedUuid(c.uuid) && (c.properties.writeWithoutResponse || c.properties.write)) {
            writeChar = c;
            console.log('[Bluetooth] Found writable characteristic in printer service:', c.uuid, 'in service:', sUuid);
            break;
          }
        }
        if (writeChar) break;
      } catch {
        // service uuid not matched on device
      }
    }

    // STEP 2: If none of the known printer service UUIDs matched, query all primary services
    // BUT CRITICAL: STRICTLY FILTER OUT system services (0x1800 Generic Access, 0x1801, 0x180A Device Info, 0x180F Battery)!
    if (!writeChar) {
      try {
        const services = await server.getPrimaryServices();
        for (const service of services) {
          const sUuid = (service.uuid || '').toLowerCase();
          if (isBlacklistedUuid(sUuid)) {
            continue; // NEVER pick Device Name / Generic Access / Battery as printer channel!
          }
          try {
            const characteristics = await service.getCharacteristics();
            // Prioritize known printer char
            for (const char of characteristics) {
              if (isKnownPrinterCharUuid(char.uuid) && (char.properties.write || char.properties.writeWithoutResponse)) {
                writeChar = char;
                break;
              }
            }
            if (writeChar) break;

            // Prioritize writeWithoutResponse (used by almost all ESC/POS thermal printers)
            for (const char of characteristics) {
              if (!isBlacklistedUuid(char.uuid) && char.properties.writeWithoutResponse) {
                writeChar = char;
                break;
              }
            }
            if (writeChar) break;

            // Fallback to write property
            for (const char of characteristics) {
              if (!isBlacklistedUuid(char.uuid) && char.properties.write) {
                writeChar = char;
                break;
              }
            }
            if (writeChar) break;
          } catch {
            // ignore service query error
          }
        }
      } catch (e) {
        console.warn('[Bluetooth] Fallback primary services query failed:', e);
      }
    }

    if (!writeChar) {
      throw new Error(
        `Connected to ${device.name || 'Bluetooth device'}, but could not find the ESC/POS thermal printing channel. Please re-pair the printer.`
      );
    }

    return writeChar;
  }

  /**
   * Attempt silent reconnect to saved printer without triggering browser picker UI
   * Recovers smoothly from both printer reboot and phone Bluetooth adapter toggles!
   */
  public async attemptSilentReconnect(): Promise<boolean> {
    if (this.isConnected()) return true;
    if (this.isConnecting || isRunningInIframe() || !this.isSupported()) return false;

    // Check if phone Bluetooth is available before trying
    const nav = navigator as any;
    if (nav?.bluetooth && typeof nav.bluetooth.getAvailability === 'function') {
      const avail = await nav.bluetooth.getAvailability().catch(() => true);
      this.isRadioAvailable = avail;
      if (!avail) {
        this.notify();
        return false;
      }
    }

    const savedInfo = this.getSavedPrinter();
    if (!savedInfo && !this.device) return false;

    try {
      this.isReconnecting = true;
      this.notify();

      // STRATEGY 1: Prioritize fresh device instances from navigator.bluetooth.getDevices()
      // This is crucial when the phone's Bluetooth was toggled off and on, because Android
      // invalidates in-memory BluetoothDevice JNI wrappers upon radio restart.
      if (nav.bluetooth && typeof nav.bluetooth.getDevices === 'function') {
        try {
          const devices = await nav.bluetooth.getDevices();
          if (devices && devices.length > 0) {
            let matched = savedInfo ? devices.find((d: any) => d.id && d.id === savedInfo.id) : null;
            if (!matched && savedInfo?.name) {
              matched = devices.find((d: any) => d.name && d.name === savedInfo.name);
            }
            if (!matched && devices.length === 1) {
              matched = devices[0];
            }
            if (!matched) {
              matched = devices.find((d: any) => {
                const n = (d.name || '').toLowerCase();
                return (
                  n.includes('print') ||
                  n.includes('pos') ||
                  n.includes('mtp') ||
                  n.includes('rpp') ||
                  n.includes('thermal')
                );
              }) || devices[0];
            }

            if (matched) {
              // Disconnect previous if distinct
              if (this.device && this.device !== matched) {
                try {
                  this.device.gatt?.disconnect();
                } catch {}
              }

              const writeChar = await this.connectGattAndFindCharacteristic(matched);
              if (writeChar) {
                this.device = matched;
                this.attachDeviceListeners(matched);
                this.savePrinterInfo(matched);
                this.characteristic = writeChar;
                this.stopAutoReconnectLoop();
                this.notify();
                await this.processPrintQueue();
                return true;
              }
            }
          }
        } catch (getDevErr) {
          console.warn('[Bluetooth] getDevices reconnect attempt failed:', getDevErr);
        }
      }

      // STRATEGY 2: Fallback to existing memory device reference if getDevices didn't connect
      if (this.device && this.device.gatt) {
        try {
          const writeChar = await this.connectGattAndFindCharacteristic(this.device);
          if (writeChar) {
            this.characteristic = writeChar;
            this.attachDeviceListeners(this.device);
            this.stopAutoReconnectLoop();
            this.notify();
            await this.processPrintQueue();
            return true;
          }
        } catch (staleErr) {
          // Invalidate stale device handle so future attempts don't hang or repeatedly fail
          console.warn('[Bluetooth] Cached device connection failed (stale handle dropped):', staleErr);
          this.device = null;
        }
      }
    } catch {
      // Reconnect attempt failed
    } finally {
      this.isReconnecting = false;
      this.notify();
    }
    return false;
  }

  /**
   * Starts periodic background polling to detect when printer or phone Bluetooth is switched back on
   */
  public startAutoReconnectLoop() {
    if (this.autoReconnectTimer || isRunningInIframe()) return;
    const saved = this.getSavedPrinter();
    if (!saved && !this.device) return;

    if (!this.isRadioAvailable) return;

    let retries = 0;

    this.autoReconnectTimer = setInterval(async () => {
      if (this.isConnected()) {
        this.stopAutoReconnectLoop();
        return;
      }

      // Verify radio is still on before attempting GATT connection
      const nav = navigator as any;
      if (nav?.bluetooth && typeof nav.bluetooth.getAvailability === 'function') {
        const avail = await nav.bluetooth.getAvailability().catch(() => true);
        if (!avail) {
          this.isRadioAvailable = false;
          this.notify();
          this.stopAutoReconnectLoop();
          return;
        }
      }

      const success = await this.attemptSilentReconnect();
      if (success) {
        this.stopAutoReconnectLoop();
      } else {
        retries++;
        // Every 3 failed iterations, discard any cached device to ensure getDevices gets re-polled
        if (retries % 3 === 0) {
          this.device = null;
        }
      }
    }, 3500);
  }

  public stopAutoReconnectLoop() {
    if (this.autoReconnectTimer) {
      clearInterval(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }
  }

  // ============================================================================
  // PERSISTENT PRINT QUEUE (Stores prints when printer is powered off)
  // ============================================================================

  public getPrintQueue(): QueuedPrintJob[] {
    try {
      const stored = localStorage.getItem(PRINT_QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private savePrintQueue(queue: QueuedPrintJob[]) {
    try {
      localStorage.setItem(PRINT_QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // ignore
    }
    this.notifyQueue();
  }

  public enqueuePrintJob(data: ReceiptPrintData, companyId?: string): QueuedPrintJob {
    const queue = this.getPrintQueue();
    const newJob: QueuedPrintJob = {
      id: `PJ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      invoiceId: data.invoiceId,
      companyId: companyId || data.companyId || getCurrentCompany()?.company_id,
      data,
      attempts: 0,
      status: 'pending',
    };

    // Avoid duplicate queueing of the exact same invoice
    const existingIdx = queue.findIndex((j) => j.invoiceId === data.invoiceId);
    if (existingIdx >= 0) {
      queue[existingIdx] = newJob;
    } else {
      queue.push(newJob);
    }

    this.savePrintQueue(queue);
    this.startAutoReconnectLoop();
    return newJob;
  }

  public removePrintJob(id: string): void {
    const queue = this.getPrintQueue().filter((j) => j.id !== id);
    this.savePrintQueue(queue);
  }

  public clearPrintQueue(): void {
    this.savePrintQueue([]);
  }

  /**
   * Drains the queue by printing all pending receipts
   */
  public async processPrintQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const queue = this.getPrintQueue();
    if (queue.length === 0) return { processed: 0, succeeded: 0, failed: 0 };
    if (!this.isConnected()) {
      await this.attemptSilentReconnect();
      if (!this.isConnected()) return { processed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    const remaining: QueuedPrintJob[] = [];

    for (const job of queue) {
      if (!this.isConnected()) {
        remaining.push(job);
        continue;
      }
      try {
        job.attempts += 1;
        job.status = 'printing';
        const bytes = this.generateEscPosReceipt(job.data, job.companyId);
        await this.printBytes(bytes);
        job.status = 'completed';
        succeeded += 1;
        this.notifyQueue(job);
        // Small pause between multiple receipts
        await new Promise((r) => setTimeout(r, 600));
      } catch (err: any) {
        console.warn(`Failed to process queued job ${job.id}:`, err);
        job.status = 'failed';
        job.lastError = err?.message || 'Print error';
        failed += 1;
        remaining.push(job);
      }
    }

    this.savePrintQueue(remaining);
    return { processed: queue.length, succeeded, failed };
  }

  // ============================================================================
  // ESC/POS RECEIPT GENERATOR (Thermal 58mm & 80mm)
  // Clean, professional, NO "Format: Thermal Printer" line, scoped to company
  // ============================================================================

  public generateEscPosReceipt(
    data: ReceiptPrintData,
    targetCompanyId?: string
  ): Uint8Array {
    const effectiveCompanyId = targetCompanyId || data.companyId;
    const config = getPrinterConfig(effectiveCompanyId);
    const width = data.paperWidth || config.paperWidth;
    const maxChars = width === '58mm' ? 32 : 48;

    const buffer: number[] = [];

    // Helper: Add bytes
    const writeBytes = (...bytes: number[]) => buffer.push(...bytes);

    // Helper: Add text string
    const writeText = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        buffer.push(text.charCodeAt(i));
      }
    };

    const writeLine = (text: string = '') => {
      writeText(text);
      writeBytes(0x0a); // LF
    };

    // Helper: Two columns (left-aligned and right-aligned)
    const writeColumns = (left: string, right: string) => {
      const remaining = maxChars - left.length - right.length;
      if (remaining > 0) {
        writeLine(left + ' '.repeat(remaining) + right);
      } else {
        writeLine(left);
        writeLine(' '.repeat(Math.max(0, maxChars - right.length)) + right);
      }
    };

    const divider = (char: string = '-') => {
      writeLine(char.repeat(maxChars));
    };

    // 1. Initialize printer (ESC @)
    writeBytes(0x1b, 0x40);

    // 2. Center Align Header: Store Branding
    writeBytes(0x1b, 0x61, 0x01); // Center align
    writeBytes(0x1b, 0x45, 0x01); // Bold ON
    writeBytes(0x1d, 0x21, 0x11); // Double height + double width

    const storeTitle = data.storeName || config.storeName;
    writeLine(storeTitle);

    writeBytes(0x1d, 0x21, 0x00); // Normal size
    writeBytes(0x1b, 0x45, 0x00); // Bold OFF

    const branchTitle = data.branchName || config.branchName;
    if (branchTitle) writeLine(branchTitle);
    const storeAddress = data.storeAddress || config.storeAddress;
    if (storeAddress) writeLine(storeAddress);
    const storePhone = data.storePhone || config.storePhone;
    if (storePhone) writeLine(`Tel: ${storePhone}`);
    if (config.taxNumber) writeLine(`TIN / Tax: ${config.taxNumber}`);
    divider('=');

    // 3. Left Align Order Details
    writeBytes(0x1b, 0x61, 0x00); // Left align
    writeColumns('Invoice #:', data.invoiceId);
    writeColumns('Date / Time:', data.date);
    if (config.showCashier) {
      writeColumns('Cashier:', data.cashierName);
    }
    if (config.showCustomer && data.customerName) {
      writeColumns('Customer:', data.customerName);
    }
    // REMOVED: Format: Thermal printer line as requested by user
    divider('-');

    // 4. Items Table Header
    writeBytes(0x1b, 0x45, 0x01); // Bold
    if (width === '58mm') {
      writeColumns('ITEM / QTY', 'PRICE');
    } else {
      writeColumns('ITEM DESCRIPTION', 'QTY x PRICE   TOTAL');
    }
    writeBytes(0x1b, 0x45, 0x00); // Bold OFF
    divider('-');

    // 5. Items List
    data.items.forEach((item) => {
      const itemTitle =
        item.name.length > maxChars - 10
          ? item.name.substring(0, maxChars - 10)
          : item.name;
      const totalStr = `$${item.total.toFixed(2)}`;
      writeLine(itemTitle);

      const qtyStr =
        item.quantity % 1 === 0
          ? item.quantity.toString()
          : item.quantity.toFixed(2);
      const qtyPriceStr = `  ${qtyStr} x $${item.unitPrice.toFixed(2)}`;
      writeColumns(qtyPriceStr, totalStr);
    });

    divider('-');

    // 6. Totals & Payment
    writeColumns('Subtotal:', `$${data.subtotal.toFixed(2)}`);
    if (data.discount && data.discount > 0) {
      writeColumns('Discount:', `-$${data.discount.toFixed(2)}`);
    }
    if (data.tax && data.tax > 0) {
      writeColumns('Tax:', `$${data.tax.toFixed(2)}`);
    }

    divider('=');
    writeBytes(0x1b, 0x45, 0x01); // Bold
    writeBytes(0x1d, 0x21, 0x01); // Double height
    writeColumns('TOTAL DUE:', `$${data.total.toFixed(2)}`);
    writeBytes(0x1d, 0x21, 0x00); // Normal
    writeBytes(0x1b, 0x45, 0x00); // Bold OFF
    divider('=');

    if (config.showPaymentMethod) {
      writeColumns('Payment Method:', data.paymentMethod);
    }
    if (data.amountPaid !== undefined && data.amountPaid > 0) {
      writeColumns('Amount Tendered:', `$${data.amountPaid.toFixed(2)}`);
    }

    const effectiveChange =
      data.change !== undefined
        ? data.change
        : data.amountPaid !== undefined
        ? Math.max(0, data.amountPaid - data.total)
        : 0;

    if (data.paymentMethod === 'Cash' || data.amountPaid !== undefined || effectiveChange > 0) {
      writeBytes(0x1b, 0x45, 0x01); // Bold
      writeColumns('CHANGE DUE:', `$${effectiveChange.toFixed(2)}`);
      writeBytes(0x1b, 0x45, 0x00); // Bold OFF
    }

    divider('-');

    // 7. Footer
    writeBytes(0x1b, 0x61, 0x01); // Center
    if (config.footerNote) {
      writeLine(config.footerNote);
    }
    writeLine(`Powered by ${storeTitle}`);
    writeLine('*** CUSTOMER COPY ***');

    // 8. Feed & Partial Cut
    writeBytes(0x0a, 0x0a, 0x0a, 0x0a); // Feed 4 lines
    if (config.autoCut) {
      writeBytes(0x1d, 0x56, 0x41, 0x10); // GS V A (Partial cut)
    }

    return new Uint8Array(buffer);
  }

  /**
   * Send binary ESC/POS payload to Bluetooth printer in chunks.
   * Standard BLE ATT MTU is 23 bytes (20 payload bytes). Sending 20-byte chunks
   * prevents Android Web Bluetooth buffer crashes and ensures compatibility with BT-583 & POS-58.
   */
  public async printBytes(bytes: Uint8Array): Promise<void> {
    if (!this.isConnected()) {
      const reconnected = await this.attemptSilentReconnect();
      if (!reconnected || !this.characteristic) {
        throw new Error('Printer is not connected.');
      }
    }

    if (isBlacklistedUuid(this.characteristic?.uuid)) {
      this.characteristic = await this.connectGattAndFindCharacteristic(this.device);
    }

    const CHUNK_SIZE = 20;

    const hasWriteWithoutResponse =
      Boolean(this.characteristic.properties?.writeWithoutResponse) &&
      typeof this.characteristic.writeValueWithoutResponse === 'function';

    const sendChunk = async (char: any, chunk: Uint8Array) => {
      if (hasWriteWithoutResponse) {
        try {
          await char.writeValueWithoutResponse(chunk);
          return;
        } catch {
          // If writeValueWithoutResponse is rejected by device, fallback below
        }
      }
      if (typeof char.writeValue === 'function') {
        await char.writeValue(chunk);
      } else if (typeof char.writeValueWithResponse === 'function') {
        await char.writeValueWithResponse(chunk);
      }
    };

    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
        await sendChunk(this.characteristic, chunk);
        // 12ms delay to avoid overrun in thermal printer FIFO buffers
        await new Promise((res) => setTimeout(res, 12));
      }
    } catch (writeErr: any) {
      console.warn('[Bluetooth] Write failed mid-transmission, attempting characteristic refresh & retry:', writeErr);
      if (this.device?.gatt?.connected) {
        try {
          this.characteristic = await this.connectGattAndFindCharacteristic(this.device);
          for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
            const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
            await sendChunk(this.characteristic, chunk);
            await new Promise((res) => setTimeout(res, 12));
          }
          return;
        } catch (retryErr) {
          throw writeErr;
        }
      }
      throw writeErr;
    }
  }

  /**
   * High-level helper to print receipt data directly
   * If printer is turned off or disconnected, it saves the job in the print queue and starts listening for turn on
   */
  public async printReceipt(
    data: ReceiptPrintData,
    options?: { companyId?: string; allowQueue?: boolean }
  ): Promise<{ success: boolean; queued: boolean; message: string }> {
    const targetCompId = options?.companyId || data.companyId;

    // 1. If currently connected, print directly
    if (this.isConnected()) {
      try {
        const bytes = this.generateEscPosReceipt(data, targetCompId);
        await this.printBytes(bytes);
        return {
          success: true,
          queued: false,
          message: 'Receipt printed to thermal printer successfully!',
        };
      } catch (err: any) {
        console.warn('Bluetooth print failed mid-transmission:', err);
        if (options?.allowQueue !== false) {
          this.enqueuePrintJob(data, targetCompId);
          this.startAutoReconnectLoop();
          return {
            success: false,
            queued: true,
            message: 'Printer was turned off. Receipt queued and will automatically print when powered on.',
          };
        }
        throw err;
      }
    }

    // 2. Not currently connected: try silent auto-reconnect first
    const reconnected = await this.attemptSilentReconnect();
    if (reconnected) {
      try {
        const bytes = this.generateEscPosReceipt(data, targetCompId);
        await this.printBytes(bytes);
        return {
          success: true,
          queued: false,
          message: 'Printer auto-reconnected and receipt printed!',
        };
      } catch (err: any) {
        console.warn('Error printing after reconnect:', err);
      }
    }

    // 3. Printer is off: Enqueue for auto-printing as soon as printer powers on
    if (options?.allowQueue !== false) {
      this.enqueuePrintJob(data, targetCompId);
      this.startAutoReconnectLoop();
      return {
        success: false,
        queued: true,
        message: 'Printer is turned off. Receipt queued — it will print automatically as soon as you turn the printer on.',
      };
    }

    throw new Error('Bluetooth printer is turned off or disconnected.');
  }
}

export const bluetoothPrinter = new BluetoothThermalPrinter();
