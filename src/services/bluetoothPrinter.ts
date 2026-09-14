// ============================================================================
// BLUETOOTH THERMAL PRINTER SERVICE (Web Bluetooth ESC/POS 58mm & 80mm)
// ============================================================================

export type PaperWidth = '58mm' | '80mm';

export interface BluetoothPrinterConfig {
  paperWidth: PaperWidth;
  autoCut: boolean;
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  footerNote?: string;
}

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

const DEFAULT_CONFIG: BluetoothPrinterConfig = {
  paperWidth: '58mm',
  autoCut: true,
  storeName: 'SAIMETRIC ENERGY POS',
  storeAddress: 'Harare Commercial Hub',
  storePhone: '+263 77 123 4567',
  footerNote: 'Thank you for your business! No refunds without receipt.',
};

export const getPrinterConfig = (): BluetoothPrinterConfig => {
  try {
    const saved = localStorage.getItem('saimetric_printer_config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {
    console.warn('Failed to load printer config:', e);
  }
  return DEFAULT_CONFIG;
};

export const savePrinterConfig = (config: Partial<BluetoothPrinterConfig>) => {
  const updated = { ...getPrinterConfig(), ...config };
  localStorage.setItem('saimetric_printer_config', JSON.stringify(updated));
  return updated;
};

// Common Bluetooth Printer GATT Service UUIDs
// Many Chinese & portable thermal printers (MTP-II, PT-210, POS-5802, POS-80, Goojprt, Milestone, Rongta, etc.)
// advertise custom services or 000018f0 / 0000ff00 / ISSC / Serial port services
export const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard BLE thermal printers
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent
  '0000e0ff-3c55-4d70-87e5-1a0670fb66d6',
  '0000ff00-0000-1000-8000-00805f9b34fb', // Common serial write service
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent/WeChat standard BT printer
  '000018f1-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
];

export interface PrinterDeviceStatus {
  connected: boolean;
  deviceName?: string;
  isConnecting: boolean;
  lastError?: string;
}

class BluetoothThermalPrinter {
  private device: any = null;
  private characteristic: any = null;
  private isConnecting: boolean = false;
  private listeners: Array<(status: PrinterDeviceStatus) => void> = [];

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  public subscribe(cb: (status: PrinterDeviceStatus) => void): () => void {
    this.listeners.push(cb);
    cb(this.getStatus());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    const status = this.getStatus();
    this.listeners.forEach((l) => l(status));
  }

  public getStatus(): PrinterDeviceStatus {
    return {
      connected: this.isConnected(),
      deviceName: this.device?.name || (this.isConnected() ? 'Bluetooth Printer' : undefined),
      isConnecting: this.isConnecting,
    };
  }

  public getConnectedDeviceName(): string | null {
    return this.device?.name || null;
  }

  public isConnected(): boolean {
    return !!(this.device && this.device.gatt && this.device.gatt.connected && this.characteristic);
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

    try {
      this.isConnecting = true;
      this.notify();
      const nav = navigator as any;

      let device: any;
      try {
        // Request device with common printer services or acceptAllDevices
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

      // Hook disconnect event
      device.addEventListener('gattserverdisconnected', () => {
        console.log('Bluetooth printer disconnected.');
        this.characteristic = null;
        this.notify();
      });

      const server = await device.gatt.connect();

      // Find writeable characteristic
      let writeChar: any = null;

      try {
        const services = await server.getPrimaryServices();
        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (
                char.properties.write ||
                char.properties.writeWithoutResponse
              ) {
                writeChar = char;
                break;
              }
            }
          } catch (e) {
            console.warn('Error querying service characteristics:', e);
          }
          if (writeChar) break;
        }
      } catch (e) {
        console.warn('Error querying primary services:', e);
      }

      // Fallback: Try specific well known service directly if discovery was restricted
      if (!writeChar) {
        for (const sUuid of PRINTER_SERVICE_UUIDS) {
          try {
            const s = await server.getPrimaryService(sUuid);
            const chars = await s.getCharacteristics();
            for (const c of chars) {
              if (c.properties.write || c.properties.writeWithoutResponse) {
                writeChar = c;
                break;
              }
            }
            if (writeChar) break;
          } catch {
            // Service not supported on this device, continue
          }
        }
      }

      if (!writeChar) {
        throw new Error(
          'Connected to device, but could not find a writeable communication channel. Ensure the printer is turned on and paired.'
        );
      }

