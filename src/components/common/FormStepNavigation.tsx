import React from 'react';
import { ArrowLeft, ArrowRight, Home, CheckCircle2 } from 'lucide-react';

interface FormStepNavigationProps {
  currentStep: 1 | 2 | 3 | 4;
  onPrevious?: () => void;
  onNext?: () => void;
  onHome?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  showHome?: boolean;
  isAdmin?: boolean;
}

export const FormStepNavigation: React.FC<FormStepNavigationProps> = ({
  currentStep,
  onPrevious,
  onNext,
  onHome,
  previousLabel,
  nextLabel,
  showHome = true,
  isAdmin = false,
}) => {
  const steps = [
    { num: 1, label: 'Form 1: Cash Count', short: 'Cash Count' },
    { num: 2, label: 'Form 2: Cash Log', short: 'Cash Log' },
    { num: 3, label: 'Form 3: Customer Change & Credit', short: 'Change & Credit' },
    ...(isAdmin ? [{ num: 4, label: 'Form 4: Admin Balancing', short: 'Admin Balancing' }] : []),
  ];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-md backdrop-blur-md">
      {/* Visual Step Progress Bar */}
      <div className="flex items-center justify-between gap-1 mb-2.5 pb-2 border-b border-slate-800/80">
        {steps.map((s, idx) => {
          const isCurrent = s.num === currentStep;
          const isPassed = s.num < currentStep;

          return (
            <div key={s.num} className="flex-1 flex items-center">
              <div
                className={`flex items-center space-x-1.5 px-2 py-1 rounded-xl text-xs transition-all w-full ${
                  isCurrent
                    ? 'bg-gradient-to-r from-[#6A4DFF]/30 to-[#FF8A00]/20 border border-[#6A4DFF]/50 text-white font-bold'
                    : isPassed
                    ? 'bg-emerald-950/40 text-emerald-300 font-semibold'
                    : 'text-slate-500 font-medium'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    isCurrent
                      ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-sm'
                      : isPassed
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isPassed ? <CheckCircle2 className="w-3 h-3" /> : s.num}
                </div>
                <span className="truncate text-[11px]">
                  {s.short}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`h-0.5 w-3 mx-1 shrink-0 ${
                    isPassed ? 'bg-emerald-500/60' : 'bg-slate-800'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation Controls: Previous | Home | Next */}
      <div className="flex items-center justify-between gap-2">
        {/* Previous Button */}
        {onPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition border border-slate-700 active:scale-95"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{previousLabel || 'Previous Form'}</span>
          </button>
        ) : (
          <div />
        )}

        {/* Home Button */}
        {showHome && onHome && (
          <button
            type="button"
            onClick={onHome}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition border border-slate-800/80 active:scale-95"
            title="Return to Home Dashboard"
          >
            <Home className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Home</span>
          </button>
        )}

        {/* Next Button */}
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white text-xs font-bold shadow-md transition active:scale-95"
          >
            <span>{nextLabel || 'Next Form'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
};
