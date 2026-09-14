import React, { useState, useEffect } from 'react';
import {
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  Lock,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Store,
  Layers,
  Zap,
  AlertCircle,
  HelpCircle,
  WifiOff,
  Wifi,
} from 'lucide-react';
import { registerTenantCompany } from '../../db/roomDatabase';
import { syncCompanyToCloud } from '../../services/googleSheetsSync';
import { Salesperson } from '../../types';
import confetti from 'canvas-confetti';

interface RegistrationScreenProps {
  onRegistrationSuccess: (owner: Salesperson) => void;
  onSwitchToLogin: () => void;
}

const BUSINESS_CATEGORIES = [
  'Grocery & FMCG',
  'Wholesale & Retail',
  'Pharmacy & Healthcare',
  'Hardware & Electrical',
  'Restaurant & Fast Food',
  'Clothing & Apparel',
  'Beverages & Liquor Store',
  'General Merchandise',
];

export const RegistrationScreen: React.FC<RegistrationScreenProps> = ({
  onRegistrationSuccess,
  onSwitchToLogin,
}) => {
  const [companyName, setCompanyName] = useState('');
  const [businessCategory, setBusinessCategory] = useState(BUSINESS_CATEGORIES[0]);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [branchName, setBranchName] = useState('Main Branch');
  const [branchCode, setBranchCode] = useState('HQ-01');
  const [branchLocation, setBranchLocation] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setError((prev) => (prev?.includes('offline') || prev?.includes('Internet connection required') ? null : prev));
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val);
    if (!branchCode || branchCode === 'HQ-01' || branchCode.endsWith('-01')) {
      const clean = val.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
      if (clean) {
        setBranchCode(`${clean}-01`);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Enforce Online Registration Policy: Refuse offline registration to prevent cross-device loss
    if ((typeof navigator !== 'undefined' && !navigator.onLine) || !isOnline) {
      setError('Internet connection required: Saimetric cannot register a new company while offline. An active connection is required to create your enterprise on the Master Google Sheet router and sync owner credentials across all devices. Please reconnect to continue.');
      return;
    }

    if (!companyName.trim()) {
      setError('Please enter your business or company name.');
      return;
    }
    if (!ownerName.trim()) {
      setError('Please enter the business owner full name.');
      return;
    }
    if (!ownerEmail.trim() || !ownerEmail.includes('@')) {
      setError('Please enter a valid owner email address.');
      return;
    }
    if (!ownerPin || ownerPin.length !== 4 || !/^\d{4}$/.test(ownerPin)) {
      setError('Please choose a 4-digit numeric PIN for terminal access.');
      return;
    }
    if (ownerPin !== confirmPin) {
      setError('Security PINs do not match. Please re-enter.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    (async () => {
      try {
        const { company, branch, owner } = registerTenantCompany({
          companyName,
          businessCategory,
          ownerName,
          ownerEmail,
          ownerPhone,
          branchName,
          branchCode,
          branchLocation,
          ownerPin,
        });

        // 1. Synchronize to central server store
        try {
          await fetch('/api/saas/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_name: company.company_name,
              company_id: company.company_id,
              owner_email: ownerEmail,
              full_name: ownerName,
              phone: ownerPhone,
              business_category: businessCategory,
              branch_name: branchName,
              branch_code: branchCode,
              branch_location: branchLocation,
              password: ownerPin,
              plan: 'PROFESSIONAL',
            }),
          });
        } catch {
          // resilient local fallback
        }

        // 2. Cloud sync to Master Google Sheet companies tab
        try {
          await syncCompanyToCloud(company, branch, owner);
        } catch {
          // non-blocking
        }

        // Register this device to this newly created company
        try {
          localStorage.setItem('saimetric_device_registered', 'true');
          localStorage.setItem('saimetric_device_registered_company_id', company.company_id);
          localStorage.setItem('saimetric_device_registered_company_name', company.company_name);
          localStorage.setItem('saimetric_device_registered_email', ownerEmail);
          localStorage.setItem('saimetric_device_registered_branch_id', branch.branchId);
          localStorage.setItem('saimetric_device_registered_at', new Date().toISOString());
        } catch {
          // localStorage resilience
        }

        try {
          confetti({
            particleCount: 100,
            spread: 80,
            origin: { y: 0.6 },
          });
        } catch {
          // ignore
        }

        onRegistrationSuccess(owner);
      } catch (err: any) {
        setError(err?.message || 'Failed to setup company. Please try again.');
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 sm:py-10 animate-fadeIn">
      {/* Brand Header */}
      <div className="text-center space-y-3 mb-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-indigo-500/20 to-amber-500/20 border border-indigo-500/30 text-xs font-bold text-indigo-300">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Multi-Tenant Enterprise POS • 14-Day Free Evaluation</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
          Setup Your Business On <span className="bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] bg-clip-text text-transparent">SAIMETRIC</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
          Start your full-featured 14-day free trial. Instant private database, offline terminal, and multi-branch POS.
        </p>
      </div>

      {/* Trial Perks Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6 text-xs">
        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-1">
          <Clock className="w-4 h-4 text-amber-400 mx-auto" />
          <p className="font-bold text-white text-[11px]">14 Days Free</p>
          <p className="text-[10px] text-slate-400">Zero upfront fees</p>
        </div>
        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-1">
          <ShieldCheck className="w-4 h-4 text-emerald-400 mx-auto" />
          <p className="font-bold text-white text-[11px]">Isolated Branch</p>
          <p className="text-[10px] text-slate-400">100% private data</p>
        </div>
        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-1">
          <Zap className="w-4 h-4 text-blue-400 mx-auto" />
          <p className="font-bold text-white text-[11px]">Works Offline</p>
          <p className="text-[10px] text-slate-400">P2P WiFi mesh sync</p>
        </div>
        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-1">
          <Store className="w-4 h-4 text-purple-400 mx-auto" />
          <p className="font-bold text-white text-[11px]">POS & GRV</p>
          <p className="text-[10px] text-slate-400">Full 52 permissions</p>
        </div>
      </div>

      {/* Main Registration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Section 1: Business Profile */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <Building2 className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                1. Company & Business Profile
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Business / Store Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => handleCompanyNameChange(e.target.value)}
                  placeholder="e.g. Apex Supermarket"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Business Category
                </label>
                <select
                  value={businessCategory}
                  onChange={(e) => setBusinessCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                >
                  {BUSINESS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Owner Contact */}
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <User className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                2. Owner / Primary Administrator
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Full Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Farai Dube"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="farai@example.com"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Phone / WhatsApp
                </label>
                <input
                  type="tel"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="+263 77 123 4567"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: First Branch */}
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <Store className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                3. First Branch Location
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Branch Name</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. CBD Main Branch"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Branch Code</label>
                <input
                  type="text"
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
                  placeholder="e.g. APX-01"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs font-mono uppercase focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Street / City</label>
                <input
                  type="text"
                  value={branchLocation}
                  onChange={(e) => setBranchLocation(e.target.value)}
                  placeholder="e.g. 1st Street, Harare"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: 4-Digit Security PIN */}
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <Lock className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                4. Owner 4-Digit POS Login PIN
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Choose 4-Digit PIN <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  value={ownerPin}
                  onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full bg-slate-950 border border-slate-700 text-white text-center font-mono font-black tracking-widest text-lg rounded-xl py-2 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Confirm 4-Digit PIN <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full bg-slate-950 border border-slate-700 text-white text-center font-mono font-black tracking-widest text-lg rounded-xl py-2 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Offline Warning Banner */}
          {!isOnline && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-3 animate-fadeIn">
              <WifiOff className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-bold text-amber-300 text-sm">Internet Connection Required for Registration</p>
                <p className="text-amber-200/80 mt-1 leading-relaxed">
                  To prevent data loss and ensure your enterprise is recognized across all devices, tenant registration requires an active internet connection to provision the Master Google Sheet router. Once registered online, you can use the POS offline anytime.
                </p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !isOnline}
            className={`w-full py-3.5 px-6 rounded-2xl font-black text-sm tracking-wide flex items-center justify-center gap-2 shadow-xl transition-all transform active:scale-[0.99] ${
              !isOnline
                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 shadow-amber-500/25 cursor-pointer'
            }`}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-4 h-4 text-slate-500" />
                <span>Offline — Connect to Internet to Register</span>
              </>
            ) : isSubmitting ? (
              <span>Configuring Enterprise & Master Sheet...</span>
            ) : (
              <>
                <span>Launch My 14-Day Free Trial</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Switch to Existing Login */}
        <div className="pt-3 border-t border-slate-800 text-center text-xs text-slate-400">
          <span>Already registered a business on this terminal? </span>
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-amber-400 hover:text-amber-300 font-bold ml-1 inline-flex items-center gap-1"
          >
            Sign In to Existing Company &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
