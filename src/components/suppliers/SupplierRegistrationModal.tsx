import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  X,
  Check,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  FileText,
  Search,
  Plus,
  Tag,
  AlertCircle,
} from 'lucide-react';
import { Supplier } from '../../types';
import { addSupplier, getInventoryItems } from '../../db/roomDatabase';

interface SupplierRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSupplierCreated: (supplier: Supplier) => void;
  initialName?: string;
}

const DEFAULT_CATEGORIES = [
  'Groceries & FMCG',
  'Beverages & Soft Drinks',
  'Dairy & Chilled Foods',
  'Bakery & Confectionery',
  'Meat & Poultry',
  'Toiletries & Personal Care',
  'Cleaning & Household',
  'Packaging & Warehousing',
  'General Merchandise',
];

const PAYMENT_TERMS_OPTIONS = [
  'Immediate Cash on Delivery (COD)',
  '7-Day Account',
  '14-Day Account',
  '30-Day Account Credit',
  '60-Day Account Credit',
  'Prepaid / Advance Payment',
];

export const SupplierRegistrationModal: React.FC<SupplierRegistrationModalProps> = ({
  isOpen,
  onClose,
  onSupplierCreated,
  initialName = '',
}) => {
  const [formData, setFormData] = useState({
    name: initialName,
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    city: 'Harare',
    paymentTerms: '30-Day Account Credit',
    taxNumber: '',
    accountNumber: '',
    notes: '',
  });

  const [selectedCategories, setSelectedCategories] = useState<string[]>(['Groceries & FMCG']);
  const [categorySearch, setCategorySearch] = useState('');
  const [error, setError] = useState<string>('');

  // Sync initialName whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData((prev) => ({
        ...prev,
        name: initialName || prev.name || '',
      }));
      setError('');
    }
  }, [isOpen, initialName]);

  // Dynamically extract categories synced from Inventory Master
  const masterCategories = useMemo(() => {
    try {
      const items = getInventoryItems();
      const itemCats = items.map((i) => i.category).filter(Boolean);
      return Array.from(new Set([...DEFAULT_CATEGORIES, ...itemCats])).sort();
    } catch {
      return DEFAULT_CATEGORIES;
    }
  }, [isOpen]);

  const filteredCategories = useMemo(() => {
    const q = (categorySearch || '').trim().toLowerCase();
    if (!q) return masterCategories;
    return masterCategories.filter((cat) =>
      (cat || '').toLowerCase().includes(q)
    );
  }, [masterCategories, categorySearch]);

  if (!isOpen) return null;

  const toggleCategory = (cat: string) => {
    if (selectedCategories.includes(cat)) {
      if (selectedCategories.length === 1) {
        // Keep at least one category
        return;
      }
      setSelectedCategories(selectedCategories.filter((c) => c !== cat));
    } else {
      setSelectedCategories([...selectedCategories, cat]);
    }
  };

  const handleAddNewCategory = () => {
    const trimmed = categorySearch.trim();
    if (!trimmed) return;
    if (!selectedCategories.includes(trimmed)) {
      setSelectedCategories([...selectedCategories, trimmed]);
    }
    setCategorySearch('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Supplier / Company Name is required.');
      return;
    }

    if (selectedCategories.length === 0) {
      setError('Please select at least one category.');
      return;
    }

    try {
      const primaryCategory = selectedCategories.join(', ');
      const newSupplier = addSupplier({
        name: formData.name.trim(),
        category: primaryCategory,
        categories: selectedCategories,
        contactPerson: formData.contactPerson.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        address: formData.address.trim(),
        city: formData.city.trim(),
        paymentTerms: formData.paymentTerms,
        taxNumber: formData.taxNumber.trim(),
        accountNumber: formData.accountNumber.trim(),
        notes: formData.notes.trim(),
        status: 'Active',
      });

      onSupplierCreated(newSupplier);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to register supplier.');
    }
  };

  return (
    <div
      id="modal-supplier-registration"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden animate-in fade-in duration-150"
    >
      <div className="bg-slate-850 border border-slate-700 rounded-3xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Sticky Header */}
        <div className="shrink-0 p-5 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Register New Supplier</h3>
              <p className="text-xs text-slate-400">
                Add vendor profile to database and sync supply categories
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-700 transition-colors"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form id="supplier-registration-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Supplier / Company Name - ALWAYS FIRST & PROMINENT */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-blue-500/40">
              <label className="block text-xs font-bold text-blue-300 mb-1 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Supplier / Company Name *</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (error) setError('');
                }}
                placeholder="e.g. National Foods Wholesalers, Delta Beverages"
                className="w-full bg-slate-950 border border-slate-600 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Multi-Category Sync & Search with Inventory Master */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-amber-400" />
                  <span>Supplied Categories (Synced with Inventory Master) *</span>
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  {selectedCategories.length} selected
                </span>
              </div>

              {/* Selected Categories Chips */}
              <div className="flex flex-wrap gap-1.5">
                {selectedCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600/30 text-blue-200 border border-blue-500/40"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className="text-blue-300 hover:text-white ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              {/* Search & Add Category */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search categories or type custom..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-20 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                {categorySearch.trim() && (
                  <button
                    type="button"
                    onClick={handleAddNewCategory}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                )}
              </div>

              {/* Category Options List */}
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950/50">
                {filteredCategories.map((cat) => {
                  const isChecked = selectedCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition ${
                        isChecked
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>{cat}</span>
                      {isChecked && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Contact Information */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Contact Person */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Contact Person / Representative
                </label>
                <input
                  type="text"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  placeholder="e.g. Tendai Moyo (Sales Rep)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Phone / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g. +263 77 123 4567"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="e.g. orders@natfoods.co.zw"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Payment Terms */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Payment Terms</label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {PAYMENT_TERMS_OPTIONS.map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Address & City */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Physical / Warehouse Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="e.g. 10 Stirling Road, Workington"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">City / Region</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="e.g. Harare, Bulawayo"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Financial Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tax / VAT / BP Number
                </label>
                <input
                  type="text"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  placeholder="e.g. VAT-98234120"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Our Account # with Supplier
                </label>
                <input
                  type="text"
                  value={formData.accountNumber}
                  onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                  placeholder="e.g. ACC-NAT-4421"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Internal Notes</label>
              <textarea
                rows={2}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Delivery schedules, rep direct WhatsApp line, order cut-off times..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </form>

        {/* Sticky Footer */}
        <div className="shrink-0 p-4 bg-slate-800 border-t border-slate-700 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="supplier-registration-form"
            className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-lg flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            <span>Register Supplier & Select</span>
          </button>
        </div>
      </div>
    </div>
  );
};
