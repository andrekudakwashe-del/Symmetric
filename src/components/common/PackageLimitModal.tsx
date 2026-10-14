import React from 'react';
import { ShieldAlert, Zap, Mail, X, CheckCircle2, ArrowRight } from 'lucide-react';

interface PackageLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'BRANCHES' | 'STAFF';
  currentCount: number;
  maxLimit: number;
  packageName: string;
  companyName?: string;
  onUpgrade?: () => void;
}

export const PackageLimitModal: React.FC<PackageLimitModalProps> = ({
  isOpen,
  onClose,
  type,
  currentCount,
  maxLimit,
  packageName,
  companyName = 'Tenant Enterprise',
  onUpgrade,
}) => {
  if (!isOpen) return null;

  const isBranch = type === 'BRANCHES';
  const entityTitle = isBranch ? 'Branch' : 'Staff Member';
  const entityTitlePlural = isBranch ? 'Branches' : 'Staff Members';

  const handleContactAdmin = () => {
    const subject = encodeURIComponent(`Package Upgrade Request: ${companyName} (${entityTitlePlural} Limit)`);
    const body = encodeURIComponent(
      `Hello Administrator,\n\nOur company "${companyName}" has reached the current package limit for ${entityTitlePlural}.\n` +
      `- Current Package: ${packageName}\n` +
      `- Current ${entityTitlePlural}: ${currentCount} / ${maxLimit}\n\n` +
      `We would like to request an upgrade to add more ${entityTitlePlural.toLowerCase()} to our account.\n\nThank you!`
    );
    window.location.href = `mailto:Andrekudakwashe@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden text-white">
        {/* Amber Glow Accent */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500" />
        
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400 shadow-inner">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Package Limit Reached
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {packageName}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Maximum capacity reached for this tier
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/40 text-sm text-slate-300">
            <p className="leading-relaxed">
              Your active subscription package (<strong className="text-amber-300">{packageName}</strong>) allows a maximum of{' '}
              <strong className="text-white font-mono">{maxLimit}</strong> {maxLimit === 1 ? entityTitle.toLowerCase() : entityTitlePlural.toLowerCase()}.
            </p>
            <div className="mt-3 flex items-center justify-between text-xs font-semibold bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400">Current Allocated:</span>
              <span className="text-amber-400 font-mono text-sm">
                {currentCount} / {maxLimit >= 999 ? 'Unlimited' : maxLimit}
              </span>
            </div>
          </div>

          {/* Upgrade Options Comparison */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Available Upgrade Tiers</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 hover:border-blue-500/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">Professional</span>
                  <span className="text-[11px] font-mono text-blue-400 font-semibold">$35/mo</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Up to 3 Branches</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Up to 10 Staff Members</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 hover:border-purple-500/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">Enterprise</span>
                  <span className="text-[11px] font-mono text-purple-400 font-semibold">$75/mo</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Unlimited Branches</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Unlimited Staff Accounts</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 p-4 sm:p-6 bg-slate-950/80 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContactAdmin}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700/80 hover:bg-slate-600 text-white text-xs font-semibold border border-slate-600 transition-colors shadow-sm"
          >
            <Mail className="w-3.5 h-3.5 text-blue-400" />
            <span>Contact Administrator</span>
          </button>
          {onUpgrade && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onUpgrade();
              }}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-amber-500/20"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Upgrade Package</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
