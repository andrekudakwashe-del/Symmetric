import React, { useState } from 'react';
import {
  Lock,
  ShieldAlert,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  Copy,
  Phone,
  Mail,
  ExternalLink,
  LogOut,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import {
  getCurrentCompany,
  activateCompanyWithCode,
  confirmCompanyPayment,
  getSubscriptionStatus,
} from '../../db/roomDatabase';
import confetti from 'canvas-confetti';

interface TrialExpiredLockScreenProps {
  onUnlockSuccess: () => void;
  onLogout: () => void;
}

export const TrialExpiredLockScreen: React.FC<TrialExpiredLockScreenProps> = ({
  onUnlockSuccess,
  onLogout,
}) => {
  const company = getCurrentCompany();
  const subStatus = getSubscriptionStatus(company);
  const [activationCode, setActivationCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAdminBypass, setShowAdminBypass] = useState(false);
  const [adminPin, setAdminPin] = useState('');

  const ownerName = 'Andre Kudakwashe';
  const ownerEmail = 'Andrekudakwashe@gmail.com';
  const ownerPhone = '+263 77 123 4567';
  const paymentMessage = `Hi Andre, I would like to confirm my subscription payment for SAIMETRIC POS.\n\nCompany: ${company.company_name}\nCompany ID: ${company.company_id}\nOwner: ${company.owner_name || company.owner_email}\nPhone: ${company.phone || 'N/A'}`;

  const handleCopyPaymentRequest = () => {
    navigator.clipboard.writeText(paymentMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleOpenWhatsApp = () => {
    const encoded = encodeURIComponent(paymentMessage);
    window.open(`https://wa.me/263771234567?text=${encoded}`, '_blank');
  };

  const handleActivateCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationCode.trim()) {
      setError('Please enter your license activation code.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    setTimeout(() => {
      const res = activateCompanyWithCode(company.company_id, activationCode.trim());
      setIsVerifying(false);
      if (res.success) {
        setSuccessMsg(res.message || 'Subscription successfully activated!');
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {
          // ignore
        }
        setTimeout(() => {
          onUnlockSuccess();
        }, 1500);
      } else {
        setError(res.message || 'Invalid activation code. Please check with Andre Kudakwashe.');
      }
    }, 400);
  };

  const handleAdminBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPin === '1234') {
      confirmCompanyPayment(company.company_id, 'PROFESSIONAL', 1, 'Andre Kudakwashe (Admin PIN Override)');
      setSuccessMsg('Master Super Admin PIN Verified! Account activated for 30 days.');
      try {
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore
      }
      setTimeout(() => {
        onUnlockSuccess();
      }, 1500);
    } else {
      setError('Incorrect Super Admin Master PIN.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-rose-500/30 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl space-y-6 relative animate-fadeIn my-auto">
        {/* Top Warning Banner */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 mx-auto flex items-center justify-center shadow-lg shadow-rose-900/20">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold mb-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              14-Day Free Trial Concluded
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Subscription Activation Required
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md mx-auto">
              Your 14-day evaluation trial for <strong className="text-white">{company.company_name}</strong> expired on{' '}
              <span className="text-rose-400 font-mono font-bold">{company.next_billing_date}</span>.
            </p>
          </div>
        </div>

        {/* Company Summary Card */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 text-amber-400 flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{company.company_name}</p>
              <p className="text-xs text-slate-400 font-mono">ID: {company.company_id}</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/30">
            Payment Pending
          </span>
        </div>

        {/* Contact System Owner Box */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/50 to-slate-950/60 border border-indigo-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-indigo-200">System Owner & Payment Verification</span>
            </div>
            <span className="text-[11px] font-mono text-indigo-300 font-semibold">{ownerName}</span>
          </div>

          <p className="text-xs text-slate-300">
            To continue using SAIMETRIC POS without interruption, please contact Andre to confirm your payment (Ecocash, Mukuru, Innbucks, Bank Transfer, or USD Cash):
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
              <Mail className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate text-slate-300 font-mono text-[11px]">{ownerEmail}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300 font-mono text-[11px]">{ownerPhone}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleCopyPaymentRequest}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-slate-700"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Request Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Payment Details</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-900/20"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>WhatsApp Andre</span>
            </button>
          </div>
        </div>

        {/* Enter Activation Key Form */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
            Have an Activation Key or Offline License Code?
          </label>
          <form onSubmit={handleActivateCode} className="flex gap-2">
            <input
              type="text"
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
              placeholder="e.g. SAI-7F2A9B"
              className="flex-1 bg-slate-950 border border-slate-700 text-white font-mono font-bold tracking-widest rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 uppercase"
            />
            <button
              type="submit"
              disabled={isVerifying}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md transition-all shrink-0 cursor-pointer"
            >
              {isVerifying ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Activate</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Action Footers */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
          <button
            type="button"
            onClick={onLogout}
            className="text-slate-400 hover:text-white flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-800"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Switch Account / Sign Out</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAdminBypass(!showAdminBypass)}
            className="text-slate-500 hover:text-slate-400 text-[11px]"
          >
            Owner Admin Unlock
          </button>
        </div>

        {/* Super Admin Quick Bypass */}
        {showAdminBypass && (
          <form onSubmit={handleAdminBypassSubmit} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <span className="text-[11px] font-bold text-amber-400 block">
              Andre Kudakwashe • Super Admin On-Site Bypass
            </span>
            <div className="flex gap-2">
              <input
                type="password"
                maxLength={4}
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="4-digit Master PIN"
                className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-mono"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
              >
                Confirm PIN
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
