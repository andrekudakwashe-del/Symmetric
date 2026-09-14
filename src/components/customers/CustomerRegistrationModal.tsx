import React, { useState } from 'react';
import { Customer, Salesperson } from '../../types';
import { getNextCustomerId, addCustomer } from '../../db/roomDatabase';
import { X, UserPlus, Phone, MapPin, User, Check, Sparkles, Hash } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CustomerRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
  onCustomerCreated?: (customer: Customer) => void;
}

export const CustomerRegistrationModal: React.FC<CustomerRegistrationModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onCustomerCreated,
}) => {
  const nextId = getNextCustomerId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Customer name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = addCustomer({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        createdBy: currentUser.id,
      });

      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#6A4DFF', '#FF8A00', '#10B981'],
      });

      if (onCustomerCreated) {
        onCustomerCreated(created);
      }

      setName('');
      setPhone('');
      setAddress('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-slate-100 animate-scaleUp">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">Register New Customer</h2>
              <p className="text-xs text-white/80">Saved offline & synced to Sheet "Customers"</p>
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

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Auto Customer ID & Staff Info Pill */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs">
            <div className="flex items-center space-x-2 text-slate-300">
              <Hash className="w-4 h-4 text-[#FF8A00]" />
              <span>Assigned ID:</span>
              <span className="font-mono-num font-black text-sm text-[#FF8A00] bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                {nextId}
              </span>
            </div>
            <div className="text-slate-400">
              Staff: <span className="font-semibold text-slate-200">{currentUser.name} (#{currentUser.id})</span>
            </div>
          </div>

          {/* Name Field (Required) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Customer Name *</span>
              <span className="text-[10px] text-rose-400 font-medium">Required</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <User className="w-4 h-4" />
              </div>
              <input
                id="input-customer-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Apex Logistics Ltd or John Doe"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700/80 focus:border-[#6A4DFF] focus:ring-2 focus:ring-[#6A4DFF]/30 rounded-2xl text-sm text-white placeholder-slate-500 transition outline-none"
                required
                autoFocus
              />
            </div>
          </div>

          {/* Phone Field (Optional) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
              Phone Number
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Phone className="w-4 h-4" />
              </div>
              <input
                id="input-customer-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +263 77 123 4567"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700/80 focus:border-[#6A4DFF] focus:ring-2 focus:ring-[#6A4DFF]/30 rounded-2xl text-sm text-white placeholder-slate-500 transition outline-none font-mono-num"
              />
            </div>
          </div>

          {/* Address Field (Optional) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
              Address / Location
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <MapPin className="w-4 h-4" />
              </div>
              <input
                id="input-customer-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 45 Samora Machel Ave, Harare"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700/80 focus:border-[#6A4DFF] focus:ring-2 focus:ring-[#6A4DFF]/30 rounded-2xl text-sm text-white placeholder-slate-500 transition outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl font-medium">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center space-x-3">
            <button
              id="btn-cancel-customer"
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
            >
              Cancel
            </button>
            <button
              id="btn-save-customer"
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 active:scale-98 text-white font-bold text-sm transition shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : 'Register Customer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
