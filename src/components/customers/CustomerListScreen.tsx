import React, { useState, useMemo } from 'react';
import { Customer, Salesperson } from '../../types';
import {
  getCustomers,
  getSales,
  getCustomerCreditReport,
  getCustomerChangeReport,
} from '../../db/roomDatabase';
import { CustomerRegistrationModal } from './CustomerRegistrationModal';
import {
  downloadCustomersCsv,
  parseCustomersCsv,
  importCustomersList,
} from '../../services/dataExportImportService';
import {
  Users,
  UserPlus,
  Search,
  Phone,
  MapPin,
  Calendar,
  User,
  ShoppingBag,
  Download,
  Upload,
  ExternalLink,
  ChevronRight,
  CreditCard,
  Coins,
  Receipt,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

interface CustomerListScreenProps {
  currentUser: Salesperson;
  onSelectCustomerForSale?: (customer: Customer) => void;
  onNavigateToCreditReport?: (customerName: string) => void;
  onNavigateToChangeReport?: (customerName: string) => void;
}

export const CustomerListScreen: React.FC<CustomerListScreenProps> = ({
  currentUser,
  onSelectCustomerForSale,
  onNavigateToCreditReport,
  onNavigateToChangeReport,
}) => {
  const [search, setSearch] = useState('');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const customerFileInputRef = React.useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleQuickImportCustomers = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        showToast('Uploaded file is empty.');
        return;
      }
      const res = parseCustomersCsv(text);
      if (res.customers.length === 0) {
        showToast('No valid customers found in CSV file.');
        return;
      }
      const importRes = importCustomersList(res.customers, 'merge');
      showToast(`Imported ${importRes.added} new customers, updated ${importRes.updated} profiles!`);
    };
    reader.readAsText(file);
  };

  const customers = getCustomers();
  const sales = getSales();
  const creditReport = useMemo(() => getCustomerCreditReport(), []);
  const changeReport = useMemo(() => getCustomerChangeReport(), []);

  const cleanSearch = (search || '').trim().toLowerCase();
  const filtered = customers.filter(
    (c) =>
      (c.name && c.name.toLowerCase().includes(cleanSearch)) ||
      (c.customerId && c.customerId.toLowerCase().includes(cleanSearch)) ||
      (c.phone && c.phone.toLowerCase().includes(cleanSearch)) ||
      (c.address && c.address.toLowerCase().includes(cleanSearch))
  );

  const getCustomerSalesCount = (customerId: string, customerName: string) => {
    const targetName = (customerName || '').toLowerCase().trim();
    return sales.filter(
      (s) =>
        (customerId && s.customerId === customerId) ||
        (s.customerName && targetName && s.customerName.toLowerCase().trim() === targetName)
    ).length;
  };

  const getCustomerTotalSpend = (customerId: string, customerName: string) => {
    const targetName = (customerName || '').toLowerCase().trim();
    return sales
      .filter(
        (s) =>
          (customerId && s.customerId === customerId) ||
          (s.customerName && targetName && s.customerName.toLowerCase().trim() === targetName)
      )
      .reduce((acc, s) => acc + (s.total || 0), 0);
  };

  const getCustomerCreditBalance = (customerName: string) => {
    if (!customerName) return 0;
    const targetName = customerName.toLowerCase().trim();
    const found = creditReport?.items?.find(
      (item) => item.customerName && item.customerName.toLowerCase().trim() === targetName
    );
    return found ? found.netDebtOwed : 0;
  };

  const getCustomerChangeBalance = (customerName: string) => {
    if (!customerName) return 0;
    const targetName = customerName.toLowerCase().trim();
    const found = changeReport?.items?.find(
      (item) => item.customerName && item.customerName.toLowerCase().trim() === targetName
    );
    return found ? found.netChangeOwed : 0;
  };

  return (
    <div className="space-y-4 pb-28 select-none">
      {/* Header Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white shadow-md">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight">Customer Database (Merged)</h2>
              <p className="text-xs text-slate-400">
                Unified across POS & Cash Balancing • <span className="font-mono-num font-bold text-orange-400">{customers.length}</span> Registered Customers
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="btn-export-customers-csv"
              type="button"
              onClick={() => {
                downloadCustomersCsv(filtered.length > 0 ? filtered : customers);
                showToast('Customer directory exported to CSV.');
              }}
              title="Download full customer database with balances"
              className="py-2.5 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>

            <input
              ref={customerFileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => e.target.files?.[0] && handleQuickImportCustomers(e.target.files[0])}
              className="hidden"
            />

            <button
              id="btn-import-customers-csv"
              type="button"
              onClick={() => customerFileInputRef.current?.click()}
              title="Import customers from CSV file"
              className="py-2.5 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Import CSV</span>
            </button>

            <button
              id="btn-register-customer-header"
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white text-xs font-bold shadow-lg flex items-center space-x-2 transition active:scale-95"
            >
              <UserPlus className="w-4 h-4" />
              <span>Register Customer</span>
            </button>
          </div>
        </div>

        {toastMessage && (
          <div className="mt-3 bg-emerald-950/80 border border-emerald-500/40 rounded-xl p-2.5 text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Search Bar */}
        <div className="mt-4 relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            id="input-customer-directory-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers by name, ID (C001), phone, address..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 focus:border-[#6A4DFF] focus:ring-2 focus:ring-[#6A4DFF]/30 rounded-2xl text-sm text-white placeholder-slate-500 transition outline-none"
          />
        </div>
      </div>

      {/* Customer Grid / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center text-slate-400">
            <Users className="w-12 h-12 mx-auto text-slate-600 mb-2" />
            <p className="text-base font-bold text-slate-300">No Customers Found</p>
            <p className="text-xs text-slate-500 mt-1">Try another search or register a new customer.</p>
            <button
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="mt-4 px-4 py-2 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white text-xs font-bold shadow-md inline-flex items-center space-x-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>Register New Customer</span>
            </button>
          </div>
        ) : (
          filtered.map((customer) => {
            const salesCount = getCustomerSalesCount(customer.customerId, customer.name);
            const totalSpend = getCustomerTotalSpend(customer.customerId, customer.name);
            const creditDebt = getCustomerCreditBalance(customer.name);
            const changeOwed = getCustomerChangeBalance(customer.name);

            return (
              <div
                key={customer.customerId}
                id={`customer-card-${customer.customerId}`}
                className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-4 shadow-md backdrop-blur-sm flex flex-col justify-between hover:border-purple-500/40 transition group"
              >
                <div>
                  {/* Top: Customer ID Badge & Date */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono-num font-black text-xs px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-950 to-slate-900 text-[#FF8A00] border border-purple-800/60">
                      {customer.customerId}
                    </span>
                    <div className="flex items-center space-x-1 text-[11px] text-slate-400">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      <span>{customer.createdDate}</span>
                    </div>
                  </div>

                  {/* Customer Name */}
                  <h3 className="text-base font-bold text-white group-hover:text-purple-300 transition">
                    {customer.name}
                  </h3>

                  {/* Phone & Address */}
                  <div className="mt-2.5 space-y-1.5 text-xs text-slate-300">
                    {customer.phone ? (
                      <a
                        href={`tel:${customer.phone}`}
                        className="flex items-center space-x-2 text-slate-300 hover:text-orange-400 transition"
                      >
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono-num font-medium">{customer.phone}</span>
                      </a>
                    ) : (
                      <div className="flex items-center space-x-2 text-slate-500 italic">
                        <Phone className="w-3.5 h-3.5 text-slate-600" />
                        <span>No phone recorded</span>
                      </div>
                    )}

                    {customer.address ? (
                      <div className="flex items-center space-x-2 text-slate-400">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="truncate">{customer.address}</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2 text-slate-500 italic">
                        <MapPin className="w-3.5 h-3.5 text-slate-600" />
                        <span>No address recorded</span>
                      </div>
                    )}
                  </div>

                  {/* Real-time Balances (Credit Debt & Change) */}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 font-semibold block flex items-center space-x-1">
                        <CreditCard className="w-3 h-3 text-rose-400" />
                        <span>Credit Debt</span>
                      </span>
                      <span
                        className={`text-xs font-mono font-bold block mt-0.5 ${
                          creditDebt > 0 ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        ${creditDebt.toFixed(2)}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 font-semibold block flex items-center space-x-1">
                        <Coins className="w-3 h-3 text-amber-400" />
                        <span>Change Held</span>
                      </span>
                      <span
                        className={`text-xs font-mono font-bold block mt-0.5 ${
                          changeOwed > 0 ? 'text-amber-400' : 'text-slate-400'
                        }`}
                      >
                        ${changeOwed.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom: Sales Metrics & Action */}
                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center space-x-3 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Sales</span>
                      <span className="font-mono-num font-bold text-white">{salesCount}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Spent</span>
                      <span className="font-mono-num font-bold text-emerald-400">${totalSpend.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {onNavigateToCreditReport && creditDebt > 0 && (
                      <button
                        type="button"
                        onClick={() => onNavigateToCreditReport(customer.name)}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-[11px] font-bold transition"
                        title="View Credit Debt Ledger"
                      >
                        Credit &gt;
                      </button>
                    )}

                    {onSelectCustomerForSale && (
                      <button
                        id={`btn-start-sale-${customer.customerId}`}
                        type="button"
                        onClick={() => onSelectCustomerForSale(customer)}
                        className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center space-x-1 transition"
                      >
                        <ShoppingBag className="w-3.5 h-3.5 text-[#FF8A00]" />
                        <span>POS Sale</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Registration Modal */}
      <CustomerRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        currentUser={currentUser}
      />
    </div>
  );
};
