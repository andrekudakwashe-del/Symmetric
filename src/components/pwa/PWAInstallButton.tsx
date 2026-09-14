import React, { useState } from 'react';
import { Download, CheckCircle, Info, X, Laptop, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full' | 'pill';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'pill',
  className = '',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  if (isInstalled) {
    return (
      <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
        <span>Installed PWA</span>
      </div>
    );
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const success = await install();
      if (success) {
        setInstallSuccess(true);
      }
    } else {
      // If prompt not triggered yet (or desktop Chrome without auto-prompt), show helpful guide
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        id="btn-pwa-install-app"
        type="button"
        onClick={handleInstallClick}
        title="Install SAIMETRIC for offline use in Chrome"
        className={`flex items-center space-x-1.5 font-bold transition active:scale-95 shadow-sm ${
          variant === 'pill'
            ? 'px-2.5 sm:px-3 py-1.5 rounded-full bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white hover:opacity-95 text-xs'
            : variant === 'compact'
            ? 'p-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs'
            : 'w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white hover:opacity-95 text-sm justify-center'
        } ${className}`}
      >
        <Download className="w-3.5 h-3.5" />
        <span className="truncate">Install App (Offline)</span>
      </button>

      {/* Installation Guide Dialog for Chrome & iOS */}
      {showGuide && (
        <div
          id="modal-pwa-guide"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white font-black">
                  S
                </div>
                <div>
                  <h3 className="text-base font-bold text-white leading-tight">
                    Install SAIMETRIC
                  </h3>
                  <p className="text-xs text-slate-400">100% Offline Access in Google Chrome</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-xs sm:text-sm text-slate-300">
                <div className="flex items-center space-x-2 text-purple-300 font-bold">
                  <Smartphone className="w-4 h-4" />
                  <span>iPhone / iPad (Safari):</span>
                </div>
                <ol className="list-decimal list-inside space-y-2 pl-1 text-slate-300 bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
                  <li>Tap the <strong>Share</strong> button in Safari toolbar.</li>
                  <li>Scroll down and select <strong>Add to Home Screen</strong>.</li>
                  <li>Tap <strong>Add</strong> to install SAIMETRIC as an offline app.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 text-xs sm:text-sm text-slate-300">
                <div className="flex items-center space-x-2 text-purple-300 font-bold">
                  <Laptop className="w-4 h-4" />
                  <span>Google Chrome Installation Steps:</span>
                </div>

                <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-2.5">
                  <div className="flex items-start space-x-2.5">
                    <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">1</span>
                    <p>
                      Look at the right side of the <strong>Chrome Address Bar (URL bar)</strong> for the <strong>Install icon</strong> (a computer screen with a down arrow).
                    </p>
                  </div>
                  <div className="flex items-start space-x-2.5">
                    <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">2</span>
                    <p>
                      Click <strong>Install &quot;SAIMETRIC POS &amp; Inventory&quot;</strong>.
                    </p>
                  </div>
                  <div className="flex items-start space-x-2.5">
                    <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">3</span>
                    <p>
                      Alternatively, click Chrome&apos;s <strong>Three Dots Menu (⋮)</strong> &rarr; <strong>Cast, save, and share</strong> &rarr; <strong>Install page as app...</strong>
                    </p>
                  </div>
                </div>

                <div className="bg-emerald-950/30 border border-emerald-800/40 p-3 rounded-2xl text-[11px] text-emerald-200">
                  <span className="font-bold">⚡ Offline Guaranteed:</span> Once installed or cached, Chrome loads SAIMETRIC even when your Wi-Fi or mobile data is turned off completely.
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
