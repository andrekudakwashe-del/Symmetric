import React, { useState, useMemo } from 'react';
import { Customer, Salesperson } from '../../types';
import { getCustomers } from '../../db/roomDatabase';
import { CustomerRegistrationModal } from '../customers/CustomerRegistrationModal';
import { Search, UserPlus, Phone, MapPin, User, X, Check, Building2, ChevronRight } from 'lucide-react';

interface CustomerSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  selectedCustomerId?: string;
  currentUser: Salesperson;
}

export const CustomerSearchModal: React.FC<CustomerSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectCustomer,
  selectedCustomerId,
  currentUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const customers = getCustomers();

  const filteredCustomers = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.customerId && c.customerId.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
    );
  }, [customers, searchQuery]);

  if (!isOpen) return null;

  const handleSelect = (customer: Customer) => {
    onSelectCustomer(customer);
    onClose();
  };

  const handleCustomerCreated = (newCustomer: Customer) => {
    onSelectCustomer(newCustomer);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn select-none">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh] animate-scaleUp">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] p-4 text-white flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">Select Customer</h2>
                <p className="text-xs text-white/80">Search registered customer database</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Bar & Quick Register Action */}
          <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-950/40">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Search className="w-4 h-4" />
              </div>
              <input
                id="input-search-customers"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, ID (e.g. C001), phone, or address..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700/80 focus:border-[#6A4DFF] focus:ring-2 focus:ring-[#6A4DFF]/30 rounded-2xl text-sm text-white placeholder-slate-500 transition outline-none"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              id="btn-trigger-register-customer"
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-purple-900/40 to-orange-900/30 hover:from-purple-900/60 hover:to-orange-900/50 border border-purple-700/40 text-purple-200 text-xs font-bold flex items-center justify-center space-x-2 transition"
            >
              <UserPlus className="w-4 h-4 text-[#FF8A00]" />
              <span>+ Register New Customer</span>
            </button>
          </div>

          {/* Customer List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {filteredCustomers.length === 0 ? (
              <div className="text-center py-10 px-4 text-slate-400">
                <User className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">No customer found for "{searchQuery}"</p>
                <p className="text-xs text-slate-500 mt-1">
                  Click the button below to register a new customer in the database.
                </p>
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="mt-4 px-4 py-2 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white text-xs font-bold shadow-md inline-flex items-center space-x-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Register "{searchQuery}" Now</span>
                </button>
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const isSelected = selectedCustomerId === customer.customerId;
                return (
                  <button
                    key={customer.customerId}
                    id={`customer-item-${customer.customerId}`}
                    type="button"
                    onClick={() => handleSelect(customer)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-gradient-to-r from-purple-950/90 to-slate-900 border-[#6A4DFF] ring-1 ring-[#6A4DFF]/60 shadow-lg'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center font-mono-num font-bold text-xs shrink-0 mt-0.5 ${
                          isSelected
                            ? 'bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {customer.customerId}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                          <span>{customer.name}</span>
                          {isSelected && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded-full font-bold">
                              Selected
                            </span>
                          )}
                        </div>
                        {customer.phone && (
                          <div className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5 font-mono-num">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{customer.phone}</span>
                          </div>
                        )}
                        {customer.address && (
                          <div className="text-xs text-slate-500 flex items-center space-x-1 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 text-slate-600 shrink-0" />
                            <span className="truncate">{customer.address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="ml-2 shrink-0 text-slate-500">
                      {isSelected ? (
                        <div className="w-6 h-6 rounded-full bg-[#FF8A00] flex items-center justify-center text-slate-950 font-black">
                          <Check className="w-4 h-4" />
                        </div>
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-center text-[11px] text-slate-500">
            Total Customers in Room DB: <span className="font-bold text-slate-300 font-mono-num">{customers.length}</span>
          </div>
        </div>
      </div>

      {/* Embedded Registration Modal if clicked */}
      <CustomerRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        currentUser={currentUser}
        onCustomerCreated={handleCustomerCreated}
      />
    </>
  );
};
