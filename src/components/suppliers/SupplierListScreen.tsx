import React, { useState, useEffect } from 'react';
import {
  Truck,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  FileText,
  DollarSign,
  Receipt,
  Boxes,
  ChevronRight,
  ExternalLink,
  Filter,
  CheckCircle2,
  Building2,
  Calendar,
  Sparkles,
  Download,
  Upload,
} from 'lucide-react';
import { Supplier, SupplierInvoiceVoucher, Salesperson } from '../../types';
import {
  getSuppliers,
  getSupplierStats,
  getSupplierInvoiceVouchers,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import {
  downloadSuppliersCsv,
  parseSuppliersCsv,
  importSuppliersList,
} from '../../services/dataExportImportService';
import { SupplierRegistrationModal } from './SupplierRegistrationModal';
import { SupplierDetailsModal } from './SupplierDetailsModal';

interface SupplierListScreenProps {
  currentUser: Salesperson | null;
  onNavigateToGRN: (supplierName?: string) => void;
  onViewVoucher?: (voucher: SupplierInvoiceVoucher) => void;
}

export const SupplierListScreen: React.FC<SupplierListScreenProps> = ({
  currentUser,
  onNavigateToGRN,
  onViewVoucher,
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getSuppliers());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [selectedSupplierForDetails, setSelectedSupplierForDetails] = useState<Supplier | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const supplierFileInputRef = React.useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleQuickImportSuppliers = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        showToast('Uploaded file is empty.');
        return;
      }
      const res = parseSuppliersCsv(text);
      if (res.suppliers.length === 0) {
        showToast('No valid suppliers found in CSV file.');
        return;
      }
      const importRes = importSuppliersList(res.suppliers, 'merge');
      refreshData();
      showToast(`Imported ${importRes.added} new suppliers, updated ${importRes.updated} profiles!`);
    };
    reader.readAsText(file);
  };

  const refreshData = () => {
    setSuppliers(getSuppliers());
  };

  useEffect(() => {
    const unsub = subscribeRoomDatabase(refreshData);
    return unsub;
  }, []);

  // Compute aggregate metrics
  const vouchers = getSupplierInvoiceVouchers();
  const totalInvoicedSpend = vouchers.reduce((acc, v) => acc + v.totalInvoiceAmount, 0);
  const totalUnitsReceived = vouchers.reduce((acc, v) => acc + v.totalUnits, 0);

  // Categories list
  const categories = ['ALL', ...Array.from(new Set(suppliers.map((s) => s.category).filter(Boolean)))];

  // Filtered suppliers
  const q = (searchQuery || '').trim().toLowerCase();
  const filteredSuppliers = suppliers.filter((s) => {
    const matchesSearch =
      q === '' ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.supplierId && s.supplierId.toLowerCase().includes(q)) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
      (s.phone && s.phone.toLowerCase().includes(q)) ||
      (s.city && s.city.toLowerCase().includes(q));

    const matchesCategory = selectedCategory === 'ALL' || s.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      {/* Top Header */}
      <div className="p-6 bg-slate-850 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shadow-lg shadow-blue-950/40">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white tracking-tight">Supplier Database</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-950 text-blue-400 border border-blue-800">
                  {suppliers.length} Vendors
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage supplier profiles, contact details, payment terms, and complete invoice history
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="btn-export-suppliers-csv"
              onClick={() => {
                downloadSuppliersCsv(filteredSuppliers.length > 0 ? filteredSuppliers : suppliers);
                showToast('Supplier database exported to CSV.');
              }}
              title="Download supplier database to CSV"
              className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              <span>Export CSV</span>
            </button>

            <input
              ref={supplierFileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => e.target.files?.[0] && handleQuickImportSuppliers(e.target.files[0])}
              className="hidden"
            />

            <button
              type="button"
              id="btn-import-suppliers-csv"
              onClick={() => supplierFileInputRef.current?.click()}
              title="Import suppliers from CSV file"
              className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>Import CSV</span>
            </button>

            <button
              onClick={() => onNavigateToGRN()}
              className="px-3.5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-teal-950/40"
            >
              <Receipt className="w-4 h-4" />
              <span>GRN Receiving</span>
            </button>

            <button
              onClick={() => setIsRegisterModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-blue-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>New Supplier</span>
            </button>
          </div>
        </div>

        {toastMessage && (
          <div className="mt-3 max-w-7xl mx-auto bg-emerald-950/80 border border-emerald-500/40 rounded-xl p-2.5 text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* KPI Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-400 block">Total Suppliers</span>
              <span className="text-lg font-black text-white font-mono">{suppliers.length}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-400 block">Total Purchases</span>
              <span className="text-lg font-black text-emerald-400 font-mono">
                ${totalInvoicedSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-400 block">Invoices Processed</span>
              <span className="text-lg font-black text-purple-300 font-mono">{vouchers.length}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-400 block">Total Inward Units</span>
              <span className="text-lg font-black text-teal-300 font-mono">
                {totalUnitsReceived.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by supplier name, ID, contact, phone, city..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-750'
                }`}
              >
                {cat === 'ALL' ? 'All Categories' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Suppliers Grid / List */}
        {filteredSuppliers.length === 0 ? (
          <div className="py-16 text-center bg-slate-850 rounded-2xl border border-slate-800">
            <Truck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">No Suppliers Found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              {searchQuery
                ? `No suppliers match "${searchQuery}". Try a different keyword.`
                : 'No suppliers registered in the database yet.'}
            </p>
            <button
              onClick={() => setIsRegisterModalOpen(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Register New Supplier
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSuppliers.map((supplier) => {
              const stats = getSupplierStats(supplier.supplierId);
              return (
                <div
                  key={supplier.supplierId}
                  onClick={() => setSelectedSupplierForDetails(supplier)}
                  className="p-5 rounded-2xl bg-slate-850 border border-slate-800 hover:border-blue-500/50 transition-all cursor-pointer group hover:shadow-xl hover:shadow-blue-950/20 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Top Row: Name & ID */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-white text-sm group-hover:text-blue-400 transition-colors">
                            {supplier.name}
                          </h3>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                          {supplier.supplierId} • {supplier.category}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {supplier.city || 'Harare'}
                      </span>
                    </div>

                    {/* Contact info */}
                    <div className="space-y-1.5 text-xs text-slate-400">
                      {supplier.contactPerson && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-[11px]">Rep:</span>
                          <span className="text-slate-300 font-medium">{supplier.contactPerson}</span>
                        </div>
                      )}
                      {supplier.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-slate-300 font-mono">{supplier.phone}</span>
                        </div>
                      )}
                      {supplier.paymentTerms && (
                        <div className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-slate-400 text-[11px]">{supplier.paymentTerms}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Financial Stats Bar & Actions */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 block font-semibold">
                        Lifetime Spend
                      </span>
                      <span className="text-sm font-bold font-mono text-emerald-400">
                        ${stats.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {stats.invoiceCount} voucher{stats.invoiceCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onNavigateToGRN(supplier.name)}
                        className="px-2.5 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600 text-teal-300 hover:text-white border border-teal-500/30 text-xs font-bold flex items-center gap-1 transition-all"
                        title="Receive Goods / Post Invoice"
                      >
                        <Plus className="w-3 h-3" />
                        GRN
                      </button>
                      <button
                        onClick={() => setSelectedSupplierForDetails(supplier)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                        title="View Full Profile & Invoices"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Registration Modal */}
      <SupplierRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSupplierCreated={(newSupplier) => {
          refreshData();
          setSelectedSupplierForDetails(newSupplier);
        }}
      />

      {/* Details & Invoices Modal */}
      <SupplierDetailsModal
        supplier={selectedSupplierForDetails}
        isOpen={Boolean(selectedSupplierForDetails)}
        onClose={() => setSelectedSupplierForDetails(null)}
        onCreateGRNForSupplier={(suppName) => {
          setSelectedSupplierForDetails(null);
          onNavigateToGRN(suppName);
        }}
        onViewVoucher={(voucher) => {
          setSelectedSupplierForDetails(null);
          if (onViewVoucher) {
            onViewVoucher(voucher);
          } else {
            onNavigateToGRN();
          }
        }}
      />
    </div>
  );
};