      this.device = device;
      this.characteristic = writeChar;
      this.notify();
      return true;
    } finally {
      this.isConnecting = false;
      this.notify();
    }
  }

  /**
   * Format ESC/POS Receipt buffer for 58mm (32 columns) or 80mm (48 columns)
   */
  public generateEscPosReceipt(data: {
    invoiceId: string;
    date: string;
    cashierName: string;
    customerName?: string;
    items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    discount?: number;
    total: number;
    amountPaid?: number;
    change?: number;
    paymentMethod: string;
    paperWidth: PaperWidth;
  }): Uint8Array {
    const width = data.paperWidth;
    const maxChars = width === '58mm' ? 32 : 48;
    const config = getPrinterConfig();

    const buffer: number[] = [];

    // Helper: Add bytes
    const writeBytes = (...bytes: number[]) => buffer.push(...bytes);

    // Helper: Add string with line feed
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

    // 2. Center Align Header
    writeBytes(0x1b, 0x61, 0x01); // Center align
    writeBytes(0x1b, 0x45, 0x01); // Bold ON
    writeBytes(0x1d, 0x21, 0x11); // Double height + double width
    writeLine(config.storeName);
    writeBytes(0x1d, 0x21, 0x00); // Normal size
    writeBytes(0x1b, 0x45, 0x00); // Bold OFF

    if (config.storeAddress) writeLine(config.storeAddress);
    if (config.storePhone) writeLine(`Tel: ${config.storePhone}`);
    divider('=');

    // 3. Left Align Order Details
    writeBytes(0x1b, 0x61, 0x00); // Left align
    writeColumns('Invoice #:', data.invoiceId);
    writeColumns('Date / Time:', data.date);
    writeColumns('Cashier:', data.cashierName);
    if (data.customerName) {
      writeColumns('Customer:', data.customerName);
    }
    writeColumns('Format:', `${width} Thermal`);
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

    divider('=');
    writeBytes(0x1b, 0x45, 0x01); // Bold
    writeBytes(0x1d, 0x21, 0x01); // Double height
    writeColumns('TOTAL DUE:', `$${data.total.toFixed(2)}`);
    writeBytes(0x1d, 0x21, 0x00); // Normal
    writeBytes(0x1b, 0x45, 0x00); // Bold OFF
    divider('=');

    writeColumns('Payment Method:', data.paymentMethod);
    if (data.amountPaid !== undefined && data.amountPaid > 0) {
      writeColumns('Amount Tendered:', `$${data.amountPaid.toFixed(2)}`);
    }
    if (data.change !== undefined && data.change >= 0) {
      writeColumns('Change Returned:', `$${data.change.toFixed(2)}`);
    }

    divider('-');

    // 7. Footer
    writeBytes(0x1b, 0x61, 0x01); // Center
    if (config.footerNote) {
      writeLine(config.footerNote);
    }
    writeLine('Powered by SAIMETRIC POS');
    writeLine('*** CUSTOMER COPY ***');

    // 8. Feed & Partial Cut
    writeBytes(0x0a, 0x0a, 0x0a, 0x0a); // Feed 4 lines
    if (config.autoCut) {
      writeBytes(0x1d, 0x56, 0x41, 0x10); // GS V A (Partial cut)
    }

    return new Uint8Array(buffer);
  }

  /**
   * Send binary ESC/POS payload to Bluetooth printer in chunks
   */
  public async printBytes(bytes: Uint8Array): Promise<void> {
    if (!this.isConnected()) {
      const connected = await this.connect();
      if (!connected) throw new Error('Printer connection failed.');
    }

    const CHUNK_SIZE = 100; // BLE characteristic MTU safety chunk size
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
      if (this.characteristic.writeValueWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
      // Small delay to prevent BLE receiver buffer overrun
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  /**
   * High-level helper to print receipt data directly
   */
  public async printReceipt(data: {
    invoiceId: string;
    date: string;
    cashierName: string;
    customerName?: string;
    items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    discount?: number;
    total: number;
    amountPaid?: number;
    change?: number;
    paymentMethod: string;
    paperWidth: PaperWidth;
  }): Promise<void> {
    const bytes = this.generateEscPosReceipt(data);
    await this.printBytes(bytes);
  }
}

export const bluetoothPrinter = new BluetoothThermalPrinter();
