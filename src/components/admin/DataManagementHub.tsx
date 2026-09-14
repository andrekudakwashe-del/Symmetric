import React, { useState, useRef } from 'react';
import {
  Download,
  Upload,
  FileSpreadsheet,
  Database,
  Users,
  Building2,
  Package,
  CheckCircle2,
  AlertTriangle,
  FileText,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Search,
  Check,
  X,
  FileJson,
  Layers,
  Activity,
  Coins,
  CreditCard,
  Banknote,
  Receipt,
  Info,
} from 'lucide-react';
import { Salesperson, InventoryItem, Customer, Supplier } from '../../types';
import {
  getInventoryItems,
  getCustomers,
  getSuppliers,
  getCashCounts,
  getCashLogs,
  getExpenses,
  getCreditSales,
  getCustomerChanges,
  getReconciliations,
  getGoodsReceived,
  getSupplierInvoiceVouchers,
  getStockMovements,
  getSales,
} from '../../db/roomDatabase';
import {
  downloadInventoryCsv,
  downloadInventoryJson,
  downloadInventoryTemplateCsv,
  parseInventoryCsv,
  importInventoryItems,
  downloadCustomersCsv,
  downloadCustomersJson,
  downloadCustomerTemplateCsv,
  parseCustomersCsv,
  importCustomersList,
  downloadSuppliersCsv,
  downloadSuppliersJson,
  downloadSupplierTemplateCsv,
  parseSuppliersCsv,
  importSuppliersList,
  ALL_SYSTEM_REPORTS,
  SystemReportType,
  downloadReportCsv,
  downloadAllReportsCombinedJson,
} from '../../services/dataExportImportService';

interface DataManagementHubProps {
  currentUser: Salesperson | null;
  initialTab?: 'inventory' | 'customers' | 'suppliers' | 'reports';
  onNavigateHome?: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const DataManagementHub: React.FC<DataManagementHubProps> = ({
  currentUser,
  initialTab = 'inventory',
  onNavigateHome,
  onNavigateTab,
}) => {
  const isAdmin = currentUser?.role === 'Admin';
  const [activeTab, setActiveTab] = useState<'inventory' | 'customers' | 'suppliers' | 'reports'>(initialTab);

  // File upload states
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isProcessing, setIsProcessing] = useState(false);

  // Parsed preview states
  const [parsedInventory, setParsedInventory] = useState<InventoryItem[] | null>(null);
  const [parsedCustomers, setParsedCustomers] = useState<Customer[] | null>(null);
  const [parsedSuppliers, setParsedSuppliers] = useState<Supplier[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  // Search filter for reports export grid
  const [reportSearch, setReportSearch] = useState('');
  const [reportCategory, setReportCategory] = useState<string>('ALL');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Counts for summary metrics
  const inventoryItems = getInventoryItems();
  const customers = getCustomers();
  const suppliers = getSuppliers();
  const sales = getSales();
  const vouchers = getSupplierInvoiceVouchers();
  const recons = getReconciliations();

  // Reset file preview on tab change
  const handleTabChange = (tab: 'inventory' | 'customers' | 'suppliers' | 'reports') => {
    setActiveTab(tab);
    setUploadedFileName(null);
    setParsedInventory(null);
    setParsedCustomers(null);
    setParsedSuppliers(null);
    setParseErrors([]);
    setImportSuccessMessage(null);
  };

  // Handle file drop / select
  const handleFileSelect = (file: File) => {
    setUploadedFileName(file.name);
    setParseErrors([]);
    setImportSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setParseErrors(['Selected file is empty.']);
        return;
      }

      if (activeTab === 'inventory') {
        if (file.name.endsWith('.json')) {
          try {
            const json = JSON.parse(text);
            const items = Array.isArray(json) ? json : json.inventory || [];
            setParsedInventory(items);
          } catch (err: any) {
            setParseErrors([`Invalid JSON: ${err.message}`]);
          }
        } else {
          const result = parseInventoryCsv(text);
          setParsedInventory(result.items);
          setParseErrors(result.errors);
        }
      } else if (activeTab === 'customers') {
        if (file.name.endsWith('.json')) {
          try {
            const json = JSON.parse(text);
            const list = Array.isArray(json) ? json : json.customers || [];
            setParsedCustomers(list);
          } catch (err: any) {
            setParseErrors([`Invalid JSON: ${err.message}`]);
          }
        } else {
          const result = parseCustomersCsv(text);
          setParsedCustomers(result.customers);
          setParseErrors(result.errors);
        }
      } else if (activeTab === 'suppliers') {
        if (file.name.endsWith('.json')) {
          try {
            const json = JSON.parse(text);
            const list = Array.isArray(json) ? json : json.suppliers || [];
            setParsedSuppliers(list);
          } catch (err: any) {
            setParseErrors([`Invalid JSON: ${err.message}`]);
          }
        } else {
          const result = parseSuppliersCsv(text);
          setParsedSuppliers(result.suppliers);
          setParseErrors(result.errors);
        }
      }
    };

