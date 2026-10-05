import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  AlertTriangle,
  ShieldAlert,
  ShoppingCart,
  CheckCircle,
  Clock,
  UserCheck,
  FileText,
  Plus,
  Search,
  HelpCircle,
} from 'lucide-react';
import {
  StocktakeSession,
  InventoryItem,
  Salesperson,
  AuditLogEntry,
} from '../../types';
import {
  isBranchInLockdown,
  setBranchLockdown,
  getInventoryItems,
  logEmergencyLockdownSale,
  getAuditLogs,
} from '../../db/roomDatabase';

interface LockdownEmergencySalesTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: () => void;
}

export const LockdownEmergencySalesTab: React.FC<LockdownEmergencySalesTabProps> = ({
  session,
  currentUser,
  onRefreshSession,
}) => {
  const branchId = session.branchId || 'BR-001';
  const [isLocked, setIsLocked] = useState<boolean>(isBranchInLockdown(branchId));
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Emergency Sale Authorization Modal
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [saleQuantity, setSaleQuantity] = useState<number>(1);
  const [cashierName, setCashierName] = useState('Till Operator');
  const [supervisorPin, setSupervisorPin] = useState('');
  const [overrideReason, setOverrideReason] = useState('Critical customer emergency prescription/ration');
  const [deductDecision, setDeductDecision] = useState<'DEDUCT_COUNT' | 'SYSTEM_STANDARD'>('DEDUCT_COUNT');
  const [pinError, setPinError] = useState('');

  const loadData = () => {
    setIsLocked(isBranchInLockdown(branchId));
    setInventoryList(getInventoryItems());
    const logs = getAuditLogs().filter(
      (l) => (l as any).module === 'STOCKTAKE_LOCKDOWN'
    );
    setAuditLogs(logs);
  };

  useEffect(() => {
    loadData();
  }, [session.sessionId, branchId]);

  const handleToggleLockdown = () => {
    const nextState = !isLocked;
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Stocktake Auditor';

    setBranchLockdown(
      branchId,
      nextState,
      session.sessionId,
      staffId,
      staffName,
      nextState ? `Manual Store Lockdown for ${session.title}` : `Lockdown released by ${staffName}`
    );

    setIsLocked(nextState);
    loadData();
    onRefreshSession();
  };

  // Check if item was already counted in any segment
  const checkItemCountStatus = (itemId: string): { wasCounted: boolean; segmentNames: string[] } => {
    const foundSegments: string[] = [];
    session.segments.forEach((seg) => {
      const hasInCount1 = seg.count1.some((l) => l.itemId.toUpperCase() === itemId.toUpperCase() && l.totalUnits > 0);
      const hasInCount2 = seg.count2.some((l) => l.itemId.toUpperCase() === itemId.toUpperCase() && l.totalUnits > 0);
      const hasInVerified = seg.verifiedCounts.some((l) => l.itemId.toUpperCase() === itemId.toUpperCase());
      if (hasInCount1 || hasInCount2 || hasInVerified) {
        foundSegments.push(seg.name);
      }
    });
    return { wasCounted: foundSegments.length > 0, segmentNames: foundSegments };
  };

  const selectedItemStatus = selectedItemId ? checkItemCountStatus(selectedItemId) : null;

  const handleAuthorizeSale = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    if (supervisorPin.trim() !== '1234' && currentUser?.pin && supervisorPin.trim() !== currentUser.pin) {
      setPinError('Invalid Supervisor Authorization PIN. (Default: 1234)');
      return;
    }

    const matched = inventoryList.find((i) => i.itemId === selectedItemId);
    const itemName = matched?.itemName || selectedItemId;
    const supervisorId = currentUser?.id || '001';
    const supervisorName = currentUser?.name || 'Stocktake Auditor';

    logEmergencyLockdownSale({
      sessionId: session.sessionId,
      itemId: selectedItemId,
      itemName,
      quantity: saleQuantity,
      supervisorId,
      supervisorName,
      cashierName,
      overrideReason: `${overrideReason} [Deduction Policy: ${deductDecision}]`,
      wasCountedPriorToSale: Boolean(selectedItemStatus?.wasCounted),
    });

    loadData();
    setShowSaleModal(false);
    setSelectedItemId('');
    setSaleQuantity(1);
    setSupervisorPin('');
    onRefreshSession();
  };

  return (
    <div className="space-y-6">
      {/* Lockdown Status Card */}
      <div
        className={`p-6 rounded-2xl border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition ${
          isLocked
            ? 'bg-gradient-to-r from-rose-950/70 to-slate-900 border-rose-800/70'
            : 'bg-gradient-to-r from-slate-900 to-slate-950 border-slate-800'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border ${
              isLocked
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {isLocked ? <Lock className="w-7 h-7" /> : <Unlock className="w-7 h-7" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white">
                Branch Store Lockdown Status: {isLocked ? 'ACTIVE LOCKDOWN' : 'NORMAL TRADING'}
              </h3>
              <span
                className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                  isLocked
                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {branchId}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              {isLocked
                ? 'Store doors and till sales are strictly locked down to guarantee zero movement during physical counts. Any emergency sale requires supervisor override and automatic counting balance verification.'
                : 'Branch is not locked down. If running a Full Storewide Stocktake, activate lockdown to prevent unaccounted stock deductions during counting.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleToggleLockdown}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition ${
              isLocked
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
            }`}
          >
            {isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {isLocked ? 'Release Store Lockdown' : 'Engage Full Store Lockdown'}
          </button>

          <button
            type="button"
            onClick={() => setShowSaleModal(true)}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition"
          >
            <ShoppingCart className="w-4 h-4" />
            Authorize Emergency Sale
          </button>
        </div>
      </div>

      {/* Emergency Sales Audit Trail */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h4 className="text-sm font-bold text-white">Emergency Sales Authorization Ledger</h4>
          </div>
          <span className="text-xs text-slate-400">
            Immutable Audit Entries: <strong className="text-white">{auditLogs.length}</strong>
          </span>
        </div>

        <div className="space-y-2.5">
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-amber-400 font-bold">{log.action}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-300 font-medium">Supervisor: {log.staffName || (log as any).userName || 'Supervisor'}</span>
                </div>
                <p className="text-slate-300 mt-1 leading-relaxed">{log.details}</p>
              </div>

              <div className="text-slate-500 font-mono text-[11px] shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
            </div>
          ))}

          {auditLogs.length === 0 && (
            <div className="text-center py-10 text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/80">
              <CheckCircle className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
              <p className="font-semibold text-slate-400">No emergency sales authorized during this audit</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Lockdown integrity maintained with zero retail leakage.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Authorize Emergency Sale Modal */}
      {showSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Supervisor Emergency Sale Authorization</h3>
                  <p className="text-xs text-slate-400">Lockdown override with automatic inventory verification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSaleModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAuthorizeSale} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Product *</label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                >
                  <option value="">-- Choose Product to Sell --</option>
                  {inventoryList.map((item) => (
                    <option key={item.itemId} value={item.itemId}>
                      {item.itemName} ({item.itemId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Automatic System Verification Alert */}
              {selectedItemStatus && (
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                    selectedItemStatus.wasCounted
                      ? 'bg-amber-950/50 border-amber-800/80 text-amber-200'
                      : 'bg-blue-950/50 border-blue-800/80 text-blue-200'
                  }`}
                >
                  <AlertTriangle
                    className={`w-5 h-5 shrink-0 ${
                      selectedItemStatus.wasCounted ? 'text-amber-400' : 'text-blue-400'
                    }`}
                  />
                  <div>
                    <strong className="block font-semibold">
                      {selectedItemStatus.wasCounted
                        ? 'Item was ALREADY physically counted on floor!'
                        : 'Item has NOT been counted on floor yet.'}
                    </strong>
                    <p className="text-[11px] mt-0.5">
                      {selectedItemStatus.wasCounted
                        ? `Counters in segments (${selectedItemStatus.segmentNames.join(
                            ', '
                          )}) have already counted this item. Deducting stock now will create a discrepancy against what was counted unless adjusted.`
                        : 'Since the counter has not counted this shelf yet, selling now will be reflected naturally when the counter arrives.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Quantity Sold *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={saleQuantity}
                    onChange={(e) => setSaleQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cashier / Till Operator</label>
                  <input
                    type="text"
                    required
                    value={cashierName}
                    onChange={(e) => setCashierName(e.target.value)}
                    placeholder="Till 01"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Supervisor Deduction Policy</label>
                <select
                  value={deductDecision}
                  onChange={(e) => setDeductDecision(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                >
                  <option value="DEDUCT_COUNT">
                    Deduct from Physical Floor Count (Keep Variance Balanced)
                  </option>
                  <option value="SYSTEM_STANDARD">
                    Normal Sales Ledger Deduction (Audit Discrepancy Logged)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Emergency Override Reason *</label>
                <input
                  type="text"
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Critical customer emergency prescription"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Supervisor PIN (Default: 1234) *</label>
                <input
                  type="password"
                  maxLength={6}
                  required
                  value={supervisorPin}
                  onChange={(e) => setSupervisorPin(e.target.value)}
                  placeholder="Enter 4-digit PIN"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono text-center tracking-widest text-base focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                {pinError && <p className="text-xs text-rose-400 mt-1 font-medium">{pinError}</p>}
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSaleModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-lg"
                >
                  Authorize & Log in Audit Trail
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
