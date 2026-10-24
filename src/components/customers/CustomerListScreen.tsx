import React, { useState, useMemo, useEffect } from 'react';
import { Customer, Salesperson } from '../../types';
import {
  getCustomers,
  getSales,
  getCustomerCreditReport,
  getCustomerChangeReport,
  getStandardGroupLimit,
  getCreditGroups,
  isSupervisorOrAbove,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import { CustomerRegistrationModal } from './CustomerRegistrationModal';
import { CustomerCreditModal } from './CustomerCreditModal';
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
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Plus,
  SlidersHorizontal,
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
  const [activeTab, setActiveTab] = useState<'ALL' | 'STANDARD_GROUP' | 'RANDOM_CUSTOM' | 'CREDIT_ALL' | 'CASH_ONLY'>('ALL');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [selectedCustomerForCredit, setSelectedCustomerForCredit] = useState<Customer | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers());
  const customerFileInputRef = React.useRef<HTMLInputElement>(null);

  const standardGroupLimit = getStandardGroupLimit(); // $5.00
  const isAuthorized = isSupervisorOrAbove(currentUser.role) || Boolean(currentUser.permissions?.canGrantCredit);

  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setCustomers(getCustomers());
    });
    return unsub;
  }, []);

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

  const sales = getSales();
  const creditReport = useMemo(() => getCustomerCreditReport(), []);
  const changeReport = useMemo(() => getCustomerChangeReport(), []);

  // Category counts
  const counts = useMemo(() => {
    const all = customers.length;
    let standardGroup = 0;
    let randomAboveGroup = 0;
    let creditAll = 0;
    let cashOnly = 0;

    customers.forEach((c) => {
      const isCreditOn = c.creditAllowed === true;
      const limit = Number(c.creditLimit) || 0;
      if (isCreditOn) {
        creditAll++;
        if (limit > standardGroupLimit) {
          randomAboveGroup++;
        } else {
          standardGroup++;
        }
      } else {
        cashOnly++;
      }
    });

    return { all, standardGroup, randomAboveGroup, creditAll, cashOnly };
  }, [customers, standardGroupLimit]);

  const cleanSearch = (search || '').trim().toLowerCase();
  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const isCreditOn = c.creditAllowed === true;
      const limit = Number(c.creditLimit) || 0;

      // Tab filter
      if (activeTab === 'STANDARD_GROUP') {
        if (!isCreditOn || limit > standardGroupLimit) return false;
      } else if (activeTab === 'RANDOM_CUSTOM') {
        if (!isCreditOn || limit <= standardGroupLimit) return false;
      } else if (activeTab === 'CREDIT_ALL') {
        if (!isCreditOn) return false;
      } else if (activeTab === 'CASH_ONLY') {
        if (isCreditOn) return false;
      }

      // Search filter
      if (cleanSearch) {
        const matchesName = c.name && c.name.toLowerCase().includes(cleanSearch);
        const matchesId = c.customerId && c.customerId.toLowerCase().includes(cleanSearch);
        const matchesPhone = c.phone && c.phone.toLowerCase().includes(cleanSearch);
        const matchesAddress = c.address && c.address.toLowerCase().includes(cleanSearch);
        if (!matchesName && !matchesId && !matchesPhone && !matchesAddress) return false;
      }

      return true;
    });
  }, [customers, activeTab, cleanSearch, standardGroupLimit]);

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
              <h2 className="text-xl font-black text-white tracking-tight">Customer Accounts &amp; Credit Ledger</h2>
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

        {/* Credit Groups & Limits Segmented Navigation Tabs */}
        <div className="mt-3.5 pt-3 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('ALL')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'ALL'
                ? 'bg-gradient-to-r from-[#6A4DFF] to-purple-600 text-white shadow-md'
                : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>All Customers</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 text-white">{counts.all}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('STANDARD_GROUP')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'STANDARD_GROUP'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950/60 hover:bg-slate-800 text-emerald-400 border border-emerald-900/40 hover:border-emerald-700/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            <span>Standard Credit List (${standardGroupLimit.toFixed(0)} Cap)</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/30 text-emerald-200">{counts.standardGroup}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('RANDOM_CUSTOM')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'RANDOM_CUSTOM'
                ? 'bg-amber-600 text-white shadow-md'
                : 'bg-slate-950/60 hover:bg-slate-800 text-amber-400 border border-amber-900/40 hover:border-amber-700/60'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
            <span>Random / Custom Limits (&gt;${standardGroupLimit.toFixed(0)})</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-200">{counts.randomAboveGroup}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CREDIT_ALL')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'CREDIT_ALL'
                ? 'bg-purple-600 text-white shadow-md'
                : 'bg-slate-950/60 hover:bg-slate-800 text-purple-300 border border-purple-900/40'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>All Credit Accounts</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-purple-500/30 text-purple-200">{counts.creditAll}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CASH_ONLY')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'CASH_ONLY'
                ? 'bg-slate-700 text-white shadow-md'
                : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 border border-slate-800'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Credit Off (Cash Only)</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400">{counts.cashOnly}</span>
          </button>
        </div>
      </div>

      {/* Contextual Banner for Credit Group Lists */}
      {activeTab === 'STANDARD_GROUP' && (
        <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-300 shadow-md">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white flex items-center gap-2">
                <span>Standard Store Credit List — Cap: ${standardGroupLimit.toFixed(2)}</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded border border-emerald-500/30">
                  Authorised Personnel Only
                </span>
              </div>
              <p className="text-[11px] text-emerald-300/80 mt-0.5 leading-relaxed">
                Customers on this list have an approved micro-credit allowance up to ${standardGroupLimit.toFixed(2)}. Only supervisors and authorized managers are permitted to add customers to this list.
              </p>
            </div>
          </div>
          {isAuthorized && (
            <button
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition shadow-md self-start sm:self-center"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Customer to ${standardGroupLimit.toFixed(0)} List</span>
            </button>
          )}
        </div>
      )}

      {activeTab === 'RANDOM_CUSTOM' && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-3xl p-4 flex items-start gap-3 text-xs text-amber-300 shadow-md">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0 border border-amber-500/30">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="font-bold text-sm text-white flex items-center gap-2">
              <span>Customers with Random / Bespoke Credit Limits (Above ${standardGroupLimit.toFixed(2)} Group Cap)</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/30">
                Audit Register
              </span>
            </div>
            <p className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
              This list filters all accounts granted individual credit limits exceeding the standard ${standardGroupLimit.toFixed(2)} group limit. Each entry reflects custom authorization and is tracked here to prevent unauthorized credit inflation and exposure risk.
            </p>
          </div>
        </div>
      )}

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
          filtered.map((customer, cIdx) => {
            const salesCount = getCustomerSalesCount(customer.customerId, customer.name);
            const totalSpend = getCustomerTotalSpend(customer.customerId, customer.name);
            const creditDebt = getCustomerCreditBalance(customer.name);
            const changeOwed = getCustomerChangeBalance(customer.name);

            return (
              <div
                key={`${customer.customerId || 'cust'}-${cIdx}`}
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

                  {/* Customer Name & Credit Category Badge */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <h3 className="text-base font-bold text-white group-hover:text-purple-300 transition">
                      {customer.name}
                    </h3>
                    <div>
                      {customer.creditAllowed === true ? (
                        (customer.creditLimit || 0) > standardGroupLimit ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold shadow-sm">
                            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>Random Limit: ${(customer.creditLimit || 0).toFixed(0)} (+${((customer.creditLimit || 0) - standardGroupLimit).toFixed(0)} over cap)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold shadow-sm">
                            <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Standard ${standardGroupLimit.toFixed(0)} Credit List</span>
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-medium">
                          <Lock className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                          <span>Credit Off (Cash Only)</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Phone & Address */}
                  <div className="mt-2 space-y-1 text-xs text-slate-300">
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

                    {customer.creditAllowed === true && customer.creditApprovedBy && (
                      <div className="text-[10px] text-slate-400 flex items-center space-x-1 pt-0.5">
                        <User className="w-3 h-3 text-purple-400" />
                        <span>Authorized by: <strong className="text-slate-300">{customer.creditApprovedBy}</strong></span>
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

                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                    <button
                      type="button"
                      id={`btn-credit-terms-${customer.customerId}`}
                      onClick={() => setSelectedCustomerForCredit(customer)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-purple-500/30 text-purple-200 text-[11px] font-bold flex items-center space-x-1 transition active:scale-95 shadow-sm"
                      title="Set / Edit Customer Credit Limits & Terms"
                    >
                      <CreditCard className="w-3 h-3 text-[#FF8A00]" />
                      <span>{customer.creditAllowed === true ? `Limit: $${(customer.creditLimit || 0).toFixed(0)}` : 'Credit Off'}</span>
                    </button>

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

      {/* Credit Limits & Exposure Terms Management Modal */}
      <CustomerCreditModal
        isOpen={Boolean(selectedCustomerForCredit)}
        customer={selectedCustomerForCredit}
        onClose={() => setSelectedCustomerForCredit(null)}
        currentUser={currentUser}
        onSuccess={(updated) => {
          showToast(`Credit limit for ${updated.name} updated to $${(updated.creditLimit || 0).toFixed(2)}.`);
        }}
      />
    </div>
  );
};