    reader.readAsText(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // Perform Final Import
  const handleExecuteImport = () => {
    setIsProcessing(true);
    setImportSuccessMessage(null);

    setTimeout(() => {
      if (activeTab === 'inventory' && parsedInventory) {
        const res = importInventoryItems(parsedInventory, importMode);
        if (res.errors.length > 0) {
          setParseErrors(res.errors);
        }
        setImportSuccessMessage(
          `Successfully processed Inventory import! Added ${res.added} new products and updated ${res.updated} existing items.`
        );
        setParsedInventory(null);
        setUploadedFileName(null);
      } else if (activeTab === 'customers' && parsedCustomers) {
        const res = importCustomersList(parsedCustomers, importMode);
        if (res.errors.length > 0) {
          setParseErrors(res.errors);
        }
        setImportSuccessMessage(
          `Successfully processed Customers import! Added ${res.added} new customers and updated ${res.updated} existing profiles.`
        );
        setParsedCustomers(null);
        setUploadedFileName(null);
      } else if (activeTab === 'suppliers' && parsedSuppliers) {
        const res = importSuppliersList(parsedSuppliers, importMode);
        if (res.errors.length > 0) {
          setParseErrors(res.errors);
        }
        setImportSuccessMessage(
          `Successfully processed Suppliers import! Added ${res.added} new vendors and updated ${res.updated} existing profiles.`
        );
        setParsedSuppliers(null);
        setUploadedFileName(null);
      }
      setIsProcessing(false);
    }, 400);
  };

  // Filtered reports list
  const filteredReports = ALL_SYSTEM_REPORTS.filter((r) => {
    const q = (reportSearch || '').trim().toLowerCase();
    const matchesSearch =
      !q ||
      (r.title && r.title.toLowerCase().includes(q)) ||
      (r.description && r.description.toLowerCase().includes(q)) ||
      (r.badge && r.badge.toLowerCase().includes(q));
    const matchesCat = reportCategory === 'ALL' || r.category === reportCategory;
    return matchesSearch && matchesCat;
  });

  const reportCategories = ['ALL', 'Cash Balancing', 'Debtors & Change', 'Inventory & Warehouse', 'POS & Sales', 'System'];

  return (
    <div className="space-y-5 pb-28 animate-fadeIn text-slate-100 max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950 border border-indigo-500/30 rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-950/50">
              <Database className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  Admin Data Center
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Admin Authorized
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-xl">
                Import & Export catalog master data for <strong>Inventory</strong>, <strong>Customers</strong>, and <strong>Suppliers</strong>, or export instant audit reports and database backups.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadAllReportsCombinedJson}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center gap-2 transition active:scale-95"
              title="Export complete master system backup in structured JSON format"
            >
              <Download className="w-4 h-4" />
              <span>Export Full System Backup</span>
            </button>
          </div>
        </div>

        {/* Quick Database Stat Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">Inventory</div>
              <div className="text-sm font-black text-white font-mono-num">{inventoryItems.length} Products</div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">Customers</div>
              <div className="text-sm font-black text-white font-mono-num">{customers.length} Accounts</div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">Suppliers</div>
              <div className="text-sm font-black text-white font-mono-num">{suppliers.length} Vendors</div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">Reports</div>
              <div className="text-sm font-black text-emerald-400 font-mono-num">12 System Ledgers</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tab Bar */}
      <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => handleTabChange('inventory')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'inventory'
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>1. Inventory ({inventoryItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('customers')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'customers'
              ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md shadow-blue-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>2. Customers ({customers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('suppliers')}
          className={`flex-1 min-w-[130px] py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'suppliers'
              ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-md shadow-cyan-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>3. Suppliers ({suppliers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('reports')}
          className={`flex-1 min-w-[160px] py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'reports'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>📊 Export All Reports (12)</span>
        </button>
      </div>

      {/* Notification / Success Alerts */}
      {importSuccessMessage && (
        <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-4 flex items-center gap-3 text-emerald-300 animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
          <div className="text-xs font-semibold flex-1">{importSuccessMessage}</div>
          <button
            type="button"
            onClick={() => setImportSuccessMessage(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="bg-rose-950/60 border border-rose-500/40 rounded-2xl p-4 space-y-1 text-rose-300 animate-fadeIn">
          <div className="flex items-center gap-2 font-bold text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            File Validation Errors Detected ({parseErrors.length})
          </div>
          <ul className="text-xs list-disc list-inside space-y-0.5 text-rose-300/90 pl-1">
            {parseErrors.slice(0, 5).map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
            {parseErrors.length > 5 && <li>...and {parseErrors.length - 5} more issues.</li>}
          </ul>
        </div>
      )}

      {/* TAB 1: INVENTORY IMPORT & EXPORT */}
      {activeTab === 'inventory' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Export Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Export Inventory Master</h3>
                    <p className="text-xs text-slate-400">Download active products, packaging ratios & costings</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {inventoryItems.length} SKUs
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Export includes complete product catalog records: <strong>Item ID, Item Name, Category, Units per Case, Cost/Case, Sell Price/Case, Sell Price/Unit, Stock Cases, Stock Singles, and Total Units</strong>.
              </p>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-2 text-xs">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-indigo-400" />
                  Compatible Applications
                </div>
                <p className="text-slate-400 text-[11px]">
                  Compatible with Microsoft Excel, Google Sheets, LibreOffice Calc, and standard ERP / POS import formats.
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => downloadInventoryCsv()}
                  className="py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Inventory CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadInventoryJson()}
                  className="py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileJson className="w-4 h-4 text-indigo-400" />
                  <span>Download JSON Backup</span>
                </button>
              </div>

              <button
                type="button"
                onClick={downloadInventoryTemplateCsv}
                className="w-full py-2 px-3 text-xs text-indigo-400 hover:text-indigo-300 hover:underline flex items-center justify-center gap-1.5 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                Download Sample Inventory Template (.csv)
              </button>
            </div>
          </div>

          {/* Import Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Import Inventory</h3>
                  <p className="text-xs text-slate-400">Bulk upload new products or update existing stock</p>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'merge' ? 'bg-indigo-600 text-white' : 'text-slate-400'
                  }`}
                  title="Merge new items and update matching Item IDs"
                >
                  Merge / Update
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'replace' ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                  title="Wipe and replace entire catalog with uploaded file"
                >
                  Replace All
                </button>
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-950/30'
                  : 'border-slate-750 hover:border-indigo-500/50 bg-slate-950/40 hover:bg-slate-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-indigo-400">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">
                  {uploadedFileName ? (
                    <span className="text-emerald-400">File Selected: {uploadedFileName}</span>
                  ) : (
                    'Click to upload or drag & drop inventory file'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Supports .CSV (comma delimited) or .JSON files</p>
              </div>
            </div>

            {/* Parsed Preview Table */}
            {parsedInventory && (
              <div className="space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {parsedInventory.length} Items Validated & Ready to Import
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedInventory(null);
                      setUploadedFileName(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Item ID</th>
                        <th className="py-2 px-3">Item Name</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3 text-right">Units/cs</th>
                        <th className="py-2 px-3 text-right">Cost/cs</th>
                        <th className="py-2 px-3 text-right">Sell/Unit</th>
                        <th className="py-2 px-3 text-right">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {parsedInventory.slice(0, 8).map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="py-1.5 px-3 font-mono font-bold text-indigo-300">{item.itemId}</td>
                          <td className="py-1.5 px-3 font-medium text-white">{item.itemName}</td>
                          <td className="py-1.5 px-3 text-slate-400">{item.category}</td>
                          <td className="py-1.5 px-3 text-right font-mono-num">{item.unitsPerCase}</td>
                          <td className="py-1.5 px-3 text-right font-mono-num">${item.costPerCase.toFixed(2)}</td>
                          <td className="py-1.5 px-3 text-right font-mono-num text-emerald-400 font-bold">
                            ${item.sellPriceUnit.toFixed(2)}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono-num text-amber-300">
                            {item.stockCases}cs / {item.stockSingles}s
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedInventory.length > 8 && (
                    <div className="p-2 text-center text-[10px] text-slate-500 bg-slate-900/80">
                      ...and {parsedInventory.length - 8} more rows
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Importing Inventory...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm & Commit Import ({parsedInventory.length} Items)</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMERS IMPORT & EXPORT */}
      {activeTab === 'customers' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Export Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Export Customer Directory</h3>
                    <p className="text-xs text-slate-400">Download customer database with live balances & debts</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-blue-950 text-blue-300 border border-blue-800">
                  {customers.length} Accounts
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Export includes customer contact details, registration dates, <strong>Outstanding Form 3 Credit Debts</strong>, and <strong>Customer Change Held in Trust</strong>.
              </p>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-2 text-xs">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  WhatsApp & Ledger Integration
                </div>
                <p className="text-slate-400 text-[11px]">
                  Exported CSV can be used for CRM marketing, SMS/WhatsApp broadcast reminders, or financial debtor audits.
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => downloadCustomersCsv()}
                  className="py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-950/50 flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Customers CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadCustomersJson()}
                  className="py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileJson className="w-4 h-4 text-blue-400" />
                  <span>Download JSON Backup</span>
                </button>
              </div>

              <button
                type="button"
                onClick={downloadCustomerTemplateCsv}
                className="w-full py-2 px-3 text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center justify-center gap-1.5 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                Download Sample Customer Template (.csv)
              </button>
            </div>
          </div>

          {/* Import Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Import Customers</h3>
                  <p className="text-xs text-slate-400">Bulk register new customers or update profiles</p>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'merge' ? 'bg-blue-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Merge / Update
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'replace' ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Replace All
                </button>
              </div>
            </div>

            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
                dragActive
                  ? 'border-blue-500 bg-blue-950/30'
                  : 'border-slate-750 hover:border-blue-500/50 bg-slate-950/40 hover:bg-slate-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-blue-400">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">
                  {uploadedFileName ? (
                    <span className="text-emerald-400">File Selected: {uploadedFileName}</span>
                  ) : (
                    'Click to upload or drag & drop customer file'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Supports .CSV (comma delimited) or .JSON files</p>
              </div>
            </div>

            {/* Parsed Preview Table */}
            {parsedCustomers && (
              <div className="space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {parsedCustomers.length} Customers Validated & Ready
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedCustomers(null);
                      setUploadedFileName(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Customer ID</th>
                        <th className="py-2 px-3">Name</th>
                        <th className="py-2 px-3">Phone</th>
                        <th className="py-2 px-3">Address</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {parsedCustomers.slice(0, 8).map((cust, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="py-1.5 px-3 font-mono font-bold text-blue-300">{cust.customerId}</td>
                          <td className="py-1.5 px-3 font-medium text-white">{cust.name}</td>
                          <td className="py-1.5 px-3 text-slate-400">{cust.phone || '—'}</td>
                          <td className="py-1.5 px-3 text-slate-400 truncate max-w-[150px]">{cust.address || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Importing Customers...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm & Commit Import ({parsedCustomers.length} Customers)</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIERS IMPORT & EXPORT */}
      {activeTab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Export Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Export Supplier Database</h3>
                    <p className="text-xs text-slate-400">Download vendor profiles, terms, tax IDs & invoice history</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {suppliers.length} Vendors
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Export includes complete vendor records: <strong>Supplier ID, Company Name, Category, Contact Person, Phone, Email, Payment Terms, Tax Number, and Invoiced Spend totals</strong>.
              </p>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-2 text-xs">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-cyan-400" />
                  Supply Chain & Procurement
                </div>
                <p className="text-slate-400 text-[11px]">
                  Use supplier exports for purchasing audits, payment reconciliation, or vendor evaluation.
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => downloadSuppliersCsv()}
                  className="py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Suppliers CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadSuppliersJson()}
                  className="py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <FileJson className="w-4 h-4 text-cyan-400" />
                  <span>Download JSON Backup</span>
                </button>
              </div>

              <button
                type="button"
                onClick={downloadSupplierTemplateCsv}
                className="w-full py-2 px-3 text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center justify-center gap-1.5 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                Download Sample Supplier Template (.csv)
              </button>
            </div>
          </div>

          {/* Import Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-teal-600/20 border border-teal-500/30 text-teal-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Import Suppliers</h3>
                  <p className="text-xs text-slate-400">Bulk register vendor profiles or update contact terms</p>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'merge' ? 'bg-cyan-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Merge / Update
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    importMode === 'replace' ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Replace All
                </button>
              </div>
            </div>

            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
                dragActive
                  ? 'border-cyan-500 bg-cyan-950/30'
                  : 'border-slate-750 hover:border-cyan-500/50 bg-slate-950/40 hover:bg-slate-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-cyan-400">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">
                  {uploadedFileName ? (
                    <span className="text-emerald-400">File Selected: {uploadedFileName}</span>
                  ) : (
                    'Click to upload or drag & drop supplier file'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Supports .CSV (comma delimited) or .JSON files</p>
              </div>
            </div>

            {/* Parsed Preview Table */}
            {parsedSuppliers && (
              <div className="space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {parsedSuppliers.length} Suppliers Validated & Ready
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedSuppliers(null);
                      setUploadedFileName(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Supplier ID</th>
                        <th className="py-2 px-3">Company Name</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Terms</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {parsedSuppliers.slice(0, 8).map((sup, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="py-1.5 px-3 font-mono font-bold text-cyan-300">{sup.supplierId}</td>
                          <td className="py-1.5 px-3 font-medium text-white">{sup.name}</td>
                          <td className="py-1.5 px-3 text-slate-400">{sup.category}</td>
                          <td className="py-1.5 px-3 text-slate-300 font-mono-num">{sup.paymentTerms}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Importing Suppliers...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm & Commit Import ({parsedSuppliers.length} Suppliers)</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: ALL REPORTS EXPORT CENTER (EXPORT ONLY) */}
      {activeTab === 'reports' && (
        <div className="space-y-5 animate-fadeIn">
          {/* Header Description */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white">Export All Reports & Ledgers</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Export Only
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Instant, single-click CSV export for all 12 operational reports, ledgers, audit trails, and reconciliation statements.
                </p>
              </div>

              <button
                type="button"
                onClick={downloadAllReportsCombinedJson}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 flex items-center gap-2 transition active:scale-95"
              >
                <Download className="w-4 h-4" />
                <span>Export All 12 Reports (Master Backup)</span>
              </button>
            </div>

            {/* Filter Search & Categories */}
            <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Search report name, form number, category..."
                  className="w-full pl-10 pr-4 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                {reportCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setReportCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                      reportCategory === cat
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reports Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReports.map((report) => {
              return (
                <div
                  key={report.type}
                  className="bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-3xl p-5 flex flex-col justify-between space-y-4 transition shadow-sm hover:shadow-md"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black text-white bg-gradient-to-r ${report.color} shadow-sm`}>
                        {report.badge}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                        {report.category}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-black text-white">{report.title}</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{report.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => downloadReportCsv(report.type)}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white font-bold text-xs border border-slate-700 hover:border-emerald-500 flex items-center justify-center gap-2 transition active:scale-95 group"
                  >
                    <Download className="w-4 h-4 text-emerald-400 group-hover:text-white transition" />
                    <span>Download Report CSV</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
