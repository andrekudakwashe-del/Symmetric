import React, { useState, useRef, useEffect } from 'react';
import { Salesperson, ActiveTab } from '../../types';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  User,
  LogOut,
  LogIn,
  Shield,
  FileSpreadsheet,
  Users,
  Settings,
  Zap,
  ChevronDown,
  X,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Wifi,
  QrCode,
} from 'lucide-react';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { ShareDeviceModal } from '../common/ShareDeviceModal';
import { meshSyncService } from '../../services/meshSyncService';
import { TenantBranchSwitcher } from '../admin/TenantBranchSwitcher';

interface TopHeaderProps {
  currentUser: Salesperson | null;
  onLogout: () => void;
  pendingSyncCount?: number;
  isOffline?: boolean;
  onToggleOffline?: () => void;
  onOpenSyncModal: () => void;
  onOpenAdminModal: () => void;
  onTabChange?: (tab: ActiveTab) => void;
  isSyncing?: boolean;
  onTriggerSync?: () => void;
  onOpenPermissions?: () => void;
  onOpenSuperAdmin?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentUser,
  onLogout,
  pendingSyncCount = 0,
  isOffline = false,
  onToggleOffline,
  onOpenSyncModal,
  onOpenAdminModal,
  onTabChange,
  isSyncing = false,
  onTriggerSync,
  onOpenPermissions,
  onOpenSuperAdmin,
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [peerCount, setPeerCount] = useState<number>(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  useEffect(() => {
    const unsub = meshSyncService.subscribePeers((count) => {
      setPeerCount(count);
    });
    return () => unsub();
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    if (isProfileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileOpen]);

  const handleConfirmLogout = () => {
    setIsProfileOpen(false);
    setShowLogoutConfirm(false);
    onLogout();
  };

  return (
    <>
      <header
        id="saimetric-app-header"
        className="relative overflow-visible bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white shadow-lg z-30"
      >
        {/* Subtle geometric pattern overlay */}
        <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between relative z-10">
          {/* Left: Branding & Tenant Branch Switcher */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div
              className="flex items-center space-x-2.5 cursor-pointer"
              onClick={() => onTabChange?.('home')}
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-md transform transition hover:scale-105 shrink-0">
                <span className="text-lg sm:text-xl font-black tracking-tight text-white drop-shadow-sm">S</span>
                <div className="w-2 h-2 rounded-full bg-[#FF8A00] absolute bottom-1 right-1 ring-2 ring-white/30" />
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <h1 className="text-lg sm:text-2xl font-black tracking-wider uppercase drop-shadow-sm font-sans">
                    SAIMETRIC
                  </h1>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 border border-white/30 text-white shadow-inner">
                    v5.0
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-white/80 font-medium tracking-tight flex items-center gap-1">
                  <span>Room DB</span>
                  <span className="inline-block w-1 h-1 rounded-full bg-white/60" />
                  <span>SaaS Sharded</span>
                </p>
              </div>
            </div>

            {/* Tenant Branch & SaaS Switcher (Desktop / Tablet) */}
            <div className="hidden md:block">
              <TenantBranchSwitcher
                currentUser={currentUser}
                onOpenPermissions={onOpenPermissions}
                onOpenSuperAdmin={isSuperAdmin ? onOpenSuperAdmin : undefined}
              />
            </div>
          </div>

          {/* Right: Sync Status, User Profile & Direct Logout */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Offline/Online toggle pill */}
            {onToggleOffline && (
              <button
                id="btn-toggle-network"
                type="button"
                onClick={onToggleOffline}
                title={isOffline ? 'Simulating Offline Mode (Click to connect)' : 'Online (Click to simulate offline)'}
                className={`hidden md:flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all border ${
                  isOffline
                    ? 'bg-slate-900/60 border-amber-300/40 text-amber-300 shadow-sm'
                    : 'bg-white/15 border-white/30 text-white hover:bg-white/25'
                }`}
              >
                {isOffline ? (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-amber-300" />
                    <span>Offline</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Online</span>
                  </>
                )}
              </button>
            )}

            {/* PWA Offline Install Button */}
            <PWAInstallButton variant="pill" />

            {/* P2P WiFi Mesh Hub Button */}
            <button
              id="btn-open-p2p-mesh"
              type="button"
              onClick={() => onTabChange?.('p2p_mesh')}
              className={`flex items-center space-x-1 sm:space-x-1.5 text-xs font-semibold px-2 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[44px] rounded-full transition-all border shadow-sm cursor-pointer ${
                peerCount > 0
                  ? 'bg-emerald-950/90 hover:bg-emerald-900 border-emerald-400/80 text-emerald-100 shadow-emerald-900/30'
                  : 'bg-indigo-950/80 hover:bg-indigo-900 border-indigo-400/60 text-indigo-100'
              }`}
              title="P2P WiFi Mesh Connections & Setup"
            >
              <Wifi className={`w-3.5 h-3.5 shrink-0 ${peerCount > 0 ? 'text-emerald-300 animate-bounce' : 'text-indigo-300 animate-pulse'}`} />
              <span className="hidden sm:inline">{peerCount > 0 ? `Mesh: ${peerCount + 1}` : 'Mesh: 1'}</span>
              <span className="sm:hidden">{peerCount > 0 ? `${peerCount + 1}` : '1'}</span>
            </button>

            {/* Sheets Sync Hub Button - Super Admin only */}
            {isSuperAdmin && onOpenSyncModal && (
              <button
                id="btn-open-sheets-sync"
                type="button"
                onClick={onOpenSyncModal}
                className={`flex items-center space-x-1 sm:space-x-1.5 text-xs font-semibold px-2 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[44px] rounded-full transition-all border shadow-sm ${
                  pendingSyncCount > 0
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 animate-pulse font-bold'
                    : 'bg-white/20 hover:bg-white/30 text-white border-white/30'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Sheets Sync</span>
                {pendingSyncCount > 0 ? (
                  <span className="bg-slate-950 text-amber-300 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {pendingSyncCount}
                  </span>
                ) : (
                  <span className="text-[10px] text-white/90">✓</span>
                )}
              </button>
            )}

            {/* User Profile Pill & Dropdown */}
            {currentUser && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  id="btn-user-profile-menu"
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center bg-black/25 hover:bg-black/40 backdrop-blur-md rounded-full pl-1.5 pr-2.5 py-1 border border-white/25 transition active:scale-95 shadow-sm space-x-1.5"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center font-bold text-xs text-white shadow-inner shrink-0">
                    {currentUser.role === 'Admin' ? (
                      <Shield className="w-3.5 h-3.5 text-white" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-white" />
                    )}
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-bold text-white leading-tight flex items-center gap-1">
                      <span>{currentUser.name.split(' ')[0]}</span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-white/20 text-white/90 uppercase font-mono-num font-bold">
                        #{currentUser.id}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={`w-3 h-3 text-white/70 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Interactive Profile Dropdown Menu */}
                {isProfileOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-purple-500/40 rounded-3xl shadow-2xl p-4 text-slate-100 z-50 animate-fadeIn">
                    <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center font-black text-lg text-white shadow-lg shrink-0">
                        {currentUser.name.charAt(0)}
                      </div>
                      <div className="overflow-hidden">
                        <h4 className="text-sm font-black text-white truncate">{currentUser.name}</h4>
                        <div className="flex items-center space-x-1.5 mt-0.5">
                          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-mono-num font-bold">
                            Staff #{currentUser.id}
                          </span>
                          <span className="text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full font-bold">
                            {currentUser.role}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="py-2.5 space-y-1.5 text-xs">
                      <div className="flex justify-between py-1 text-slate-400">
                        <span>Status:</span>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Active Shift
                        </span>
                      </div>
                      <div className="flex justify-between py-1 text-slate-400">
                        <span>Database:</span>
                        <span className="text-slate-200 font-mono-num">Room DB v2.4</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <button
                        type="button"
                        id="btn-dropdown-audit-log"
                        onClick={() => {
                          setIsProfileOpen(false);
                          onTabChange?.('audit_log');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-between transition"
                      >
                        <div className="flex items-center space-x-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span>Audit Log &amp; Security</span>
                        </div>
                        <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/60">
                          ON
                        </span>
                      </button>

                      <button
                        type="button"
                        id="btn-dropdown-p2p-mesh"
                        onClick={() => {
                          setIsProfileOpen(false);
                          onTabChange?.('p2p_mesh');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 text-xs font-bold flex items-center justify-between transition border border-indigo-500/40 shadow-sm"
                      >
                        <div className="flex items-center space-x-2">
                          <Wifi className="w-4 h-4 text-indigo-400 animate-pulse" />
                          <span>P2P WiFi Mesh Connections &amp; Setup</span>
                        </div>
                        <span className="text-[10px] text-emerald-300 font-mono font-bold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/60">
                          {peerCount > 0 ? `${peerCount + 1} Terminals` : '1 Terminal (Ready)'}
                        </span>
                      </button>

                      <button
                        type="button"
                        id="btn-dropdown-connect-devices"
                        onClick={() => {
                          setIsProfileOpen(false);
                          setShowShareModal(true);
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 text-xs font-bold flex items-center justify-between transition border border-emerald-500/40 shadow-sm"
                      >
                        <div className="flex items-center space-x-2">
                          <QrCode className="w-4 h-4 text-emerald-400" />
                          <span>Connect Other Devices (Scan QR)</span>
                        </div>
                        <span className="text-[10px] text-emerald-300 font-mono font-bold bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-700/60">
                          PUBLIC LINK
                        </span>
                      </button>

                      {isSuperAdmin && (
                        <button
                          type="button"
                          id="btn-dropdown-nocode-reports"
                          onClick={() => {
                            setIsProfileOpen(false);
                            onTabChange?.('custom_reports');
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-purple-950/40 hover:bg-purple-900/60 text-purple-200 text-xs font-bold flex items-center justify-between transition border border-purple-500/30"
                        >
                          <div className="flex items-center space-x-2">
                            <Zap className="w-4 h-4 text-purple-400" />
                            <span>Universal No-Code Reports</span>
                          </div>
                          <span className="text-[10px] text-purple-300 font-mono font-bold bg-purple-900/60 px-1.5 py-0.5 rounded border border-purple-700/60">
                            SUPER ADMIN
                          </span>
                        </button>
                      )}

                      {onOpenPermissions && (
                        <button
                          type="button"
                          id="btn-dropdown-permissions-matrix"
                          onClick={() => {
                            setIsProfileOpen(false);
                            onOpenPermissions();
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 text-xs font-bold flex items-center justify-between transition border border-indigo-500/40 shadow-sm"
                        >
                          <div className="flex items-center space-x-2">
                            <Shield className="w-4 h-4 text-indigo-400" />
                            <span>52 Permissions Matrix (RBAC)</span>
                          </div>
                          <span className="text-[10px] text-indigo-300 font-mono font-bold bg-indigo-900/60 px-1.5 py-0.5 rounded border border-indigo-700/60">
                            52 RULES
                          </span>
                        </button>
                      )}

                      {isSuperAdmin && onOpenSuperAdmin && (
                        <button
                          type="button"
                          id="btn-dropdown-super-admin"
                          onClick={() => {
                            setIsProfileOpen(false);
                            onOpenSuperAdmin();
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-amber-950/60 hover:bg-amber-900/80 text-amber-200 text-xs font-bold flex items-center justify-between transition border border-amber-500/40 shadow-sm"
                        >
                          <div className="flex items-center space-x-2">
                            <ShieldCheck className="w-4 h-4 text-amber-400" />
                            <span>SaaS Multi-Tenant Admin</span>
                          </div>
                          <span className="text-[10px] text-amber-300 font-mono font-bold bg-amber-900/60 px-1.5 py-0.5 rounded border border-amber-700/60">
                            500 TENANTS
                          </span>
                        </button>
                      )}

                      {currentUser.role === 'Admin' && (
                        <button
                          type="button"
                          id="btn-dropdown-admin-staff"
                          onClick={() => {
                            setIsProfileOpen(false);
                            onOpenAdminModal();
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-2 transition"
                        >
                          <Users className="w-4 h-4 text-purple-400" />
                          <span>Admin Staff Management</span>
                        </button>
                      )}

                      <button
                        type="button"
                        id="btn-dropdown-lock"
                        onClick={() => {
                          setIsProfileOpen(false);
                          onLogout();
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold flex items-center justify-center space-x-2 transition border border-amber-500/20"
                      >
                        <Lock className="w-4 h-4 text-amber-400" />
                        <span>Lock Terminal (PIN Required)</span>
                      </button>

                      <button
                        type="button"
                        id="btn-dropdown-logout"
                        onClick={() => {
                          setIsProfileOpen(false);
                          setShowLogoutConfirm(true);
                        }}
                        className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white text-xs font-black flex items-center justify-center space-x-2 transition shadow-lg shadow-rose-950/50 active:scale-95"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log Out / Switch User</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Always-Visible Direct Login / Logout Pill Button */}
            {currentUser ? (
              <button
                id="btn-header-direct-logout"
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                title="Log Out (Switch Salesperson)"
                className="flex items-center space-x-1.5 text-xs font-black px-2.5 sm:px-3 py-1.5 rounded-full bg-rose-500/25 hover:bg-rose-500/40 text-rose-100 border border-rose-400/40 transition active:scale-95 shadow-sm"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-300" />
                <span className="text-xs">Log Out</span>
              </button>
            ) : (
              <button
                id="btn-header-direct-login"
                type="button"
                onClick={onLogout}
                title="Log In to Saimetric"
                className="flex items-center space-x-1.5 text-xs font-black px-2.5 sm:px-3 py-1.5 rounded-full bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 border border-emerald-400/40 transition active:scale-95 shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5 text-emerald-300" />
                <span className="text-xs">Log In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <LogOut className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Confirm Log Out</h3>
                <p className="text-xs text-slate-400">
                  Are you sure you want to end session for{' '}
                  <strong className="text-white">{currentUser?.name}</strong>?
                </p>
              </div>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800 text-xs text-slate-300">
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> All local entries are safely saved in Room DB.
              </p>
            </div>

            <div className="flex items-center space-x-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-logout-action"
                onClick={handleConfirmLogout}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-xs transition shadow-lg shadow-rose-950/60 active:scale-95"
              >
                Yes, Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share / Connect Other Devices Modal */}
      <ShareDeviceModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />
    </>
  );
};
