import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Calendar,
  DollarSign,
  Search,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Printer,
  Building2,
  User,
  ArrowRight,
  ExternalLink,
  Info,
  Clock,
  Check,
  X,
  RotateCcw,
  Percent,
  TrendingUp,
  Tag,
  Boxes,
  ShieldCheck,
  Receipt,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import {
  ProcurementTripManifest,
  TripLandedCost,
  TripGrnAllocationSummary,
  GoodsReceivedNote,
  Salesperson,
  TripFreightPaymentMethod,
  LandedCostAllocationMethod,
} from '../../types';
import {
  getAllTripManifests,
  saveTripManifest,
  calculateTripCrossAllocation,
  finalizeAndPostTripManifest,
  createDraftTripManifest,
  linkGrnToTrip,
  unlinkGrnFromTrip,
} from '../../services/tripManifestService';
import { getAllGoodsReceivedNotes } from '../../db/goodsReceivedNotes';

interface ProcurementTripManifestViewProps {
  currentUser: Salesperson | null;
  onGoToGrnCreate?: () => void;
  onViewGrnDetail?: (grnId: string) => void;
}

export const ProcurementTripManifestView: React.FC<ProcurementTripManifestViewProps> = ({
  currentUser,
  onGoToGrnCreate,
  onViewGrnDetail,
}) => {
  const [trips, setTrips] = useState<ProcurementTripManifest[]>([]);
  const [allGrns, setAllGrns] = useState<GoodsReceivedNote[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [expandedGrnId, setExpandedGrnId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'COMPLETED'>('ALL');
  const [showLinkGrnModal, setShowLinkGrnModal] = useState<boolean>(false);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  // New trip draft state
  const [draftTripName, setDraftTripName] = useState<string>('');
  const [draftDate, setDraftDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [draftCarrier, setDraftCarrier] = useState<string>('Moyo Transport');
  const [draftVehicleReg, setDraftVehicleReg] = useState<string>('AEZ-4590');
  const [draftDestination, setDraftDestination] = useState<string>('Town Wholesale Market');
  const [draftFreightAmount, setDraftFreightAmount] = useState<number>(30.0);
  const [draftTransporterName, setDraftTransporterName] = useState<string>('Moyo Transport');
  const [draftPaymentMethod, setDraftPaymentMethod] = useState<TripFreightPaymentMethod>('cash_till');
  const [draftAllocationMethod, setDraftAllocationMethod] = useState<LandedCostAllocationMethod>('by_value');
  const [draftNotes, setDraftNotes] = useState<string>('');

  // Reload data
  const loadData = () => {
    try {
      const loadedTrips = getAllTripManifests();
      setTrips(Array.isArray(loadedTrips) ? loadedTrips : []);
      const loadedGrns = getAllGoodsReceivedNotes();
      setAllGrns(Array.isArray(loadedGrns) ? loadedGrns : []);

      if (Array.isArray(loadedTrips) && loadedTrips.length > 0 && !selectedTripId && !isCreatingNew) {
        setSelectedTripId(loadedTrips[0]?.id || null);
      }
    } catch (err: any) {
      console.error('[ProcurementTripManifestView] Error in loadData:', err);
      setActionErrorMsg(`Error reading trip data: ${err.message}`);
    }
  };

  useEffect(() => {
    loadData();

    const handleUpdate = () => loadData();
    window.addEventListener('saimetric_trips_updated', handleUpdate);
    window.addEventListener('saimetric_grn_updated', handleUpdate);

    return () => {
      window.removeEventListener('saimetric_trips_updated', handleUpdate);
      window.removeEventListener('saimetric_grn_updated', handleUpdate);
    };
  }, []);

  // Selected trip
  const currentTrip = useMemo(() => {
    return (trips || []).find((t) => t.id === selectedTripId);
  }, [trips, selectedTripId]);

  // Linked GRNs for current trip
  const currentLinkedGrns = useMemo(() => {
    if (!currentTrip || !Array.isArray(currentTrip.linkedGrnIds)) return [];
    return (allGrns || []).filter((g) => currentTrip.linkedGrnIds.includes(g.id));
  }, [currentTrip, allGrns]);

  // Live calculation of cross-allocation for current trip
  const allocationCalc = useMemo(() => {
    if (!currentTrip) {
      return { summaries: [], totalAllocatedCents: 0, totalTripLandedCents: 0, isExactMatch: true };
    }
    try {
      return calculateTripCrossAllocation(currentTrip, currentLinkedGrns);
    } catch (err) {
      console.error('[ProcurementTripManifestView] Allocation calculation error:', err);
      return { summaries: [], totalAllocatedCents: 0, totalTripLandedCents: 0, isExactMatch: false };
    }
  }, [currentTrip, currentLinkedGrns]);

  // Unlinked GRNs eligible to be added to this trip
  const availableUnlinkedGrns = useMemo(() => {
    if (!currentTrip) return [];
    const linkedIds = Array.isArray(currentTrip.linkedGrnIds) ? currentTrip.linkedGrnIds : [];
    return (allGrns || []).filter(
      (g) => !linkedIds.includes(g.id) && (!g.tripManifestId || g.tripManifestId === currentTrip.id)
    );
  }, [allGrns, currentTrip]);

  // Filtered trips for left navigation
  const filteredTrips = useMemo(() => {
    return (trips || []).filter((t) => {
      const matchSearch =
        (t.tripNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.tripName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.carrierOrDriver || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || t.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [trips, searchTerm, statusFilter]);

  // Handle create new draft trip
  const handleCreateNewTrip = () => {
    try {
      const newTrip = createDraftTripManifest({
        tripName: draftTripName || 'Town Run - Multi-Supplier Purchase',
        date: draftDate,
        carrierOrDriver: draftCarrier,
        vehicleReg: draftVehicleReg,
        destinationOrMarket: draftDestination,
        createdBy: currentUser?.id || 'USR-001',
        createdByName: currentUser?.name || 'Manager',
        notes: draftNotes,
        freightAmount: draftFreightAmount,
        transporterName: draftTransporterName || draftCarrier,
        paymentMethod: draftPaymentMethod,
        allocationMethod: draftAllocationMethod,
      });

      loadData();
      setSelectedTripId(newTrip.id);
      setIsCreatingNew(false);
      setActionSuccessMsg(`Created new trip manifest ${newTrip.tripNumber}`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      setActionErrorMsg(`Error creating trip: ${err.message}`);
      setTimeout(() => setActionErrorMsg(null), 4000);
    }
  };

  // Handle updating current trip landed costs or metadata
  const handleUpdateTripFreight = (patch: Partial<TripLandedCost>) => {
    if (!currentTrip || currentTrip.status === 'COMPLETED') return;
    const lcs = [...currentTrip.landedCosts];
    if (lcs.length === 0) {
      lcs.push({
        id: `lc_${Date.now()}`,
        description: 'Town Run Transport',
        amount: 30,
        paymentMethod: 'cash_till',
        allocationMethod: 'by_value',
        ...patch,
      });
    } else {
      lcs[0] = { ...lcs[0], ...patch };
    }

    const totalLanded = lcs.reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
    const updated: ProcurementTripManifest = {
      ...currentTrip,
      landedCosts: lcs,
      totalTripLandedCosts: totalLanded,
      totalTripCost: Number(((Number(currentTrip.totalGoodsPurchased) || 0) + totalLanded).toFixed(2)),
      updatedAt: new Date().toISOString(),
    };

    saveTripManifest(updated);
    loadData();
  };

  // Handle link GRN to current trip
  const handleLinkGrn = (grnId: string) => {
    if (!currentTrip) return;
    const res = linkGrnToTrip(currentTrip.id, grnId);
    if (res.success) {
      loadData();
      setActionSuccessMsg('Supplier invoice linked to trip manifest');
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } else {
      setActionErrorMsg(res.message);
      setTimeout(() => setActionErrorMsg(null), 4000);
    }
  };

  // Handle unlink GRN from current trip
  const handleUnlinkGrn = (grnId: string) => {
    if (!currentTrip) return;
    if (currentTrip.status === 'COMPLETED') {
      if (!window.confirm('This trip is already completed. Unlinking will remove the allocated freight from this GRN. Continue?')) {
        return;
      }
    }
    const res = unlinkGrnFromTrip(currentTrip.id, grnId);
    if (res.success) {
      loadData();
      setActionSuccessMsg('Supplier invoice unlinked and original costs restored');
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } else {
      setActionErrorMsg(res.message);
      setTimeout(() => setActionErrorMsg(null), 4000);
    }
  };

  // Handle finalize and post
  const handleFinalizeTrip = () => {
    if (!currentTrip) return;
    if (currentLinkedGrns.length === 0) {
      setActionErrorMsg('Cannot finalize trip without linked supplier invoices.');
      setTimeout(() => setActionErrorMsg(null), 4000);
      return;
    }

    const confirmText =
      `Post and finalize Procurement Trip ${currentTrip.tripNumber}?\n\n` +
      `• Total Goods: $${(Number(currentTrip.totalGoodsPurchased) || 0).toFixed(2)} across ${currentLinkedGrns.length} supplier invoices\n` +
      `• Shared Transport Freight: $${(Number(currentTrip.totalTripLandedCosts) || 0).toFixed(2)}\n` +
      `• Payment Mode: ${currentTrip.landedCosts?.[0]?.paymentMethod || 'cash_till'}\n\n` +
      `Each supplier invoice will receive its exact apportioned freight down to the cent. Proceed?`;

    if (!window.confirm(confirmText)) return;

    const res = finalizeAndPostTripManifest(currentTrip.id, {
      staffId: currentUser?.id || 'USR-001',
      staffName: currentUser?.name || 'Manager',
    });

    if (res.success) {
      loadData();
      setActionSuccessMsg(res.message);
      setTimeout(() => setActionSuccessMsg(null), 6000);
    } else {
      setActionErrorMsg(res.message);
      setTimeout(() => setActionErrorMsg(null), 5000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 rounded-2xl border border-indigo-500/20 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-indigo-500/5 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                <Truck className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                  Procurement Trips & Freight Manifests
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Town Run Manifest
                  </span>
                </h1>
                <p className="text-xs md:text-sm text-slate-400">
                  Receive purchases from multiple suppliers and apportion collective transport hire ({' '}
                  <span className="text-amber-300 font-medium">e.g. $30 truck hire across $1,000 goods</span> ) down
                  to each item while preserving individual supplier accounts.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setIsCreatingNew(true);
                setSelectedTripId(null);
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>New Town Run Trip</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccessMsg && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-sm font-medium animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}
      {actionErrorMsg && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-950/80 border border-rose-600/60 text-rose-200 text-sm font-medium animate-fadeIn">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{actionErrorMsg}</span>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Trips List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-400" />
                Procurement Trips ({trips.length})
              </h3>
              <div className="flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    statusFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('DRAFT')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    statusFilter === 'DRAFT' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Draft
                </button>
                <button
                  onClick={() => setStatusFilter('COMPLETED')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    statusFilter === 'COMPLETED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Posted
                </button>
              </div>
            </div>

            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search trip #, name, carrier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredTrips.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No procurement trips found. Click &quot;New Town Run Trip&quot; to begin.
                </div>
              ) : (
                filteredTrips.map((t) => {
                  const isSelected = t.id === selectedTripId && !isCreatingNew;
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        setSelectedTripId(t.id);
                        setIsCreatingNew(false);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md ring-1 ring-indigo-500/30'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-mono text-xs font-bold text-white tracking-wide">{t.tripNumber}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            t.status === 'COMPLETED'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                              : 'bg-amber-950/80 text-amber-300 border-amber-700'
                          }`}
                        >
                          {t.status === 'COMPLETED' ? 'Finalized' : 'Draft'}
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-slate-200 truncate mb-1">{t.tripName}</div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>{t.date || ''}</span>
                        <span className="text-indigo-300 font-semibold">{(t.linkedGrnIds || []).length} Invoices</span>
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-850 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">
                          Goods: <strong className="text-slate-200">${(Number(t.totalGoodsPurchased) || 0).toFixed(2)}</strong>
                        </span>
                        <span className="text-amber-400 font-bold">
                          Freight: ${(Number(t.totalTripLandedCosts) || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Main Panel: Trip Details / New Trip Form */}
        <div className="lg:col-span-8 space-y-6">
          {isCreatingNew ? (
            /* ================= CREATE NEW TRIP WIZARD ================= */
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-indigo-400" />
                    Create New Procurement Trip Manifest
                  </h2>
                  <p className="text-xs text-slate-400">
                    Set up a shared town procurement trip (e.g. $1,000 purchases across multiple suppliers + $30 transport hire).
                  </p>
                </div>
                <button
                  onClick={() => setIsCreatingNew(false)}
                  className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800"
                >
                  Cancel
                </button>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Trip Name / Description</label>
                  <input
                    type="text"
                    value={draftTripName}
                    onChange={(e) => setDraftTripName(e.target.value)}
                    placeholder="e.g. Town Run - Wholesale Market"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Trip Date</label>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Carrier / Transporter Name</label>
                  <input
                    type="text"
                    value={draftCarrier}
                    onChange={(e) => {
                      setDraftCarrier(e.target.value);
                      setDraftTransporterName(e.target.value);
                    }}
                    placeholder="e.g. Moyo Transport / Driver John"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Vehicle Registration (Optional)</label>
                  <input
                    type="text"
                    value={draftVehicleReg}
                    onChange={(e) => setDraftVehicleReg(e.target.value)}
                    placeholder="e.g. AEZ-4590"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Destination / Wholesale Market</label>
                  <input
                    type="text"
                    value={draftDestination}
                    onChange={(e) => setDraftDestination(e.target.value)}
                    placeholder="e.g. Downtown Wholesale Market"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-300 mb-1">Shared Transport Freight ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs text-slate-400 font-mono">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draftFreightAmount}
                      onChange={(e) => setDraftFreightAmount(Number(e.target.value) || 0)}
                      className="w-full bg-slate-950 border border-amber-500/50 rounded-xl pl-7 pr-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Freight Payment Source</label>
                  <select
                    value={draftPaymentMethod}
                    onChange={(e) => setDraftPaymentMethod(e.target.value as TripFreightPaymentMethod)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="cash_till">💵 Paid in Cash from Till (Drawer Cash-Out)</option>
                    <option value="petty_cash">💼 Paid via Petty Cash</option>
                    <option value="payable_account">📑 On Credit / Transporter Accounts Payable</option>
                    <option value="already_paid">💳 Already Paid in Advance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Allocation Method</label>
                  <select
                    value={draftAllocationMethod}
                    onChange={(e) => setDraftAllocationMethod(e.target.value as LandedCostAllocationMethod)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="by_value">By Value (Proportional to Subtotal - Standard)</option>
                    <option value="by_quantity">By Quantity (Proportional to Total Units)</option>
                    <option value="by_weight">By Weight (Proportional to kg)</option>
                    <option value="by_margin">By Margin Capacity (Managerial Override)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Notes / Trip Logistics</label>
                <textarea
                  rows={2}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="Optional notes regarding the trip, drivers, fuel or special instructions..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-850">
                <button
                  onClick={() => setIsCreatingNew(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateNewTrip}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-semibold text-xs shadow-lg shadow-indigo-600/30"
                >
                  <Check className="w-4 h-4" />
                  <span>Create Trip Manifest</span>
                </button>
              </div>
            </div>
          ) : currentTrip ? (
            /* ================= VIEW / MANAGE EXISTING TRIP ================= */
            <div className="space-y-6">
              {/* Trip Header Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-indigo-400">{currentTrip.tripNumber}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          currentTrip.status === 'COMPLETED'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                            : 'bg-amber-950 text-amber-300 border-amber-700'
                        }`}
                      >
                        {currentTrip.status === 'COMPLETED' ? 'Finalized & Posted' : 'Draft / In-Progress'}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-white">{currentTrip.tripName}</h2>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 mt-1 font-mono">
                      <span>📅 Date: {currentTrip.date}</span>
                      <span>🚛 Carrier: {currentTrip.carrierOrDriver || 'Not set'}</span>
                      {currentTrip.vehicleReg && <span>🚗 Reg: {currentTrip.vehicleReg}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPrintModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Manifest</span>
                    </button>
                    {currentTrip.status !== 'COMPLETED' && (
                      <button
                        onClick={handleFinalizeTrip}
                        disabled={currentLinkedGrns.length === 0}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Post & Finalize Trip</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Financial KPI Banner */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">Total Goods Purchased</span>
                    <span className="text-lg font-mono font-bold text-white">
                      ${(Number(currentTrip.totalGoodsPurchased) || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      {currentLinkedGrns.length} Supplier Invoices
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-amber-500/30">
                    <span className="text-[11px] font-semibold text-amber-300 block mb-1">Trip Freight / Landed</span>
                    <span className="text-lg font-mono font-bold text-amber-400">
                      ${(Number(currentTrip.totalTripLandedCosts) || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-amber-400/80 block mt-0.5">
                      {currentTrip.landedCosts?.[0]?.paymentMethod || 'cash_till'}
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-indigo-500/30">
                    <span className="text-[11px] font-semibold text-indigo-300 block mb-1">Total Landed Valuation</span>
                    <span className="text-lg font-mono font-bold text-indigo-300">
                      ${(Number(currentTrip.totalTripCost) || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-indigo-400/70 block mt-0.5">Inventory Layer Value</span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">Allocation Method</span>
                    <span className="text-sm font-semibold text-slate-200 capitalize block truncate">
                      {currentTrip.landedCosts?.[0]?.allocationMethod?.replace('by_', 'By ') || 'By Value'}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono block mt-0.5">
                      {allocationCalc.isExactMatch ? 'Exact cent match ✅' : 'Rounding adjustment'}
                    </span>
                  </div>
                </div>

                {/* Landed Cost Settings (Editable when in draft) */}
                {currentTrip.status !== 'COMPLETED' && (
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-amber-400" />
                        Configure Shared Transport Hire & Allocation
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Freight Amount ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={currentTrip.landedCosts?.[0]?.amount ?? 0}
                          onChange={(e) => handleUpdateTripFreight({ amount: Number(e.target.value) || 0 })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Payment Method</label>
                        <select
                          value={currentTrip.landedCosts?.[0]?.paymentMethod || 'cash_till'}
                          onChange={(e) =>
                            handleUpdateTripFreight({
                              paymentMethod: e.target.value as TripFreightPaymentMethod,
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400"
                        >
                          <option value="cash_till">💵 Cash from Till</option>
                          <option value="petty_cash">💼 Petty Cash</option>
                          <option value="payable_account">📑 Transporter Payable (Credit)</option>
                          <option value="already_paid">💳 Already Paid</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Allocation Basis</label>
                        <select
                          value={currentTrip.landedCosts?.[0]?.allocationMethod || 'by_value'}
                          onChange={(e) =>
                            handleUpdateTripFreight({
                              allocationMethod: e.target.value as LandedCostAllocationMethod,
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400"
                        >
                          <option value="by_value">By Value (Proportional to Subtotal)</option>
                          <option value="by_quantity">By Quantity (Units)</option>
                          <option value="by_weight">By Weight (kg)</option>
                          <option value="by_margin">By Margin Capacity (Profit)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Linked Supplier Invoices Section */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-indigo-400" />
                      Linked Supplier Invoices ({currentLinkedGrns.length})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Individual supplier invoices participating in this town run. Each supplier&apos;s payable is kept
                      separate and pure.
                    </p>
                  </div>

                  {currentTrip.status !== 'COMPLETED' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowLinkGrnModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Link Existing GRN</span>
                      </button>
                      {onGoToGrnCreate && (
                        <button
                          onClick={onGoToGrnCreate}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Create New GRN</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Allocation Summary Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900/90 text-slate-400 font-bold border-b border-slate-800 text-[11px]">
                        <th className="py-2.5 px-3">Supplier Name</th>
                        <th className="py-2.5 px-3">Invoice / GRN #</th>
                        <th className="py-2.5 px-2 text-right">Goods Subtotal</th>
                        <th className="py-2.5 px-2 text-center">Trip Share %</th>
                        <th className="py-2.5 px-3 text-right text-amber-300">Apportioned Freight</th>
                        <th className="py-2.5 px-3 text-right text-indigo-300">Effective Total Landed</th>
                        <th className="py-2.5 px-3 text-center">Items</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 font-mono text-[11px]">
                      {allocationCalc.summaries.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                            No supplier invoices linked to this trip yet. Click &quot;Link Existing GRN&quot; or &quot;Create New GRN&quot;
                            above to add invoices.
                          </td>
                        </tr>
                      ) : (
                        allocationCalc.summaries.map((summary) => {
                          const isExpanded = expandedGrnId === summary.grnId;
                          return (
                            <React.Fragment key={summary.grnId}>
                              <tr className="hover:bg-slate-900/60 transition-colors">
                                <td className="py-2.5 px-3 font-sans font-bold text-slate-200">
                                  {summary.supplierName}
                                </td>
                                <td className="py-2.5 px-3 text-indigo-400 font-medium">
                                  {summary.invoiceNo || summary.grnNumber}
                                </td>
                                <td className="py-2.5 px-2 text-right text-slate-300 font-bold">
                                  ${(Number(summary.subtotal) || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-2 text-center text-slate-400 font-semibold">
                                  {(Number(summary.valueSharePercent) || 0).toFixed(1)}%
                                </td>
                                <td className="py-2.5 px-3 text-right font-bold text-amber-400">
                                  +${(Number(summary.allocatedLandedCost) || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-bold text-indigo-300">
                                  ${(Number(summary.effectiveTotalCost) || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-center font-sans">
                                  <button
                                    onClick={() => setExpandedGrnId(isExpanded ? null : summary.grnId)}
                                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700"
                                  >
                                    <span>{summary.itemCount || 0} items</span>
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </button>
                                </td>
                                <td className="py-2.5 px-3 text-right font-sans">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {onViewGrnDetail && (
                                      <button
                                        onClick={() => onViewGrnDetail(summary.grnId)}
                                        title="View GRN Details"
                                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-300"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {currentTrip.status !== 'COMPLETED' && (
                                      <button
                                        onClick={() => handleUnlinkGrn(summary.grnId)}
                                        title="Unlink from Trip"
                                        className="p-1 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>

                              {/* Expanded Item-Level Landed Cost Breakdown */}
                              {isExpanded && (
                                <tr className="bg-slate-900/40">
                                  <td colSpan={8} className="p-3 pl-8">
                                    <div className="border border-slate-800 rounded-lg p-3 bg-slate-950/90 space-y-2">
                                      <div className="flex items-center justify-between text-[11px] font-sans font-semibold text-slate-400">
                                        <span>Product-Level Landed Unit Cost Breakdown:</span>
                                        <span className="text-amber-300">
                                          Apportioned Freight for this GRN: ${(Number(summary.allocatedLandedCost) || 0).toFixed(2)}
                                        </span>
                                      </div>
                                      <table className="w-full text-left text-[11px] border-collapse">
                                        <thead>
                                          <tr className="text-slate-500 font-bold border-b border-slate-850">
                                            <th className="py-1">Product</th>
                                            <th className="py-1 text-center">Qty</th>
                                            <th className="py-1 text-right">Base Cost</th>
                                            <th className="py-1 text-right text-amber-300">Allocated Freight</th>
                                            <th className="py-1 text-right text-indigo-300">Landed Unit Cost</th>
                                            <th className="py-1 text-right">Selling Price</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-850/60 font-mono text-[10px]">
                                          {(summary.itemAllocations || []).map((it, itIdx) => (
                                            <tr key={`${it.itemId}-${itIdx}`} className="hover:bg-slate-900/50">
                                              <td className="py-1 font-sans text-slate-300 font-medium">{it.itemName}</td>
                                              <td className="py-1 text-center text-slate-400">{it.quantity}</td>
                                              <td className="py-1 text-right text-slate-300">${(Number(it.unitCost) || 0).toFixed(2)}</td>
                                              <td className="py-1 text-right text-amber-400 font-bold">
                                                +${(Number(it.allocatedLandedCost) || 0).toFixed(2)}
                                              </td>
                                              <td className="py-1 text-right text-indigo-300 font-bold">
                                                ${(Number(it.landedUnitCost) || 0).toFixed(4)}
                                              </td>
                                              <td className="py-1 text-right text-slate-400">
                                                {it.sellingPrice ? `$${(Number(it.sellingPrice) || 0).toFixed(2)}` : '-'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    {allocationCalc.summaries.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-900 font-mono font-bold text-[11px] border-t-2 border-slate-700">
                          <td className="py-2.5 px-3 font-sans text-white">Trip Totals:</td>
                          <td className="py-2.5 px-3 text-slate-400 font-sans">
                            {allocationCalc.summaries.length} Invoices
                          </td>
                          <td className="py-2.5 px-2 text-right text-white">
                            ${(Number(currentTrip.totalGoodsPurchased) || 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 text-center text-emerald-400">100%</td>
                          <td className="py-2.5 px-3 text-right text-amber-300">
                            ${((Number(allocationCalc.totalAllocatedCents) || 0) / 100).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-indigo-300">
                            ${(Number(currentTrip.totalTripCost) || 0).toFixed(2)}
                          </td>
                          <td colSpan={2} className="py-2.5 px-3 text-right text-emerald-400 font-sans text-[10px]">
                            Exact Cent Balance ✅
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Explanation / Audit Notice */}
                <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-indigo-200 text-xs">
                  <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Why This Model Works:</strong> Each product supplier receives their
                    invoice credit or cash payment strictly matching their billed amount (e.g. $600 for Supplier A,
                    $250 for Megapak, $150 for Delta). The $30 transport hire is accounted for separately to the
                    transporter, while your inventory cost layers absorb the true landed valuation ($1,030.00).
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* No trip selected empty state */
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
              <Truck className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-lg font-bold text-white">No Procurement Trip Selected</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Select an existing procurement trip from the sidebar or click &quot;New Town Run Trip&quot; to group invoices from
                multiple suppliers with shared transport.
              </p>
              <button
                onClick={() => {
                  setIsCreatingNew(true);
                  setSelectedTripId(null);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30"
              >
                Create New Town Run
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Link Existing GRN */}
      {showLinkGrnModal && currentTrip && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Link Supplier Invoices to {currentTrip.tripNumber}
              </h3>
              <button
                onClick={() => setShowLinkGrnModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Select existing Goods Received Notes (GRNs) received on this date or trip to apportion the shared transport.
            </p>

            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {availableUnlinkedGrns.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No unlinked supplier invoices found. Create a new GRN first.
                </div>
              ) : (
                availableUnlinkedGrns.map((g) => {
                  const items = Array.isArray(g.lineItems) ? g.lineItems : [];
                  const subtotal = items.reduce(
                    (s, it) => s + (Number(it.subtotal) || (Number(it.quantity) || 0) * (Number(it.unitCost) || 0)),
                    0
                  );
                  const suppName = (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier';
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/50 transition-all"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-white">{suppName}</span>
                          <span className="font-mono text-[11px] text-indigo-400">({g.grnNumber || g.id})</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Date: {g.dateReceived || ''} • {items.length} items • Subtotal: ${(Number(subtotal) || 0).toFixed(2)}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          handleLinkGrn(g.id);
                          setShowLinkGrnModal(false);
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow"
                      >
                        Link to Trip
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowLinkGrnModal(false)}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Printable Manifest Voucher */}
      {showPrintModal && currentTrip && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Printer className="w-4 h-4 text-indigo-400" />
                Procurement Trip Manifest Voucher
              </h3>
              <button
                onClick={() => setShowPrintModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Printable Sheet */}
            <div className="bg-white text-slate-900 p-8 rounded-xl font-sans shadow-lg space-y-6">
              <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">
                    Procurement Trip Manifest
                  </h1>
                  <p className="text-xs text-slate-600">Combined Town Run & Multi-Supplier Freight Voucher</p>
                </div>
                <div className="text-right font-mono">
                  <div className="text-lg font-bold text-slate-900">{currentTrip.tripNumber}</div>
                  <div className="text-xs text-slate-600">Date: {currentTrip.date}</div>
                  <div className="text-xs font-bold text-emerald-700">STATUS: {currentTrip.status}</div>
                </div>
              </div>

              {/* Trip Logistics Info */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-100 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="font-bold text-slate-700 block">Trip Name:</span>
                  <span>{currentTrip.tripName}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 block">Carrier / Transporter:</span>
                  <span>{currentTrip.carrierOrDriver || 'Local Transport'}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 block">Vehicle Reg:</span>
                  <span>{currentTrip.vehicleReg || 'N/A'}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 block">Destination:</span>
                  <span>{currentTrip.destinationOrMarket || 'Town Wholesale Market'}</span>
                </div>
              </div>

              {/* Summary Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Participating Supplier Invoices & Apportioned Freight
                </h4>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-800 text-[11px] font-bold">
                      <th className="py-1">Supplier</th>
                      <th className="py-1">Invoice / GRN #</th>
                      <th className="py-1 text-right">Goods Value</th>
                      <th className="py-1 text-center">Share %</th>
                      <th className="py-1 text-right">Allocated Freight</th>
                      <th className="py-1 text-right">Effective Landed Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                    {(allocationCalc.summaries || []).map((s) => (
                      <tr key={s.grnId}>
                        <td className="py-1.5 font-sans font-semibold text-slate-800">{s.supplierName}</td>
                        <td className="py-1.5">{s.invoiceNo || s.grnNumber}</td>
                        <td className="py-1.5 text-right">${(Number(s.subtotal) || 0).toFixed(2)}</td>
                        <td className="py-1.5 text-center">{(Number(s.valueSharePercent) || 0).toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-bold text-amber-700">
                          +${(Number(s.allocatedLandedCost) || 0).toFixed(2)}
                        </td>
                        <td className="py-1.5 text-right font-bold">${(Number(s.effectiveTotalCost) || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-900 font-bold font-mono text-xs">
                      <td colSpan={2} className="py-2 font-sans">
                        Totals:
                      </td>
                      <td className="py-2 text-right">${(Number(currentTrip.totalGoodsPurchased) || 0).toFixed(2)}</td>
                      <td className="py-2 text-center">100%</td>
                      <td className="py-2 text-right text-amber-700">
                        ${(Number(currentTrip.totalTripLandedCosts) || 0).toFixed(2)}
                      </td>
                      <td className="py-2 text-right">${(Number(currentTrip.totalTripCost) || 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-300 text-xs">
                <div>
                  <div className="border-b border-slate-400 pb-8 mb-1" />
                  <span className="font-bold block">Transporter / Driver</span>
                  <span className="text-[10px] text-slate-500">{currentTrip.carrierOrDriver}</span>
                </div>
                <div>
                  <div className="border-b border-slate-400 pb-8 mb-1" />
                  <span className="font-bold block">Receiving Supervisor</span>
                  <span className="text-[10px] text-slate-500">{currentUser?.name || 'Staff'}</span>
                </div>
                <div>
                  <div className="border-b border-slate-400 pb-8 mb-1" />
                  <span className="font-bold block">Finance / Manager</span>
                  <span className="text-[10px] text-slate-500">Authorized Signatory</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow"
              >
                <Printer className="w-4 h-4" />
                <span>Print Document</span>
              </button>
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
