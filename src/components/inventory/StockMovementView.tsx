import React, { useEffect, useMemo, useState } from 'react';
import {
  InventoryItem,
  Salesperson,
  StockAdjustmentDirection,
  StockAdjustmentEntryMode,
  StockAdjustmentReasonCode,
  StockAdjustmentRecord,
  StockMovementEntry,
} from '../../types';
import {
  getInventoryItems,
  getStockMovements,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import {
  STOCK_ADJUSTMENT_HIGH_VALUE_USD,
  STOCK_ADJUSTMENT_MIN_NOTE_LENGTH,
  STOCK_ADJUSTMENT_PHOTO_RECOMMENDED_USD,
  STOCK_ADJUSTMENT_REASONS,
  approveStockAdjustment,
  canPrepareStockAdjustment,
  cancelPendingStockAdjustment,
  createAndPostOwnerStockAdjustment,
  createStockAdjustmentRequest,
  evaluateAdjustmentAnomalies,
  getReasonMeta,
  getStockAdjustments,
  isStockAdjustmentOwner,
  rejectStockAdjustment,
  reverseApprovedStockAdjustment,
} from '../../db/daos/stockAdjustmentDao';
import {
  decomposeStockUnits,
  normalizeStockFields,
  resolveItemValuationUnitCost,
  roundStockUnits,
} from '../../utils/inventoryMath';

const resolveEffectiveTotalUnits = (item: Partial<InventoryItem>): number =>
  normalizeStockFields(item).totalUnits;
const resolveEffectiveUnitCost = (item: Partial<InventoryItem>): number =>
  resolveItemValuationUnitCost(item);
const roundUnits = roundStockUnits;
import { ManagerPinModal } from '../common/ManagerPinModal';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileWarning,
  History,
  Layers,
  Lock,
  PlusCircle,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';

interface StockMovementViewProps {
  currentUser: Salesperson | null;
  onTriggerGRN?: () => void;
}

type ActiveTab = 'PENDING' | 'ADJUSTMENTS' | 'MOVEMENTS';

type PendingPinFlow =
  | { kind: 'APPROVE'; adjustment: StockAdjustmentRecord }
  | { kind: 'REJECT'; adjustment: StockAdjustmentRecord; rejectionReason: string }
  | { kind: 'DIRECT_POST' }
  | { kind: 'REVERSE'; adjustment: StockAdjustmentRecord; reversalNote: string };

const ANOMALY_LABELS: Record<string, { label: string; tone: string }> = {
  HIGH_VALUE: {
    label: `High Value (≥ $${STOCK_ADJUSTMENT_HIGH_VALUE_USD})`,
    tone: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  VELOCITY_SPIKE: {
    label: 'Repeated Write-Offs (7d)',
    tone: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  GRV_BYPASS_WARNING: {
    label: 'Manual Addition (Use GRV for Purchases)',
    tone: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  },
  STOCK_DRIFT_SINCE_SUBMISSION: {
    label: 'Live Stock Changed Since Submission',
    tone: 'bg-orange-100 text-orange-900 border-orange-300',
  },
  BELOW_ZERO_CLAMPED: {
    label: 'Clamped at 0 Stock',
    tone: 'bg-slate-200 text-slate-800 border-slate-300',
  },
};

function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format.'));
      img.onload = () => {
        const maxDim = 720;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.68));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const StockMovementView: React.FC<StockMovementViewProps> = ({
  currentUser,
  onTriggerGRN,
}) => {
  const isOwner = isStockAdjustmentOwner(currentUser?.role);
  const canPrepare = canPrepareStockAdjustment(currentUser?.role);

  const [movements, setMovements] = useState<StockMovementEntry[]>(() => getStockMovements());
  const [adjustments, setAdjustments] = useState<StockAdjustmentRecord[]>(() =>
    getStockAdjustments()
  );
  const [items, setItems] = useState<InventoryItem[]>(() => getInventoryItems());

  const [activeTab, setActiveTab] = useState<ActiveTab>(() =>
    getStockAdjustments().some((a) => a.status === 'PENDING_OWNER_APPROVAL')
      ? 'PENDING'
      : 'ADJUSTMENTS'
  );

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedItemId, setSelectedItemId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Toast feedback
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Create Adjustment Modal
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [adjItemId, setAdjItemId] = useState<string>('');
  const [entryMode, setEntryMode] = useState<StockAdjustmentEntryMode>('PHYSICAL_COUNT');
  const [direction, setDirection] = useState<StockAdjustmentDirection>('SUBTRACT');
  const [reasonCode, setReasonCode] = useState<StockAdjustmentReasonCode>('DAMAGED_SPOILAGE');
  const [deltaCases, setDeltaCases] = useState<string>('0');
  const [deltaSingles, setDeltaSingles] = useState<string>('0');
  const [countedCases, setCountedCases] = useState<string>('0');
  const [countedSingles, setCountedSingles] = useState<string>('0');
  const [auditNote, setAuditNote] = useState<string>('');
  const [evidencePhoto, setEvidencePhoto] = useState<string>('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reject / Reverse input modals (non-blocking — no window.prompt)
  const [rejectTarget, setRejectTarget] = useState<StockAdjustmentRecord | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [reverseTarget, setReverseTarget] = useState<StockAdjustmentRecord | null>(null);
  const [reverseNoteInput, setReverseNoteInput] = useState('');
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  // Owner PIN Modal flow
  const [pinFlow, setPinFlow] = useState<PendingPinFlow | null>(null);

  const showToast = (kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => {
      setToast((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  };

  // LIVE SYNC REACTIVITY: refresh whenever DB, Local Hub, Mesh, or Cloud sync updates records
  useEffect(() => {
    const refresh = () => {
      setMovements(getStockMovements());
      setAdjustments(getStockAdjustments());
      setItems(getInventoryItems());
    };
    const unsubscribeDb = subscribeRoomDatabase(refresh);
    const events = [
      'saimetric_stock_adjustments_updated',
      'saimetric_inventory_updated',
      'mesh-inventory-received',
      'mesh-catchup-completed',
      'saimetric_expenses_updated',
    ];
    events.forEach((ev) => window.addEventListener(ev, refresh));
    return () => {
      unsubscribeDb();
      events.forEach((ev) => window.removeEventListener(ev, refresh));
    };
  }, []);

  // Initialize default selected item when modal opens
  const openCreateModal = () => {
    const freshItems = getInventoryItems();
    setItems(freshItems);
    const first = freshItems[0];
    setItemSearch('');
    setAdjItemId(first?.itemId || '');
    setEntryMode('PHYSICAL_COUNT');
    setDirection('SUBTRACT');
    setReasonCode('COUNT_VARIANCE_SHORT');
    setDeltaCases('0');
    setDeltaSingles('0');
    if (first) {
      const upc = Math.max(1, Number(first.unitsPerCase) || 1);
      const decomp = decomposeStockUnits(resolveEffectiveTotalUnits(first), upc, { keepCasesZero: upc <= 1 });
      setCountedCases(String(decomp.stockCases));
      setCountedSingles(String(decomp.stockSingles));
    } else {
      setCountedCases('0');
      setCountedSingles('0');
    }
    setAuditNote('');
    setEvidencePhoto('');
    setFormError(null);
    setShowAdjustModal(true);
  };

  const selectedItem = useMemo(
    () => items.find((i) => i.itemId === adjItemId) || null,
    [items, adjItemId]
  );

  // Sync counted defaults when product changes in modal
  const handleSelectModalItem = (nextId: string) => {
    setAdjItemId(nextId);
    const found = items.find((i) => i.itemId === nextId);
    if (found) {
      const upc = Math.max(1, Number(found.unitsPerCase) || 1);
      const decomp = decomposeStockUnits(resolveEffectiveTotalUnits(found), upc, { keepCasesZero: upc <= 1 });
      setCountedCases(String(decomp.stockCases));
      setCountedSingles(String(decomp.stockSingles));
    }
  };

  const modalFilteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 120);
    return items
      .filter(
        (i) =>
          i.itemName.toLowerCase().includes(q) ||
          i.itemId.toLowerCase().includes(q) ||
          String((i as any).sku || '').toLowerCase().includes(q)
      )
      .slice(0, 120);
  }, [items, itemSearch]);

  // Live preview math for the adjustment modal
  const previewCalc = useMemo(() => {
    if (!selectedItem) return null;
    const upc = Math.max(1, Number(selectedItem.unitsPerCase) || 1);
    const currentTotal = resolveEffectiveTotalUnits(selectedItem);
    const currentDecomp = decomposeStockUnits(currentTotal, upc, { keepCasesZero: upc <= 1 });

    let deltaUnits = 0;
    let resolvedDir: StockAdjustmentDirection = direction;
    if (entryMode === 'PHYSICAL_COUNT') {
      const cCases = Math.max(0, Number(countedCases) || 0);
      const cSingles = Math.max(0, Number(countedSingles) || 0);
      const targetTotal = roundUnits(cCases * upc + cSingles);
      deltaUnits = roundUnits(targetTotal - currentTotal);
      resolvedDir = deltaUnits < 0 ? 'SUBTRACT' : 'ADD';
    } else {
      const absCases = Math.abs(Number(deltaCases) || 0);
      const absSingles = Math.abs(Number(deltaSingles) || 0);
      const absUnits = roundUnits(absCases * upc + absSingles);
      deltaUnits = (direction === 'SUBTRACT' ? -1 : 1) * absUnits;
      resolvedDir = direction;
    }

    const projectedTotal = Math.max(0, roundUnits(currentTotal + deltaUnits));
    const projectedDecomp = decomposeStockUnits(projectedTotal, upc, { keepCasesZero: upc <= 1 });
    const evaluation = evaluateAdjustmentAnomalies({
      item: selectedItem,
      deltaUnits,
      reasonCode,
      existingAdjustments: adjustments,
    });

    return {
      upc,
      currentTotal,
      currentDecomp,
      deltaUnits,
      resolvedDir,
      projectedTotal,
      projectedDecomp,
      ...evaluation,
    };
  }, [
    selectedItem,
    entryMode,
    direction,
    deltaCases,
    deltaSingles,
    countedCases,
    countedSingles,
    reasonCode,
    adjustments,
  ]);

  // Automatically pick a compatible reason when direction flips
  const effectiveDirection: StockAdjustmentDirection =
    previewCalc && Math.abs(previewCalc.deltaUnits) > 0.0001
      ? previewCalc.resolvedDir
      : direction;

  const validReasons = useMemo(
    () =>
      STOCK_ADJUSTMENT_REASONS.filter(
        (r) =>
          r.code !== 'REVERSAL' &&
          (r.direction === 'BOTH' || r.direction === effectiveDirection)
      ),
    [effectiveDirection]
  );

  useEffect(() => {
    if (!validReasons.some((r) => r.code === reasonCode) && validReasons.length > 0) {
      setReasonCode(validReasons[0].code);
    }
  }, [effectiveDirection, validReasons, reasonCode]);

  // Pending & filtered lists
  const pendingAdjustments = useMemo(
    () => adjustments.filter((a) => a.status === 'PENDING_OWNER_APPROVAL'),
    [adjustments]
  );

  const kpiStats = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const pendingNetUsd = pendingAdjustments.reduce(
      (sum, a) => sum + (Number(a.valuationImpactUsd) || 0),
      0
    );
    const shrinkage7dUsd = adjustments
      .filter((a) => {
        if (a.status !== 'APPROVED' || a.deltaUnits >= 0) return false;
        const ts = new Date(a.approvedAt || a.createdAt || 0).getTime() || Number(a.updatedAt) || 0;
        return ts >= sevenDaysAgo;
      })
      .reduce((sum, a) => sum + Math.abs(Number(a.valuationImpactUsd) || 0), 0);
    const approvedCount = adjustments.filter((a) => a.status === 'APPROVED').length;
    const rejectedCount = adjustments.filter((a) => a.status === 'REJECTED').length;
    return { pendingNetUsd, shrinkage7dUsd, approvedCount, rejectedCount };
  }, [adjustments, pendingAdjustments]);

  const filteredAdjustments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return adjustments.filter((a) => {
      if (selectedStatus !== 'ALL' && a.status !== selectedStatus) return false;
      if (selectedItemId !== 'ALL' && a.itemId !== selectedItemId) return false;
      if (q) {
        const hay = `${a.id} ${a.itemId} ${a.itemName} ${a.reasonCode} ${a.auditNote} ${a.createdByName} ${a.approvedByName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [adjustments, searchQuery, selectedStatus, selectedItemId]);

  const filteredMovements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return movements.filter((m) => {
      if (selectedType !== 'ALL' && m.movementType !== selectedType) return false;
      if (selectedItemId !== 'ALL' && m.itemId !== selectedItemId) return false;
      if (q) {
        const hay = `${m.movementId || ''} ${m.itemId || ''} ${m.itemName || ''} ${m.reason || ''} ${m.referenceId || ''} ${m.staffName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [movements, searchQuery, selectedType, selectedItemId]);

  const buildCreateInput = () => ({
    itemId: adjItemId,
    entryMode,
    direction: effectiveDirection,
    reasonCode,
    auditNote: auditNote.trim(),
    deltaCases: Number(deltaCases) || 0,
    deltaSingles: Number(deltaSingles) || 0,
    countedCases: Number(countedCases) || 0,
    countedSingles: Number(countedSingles) || 0,
    evidencePhotoDataUrl: evidencePhoto || undefined,
  });

  const validateModalBeforeSubmit = (): boolean => {
    setFormError(null);
    if (!selectedItem) {
      setFormError('Please select a product.');
      return false;
    }
    if (!previewCalc || Math.abs(previewCalc.deltaUnits) < 0.0001) {
      setFormError('Quantity change must be non-zero.');
      return false;
    }
    if (auditNote.trim().length < STOCK_ADJUSTMENT_MIN_NOTE_LENGTH) {
      setFormError(
        `Please enter a detailed audit note (at least ${STOCK_ADJUSTMENT_MIN_NOTE_LENGTH} characters).`
      );
      return false;
    }
    return true;
  };

  const handleSubmitPending = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateModalBeforeSubmit()) return;
    const res = createStockAdjustmentRequest(buildCreateInput(), currentUser);
    if (!res.success) {
      setFormError(res.message);
      return;
    }
    setShowAdjustModal(false);
    setActiveTab('PENDING');
    showToast('success', res.message);
  };

  const handleOwnerDirectPostClick = () => {
    if (!validateModalBeforeSubmit()) return;
    setPinFlow({ kind: 'DIRECT_POST' });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setFormError(null);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setEvidencePhoto(dataUrl);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to process evidence photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleCancelPending = (adj: StockAdjustmentRecord) => {
    const res = cancelPendingStockAdjustment(adj.id, currentUser);
    showToast(res.success ? 'success' : 'error', res.message);
  };

  const handlePinAuthorized = (
    owner: Salesperson,
    _reason: string,
    verifiedPin?: string
  ) => {
    if (!pinFlow) return;
    const pin = verifiedPin || '';

    if (pinFlow.kind === 'APPROVE') {
      const res = approveStockAdjustment(pinFlow.adjustment.id, owner, pin);
      showToast(res.success ? 'success' : 'error', res.message);
    } else if (pinFlow.kind === 'REJECT') {
      const res = rejectStockAdjustment(
        pinFlow.adjustment.id,
        owner,
        pin,
        pinFlow.rejectionReason
      );
      setRejectTarget(null);
      setRejectReasonInput('');
      showToast(res.success ? 'success' : 'error', res.message);
    } else if (pinFlow.kind === 'DIRECT_POST') {
      const res = createAndPostOwnerStockAdjustment(buildCreateInput(), owner, pin);
      if (res.success) {
        setShowAdjustModal(false);
        setActiveTab('ADJUSTMENTS');
      }
      showToast(res.success ? 'success' : 'error', res.message);
    } else if (pinFlow.kind === 'REVERSE') {
      const res = reverseApprovedStockAdjustment(
        pinFlow.adjustment.id,
        owner,
        pin,
        pinFlow.reversalNote
      );
      setReverseTarget(null);
      setReverseNoteInput('');
      showToast(res.success ? 'success' : 'error', res.message);
    }
    setPinFlow(null);
  };

  const exportAdjustmentsCSV = () => {
    const headers = [
      'Adjustment ID',
      'Date',
      'Status',
      'Item ID',
      'Item Name',
      'Direction',
      'Reason Code',
      'Delta Units',
      'Before Units',
      'After Units',
      'MWAC Cost',
      'Valuation Impact USD',
      'Prepared By',
      'Prepared Role',
      'Approved By',
      'Approved At',
      'Rejection Reason',
      'Reverses ID',
      'Reversed By ID',
      'Audit Note',
      'Anomaly Flags',
    ];
    const rows = filteredAdjustments.map((a) => [
      a.id,
      a.date,
      a.status,
      a.itemId,
      `"${(a.itemName || '').replace(/"/g, '""')}"`,
      a.direction,
      a.reasonCode,
      a.deltaUnits,
      a.beforeTotalUnits ?? a.submittedTotalUnits,
      a.afterTotalUnits ?? '',
      a.mwacUnitCost.toFixed(4),
      a.valuationImpactUsd.toFixed(2),
      `"${(a.createdByName || '').replace(/"/g, '""')}"`,
      a.createdByRole,
      `"${(a.approvedByName || '').replace(/"/g, '""')}"`,
      a.approvedAt || '',
      `"${(a.rejectionReason || '').replace(/"/g, '""')}"`,
      a.reversesAdjustmentId || '',
      a.reversedByAdjustmentId || '',
      `"${(a.auditNote || '').replace(/"/g, '""')}"`,
      `"${(a.anomalyFlags || []).join('; ')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Stock_Adjustments_Audit_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportMovementsCSV = () => {
    const headers = [
      'Movement ID',
      'Timestamp',
      'Item ID',
      'Item Name',
      'Type',
      'Cases Change',
      'Singles Change',
      'Resulting Cases',
      'Resulting Singles',
      'Reference',
      'Trigger Rule',
      'Reason',
      'Staff',
    ];
    const rows = filteredMovements.map((m) => [
      m.movementId || '',
      m.timestamp || '',
      m.itemId || '',
      `"${(m.itemName || '').replace(/"/g, '""')}"`,
      m.movementType || '',
      m.casesChange ?? 0,
      m.singlesChange ?? 0,
      m.resultingStockCases ?? 0,
      m.resultingStockSingles ?? 0,
      m.referenceId || '',
      m.triggerRule || '',
      `"${(m.reason || '').replace(/"/g, '""')}"`,
      `"${(m.staffName || m.staffId || 'System').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Stock_Movement_Ledger_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getMovementBadge = (type: string, triggerRule?: string) => {
    if (triggerRule) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
          <Sparkles className="w-3 h-3" />
          {type}
        </span>
      );
    }
    switch (type) {
      case 'GOODS_RECEIVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <ArrowDownLeft className="w-3 h-3" />
            GRN Receive
          </span>
        );
      case 'BREAK_CASE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Layers className="w-3 h-3" />
            Case Break
          </span>
        );
      case 'SALE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
            <ArrowUpRight className="w-3 h-3" />
            POS Sale
          </span>
        );
      case 'DAMAGE_LOSS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3 h-3" />
            Damage / Loss
          </span>
        );
      case 'RETURN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <ArrowDownLeft className="w-3 h-3" />
            Return
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            <Sliders className="w-3 h-3" />
            Adjustment
          </span>
        );
    }
  };

  const getStatusBadge = (status: StockAdjustmentRecord['status']) => {
    switch (status) {
      case 'PENDING_OWNER_APPROVAL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3 h-3" />
            Pending Owner Approval
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            Approved & Synced
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3 h-3" />
            Rejected
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 border border-slate-300">
            <Trash2 className="w-3 h-3" />
            Cancelled
          </span>
        );
    }
  };

  // Strict RBAC Gate: Cashiers / Clerks cannot access Manual Stock Adjustments
  if (!canPrepare) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white rounded-3xl p-8 border border-slate-200 shadow-sm text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Restricted Audit Module</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Manual stock additions and subtractions are restricted under SAIMETRIC audit controls.
          Only <span className="font-bold text-slate-900">Managers & Supervisors</span> can prepare
          adjustment requests, and only <span className="font-bold text-slate-900">Owners / Administrators</span>{' '}
          can approve and apply stock changes.
        </p>
        <div className="text-xs font-mono text-slate-500 bg-slate-50 rounded-xl px-4 py-2 border border-slate-200 inline-block">
          Signed in as: {currentUser?.name || 'Unknown'} ({currentUser?.role || 'No Role'})
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`rounded-2xl px-4 py-3 text-xs font-bold flex items-center justify-between gap-3 border shadow-sm ${
            toast.kind === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.kind === 'success' ? (
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{toast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-500 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Stock Adjustments &amp; Movement Audit
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${
                  isOwner
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-900 border-amber-200'
                }`}
              >
                {isOwner ? 'Owner Authority (Approve & Post)' : 'Maker Mode (Prepare for Owner Approval)'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Delta-synced maker-checker inventory control with Owner PIN approval, MWAC valuation tracking &amp; immutable reversals.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={activeTab === 'MOVEMENTS' ? exportMovementsCSV : exportAdjustmentsCSV}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Audit CSV</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-md shadow-slate-300 flex items-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>
              {isOwner ? 'New Stock Adjustment' : 'Prepare Adjustment Request'}
            </span>
          </button>
        </div>
      </div>

      {/* KPI Governance Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Pending Owner Review
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600 font-mono">
              {pendingAdjustments.length}
            </span>
            <span className="text-xs font-mono font-semibold text-slate-600">
              {kpiStats.pendingNetUsd >= 0 ? '+' : '-'}$
              {Math.abs(kpiStats.pendingNetUsd).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            7-Day Approved Shrinkage
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-rose-600 font-mono">
              -${kpiStats.shrinkage7dUsd.toFixed(2)}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Posted to P&amp;L</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Approved &amp; Synced
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-700 font-mono">
              {kpiStats.approvedCount}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              {kpiStats.rejectedCount} rejected
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Total Movement Logs
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {movements.length}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Immutable ledger</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-2xl p-1.5 border border-slate-200 shadow-sm inline-flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('PENDING')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'PENDING'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending Approvals</span>
          {pendingAdjustments.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">
              {pendingAdjustments.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ADJUSTMENTS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'ADJUSTMENTS'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Adjustment Audit Trail ({adjustments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('MOVEMENTS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'MOVEMENTS'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>All Stock Movements ({movements.length})</span>
        </button>
      </div>

      {/* TAB 1: PENDING OWNER APPROVALS QUEUE */}
      {activeTab === 'PENDING' && (
        <div className="space-y-3">
          {!isOwner && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-950 flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                You are in <strong>Preparer (Maker)</strong> mode. Pending requests sync automatically to the Owner&apos;s device and Local Hub — live stock will only change after Owner PIN approval.
              </span>
            </div>
          )}

          {pendingAdjustments.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <div className="font-bold text-slate-900">No Pending Stock Adjustments</div>
              <p className="text-xs text-slate-500">
                All manual stock adjustment requests have been reviewed and synced.
              </p>
            </div>
          ) : (
            pendingAdjustments.map((adj) => {
              const liveItem = items.find((i) => i.itemId === adj.itemId);
              const liveUnits = liveItem ? resolveEffectiveTotalUnits(liveItem) : adj.submittedTotalUnits;
              const stockDrifted = Math.abs(roundUnits(liveUnits - adj.submittedTotalUnits)) > 0.0001;
              const projectedLiveAfter = Math.max(0, roundUnits(liveUnits + adj.deltaUnits));
              const reasonMeta = getReasonMeta(adj.reasonCode);
              const flags = Array.from(
                new Set([
                  ...(adj.anomalyFlags || []),
                  ...(stockDrifted ? ['STOCK_DRIFT_SINCE_SUBMISSION'] : []),
                ])
              );

              return (
                <div
                  key={adj.id}
                  className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg">
                          {adj.id}
                        </span>
                        {getStatusBadge(adj.status)}
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700">
                          {reasonMeta.label}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900">
                        {adj.itemName}{' '}
                        <span className="font-mono text-xs font-normal text-slate-500">
                          ({adj.itemId})
                        </span>
                      </h3>
                      <div className="text-xs text-slate-500">
                        Prepared by <strong className="text-slate-800">{adj.createdByName}</strong> (
                        {adj.createdByRole}) on {new Date(adj.createdAt).toLocaleString()} • Mode:{' '}
                        {adj.entryMode === 'PHYSICAL_COUNT' ? 'Physical Count' : '+/- Delta'}
                      </div>
                    </div>

                    <div className="flex flex-col sm:items-end font-mono">
                      <span
                        className={`text-lg font-black ${
                          adj.deltaUnits < 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {adj.deltaUnits >= 0 ? `+${adj.deltaUnits}` : adj.deltaUnits} units
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          adj.valuationImpactUsd < 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {adj.valuationImpactUsd >= 0 ? '+' : '-'}$
                        {Math.abs(adj.valuationImpactUsd).toFixed(2)} MWAC
                      </span>
                    </div>
                  </div>

                  {/* Stock Snapshot & Live Drift Check */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 rounded-2xl p-3 border border-slate-200/80 text-xs font-mono">
                    <div>
                      <div className="text-[10px] font-sans font-bold uppercase text-slate-500">
                        Stock at Submission
                      </div>
                      <div className="font-bold text-slate-800">
                        {adj.submittedStockCases} cs / {adj.submittedStockSingles} ea ({adj.submittedTotalUnits}u)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans font-bold uppercase text-slate-500">
                        Current Live Stock
                      </div>
                      <div className={`font-bold ${stockDrifted ? 'text-orange-700' : 'text-slate-800'}`}>
                        {liveUnits}u {stockDrifted ? '(Changed since submitted!)' : '(Unchanged)'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans font-bold uppercase text-slate-500">
                        Projected After Approval
                      </div>
                      <div className="font-black text-slate-950">
                        {projectedLiveAfter}u @ ${adj.mwacUnitCost.toFixed(4)}/u
                      </div>
                    </div>
                  </div>

                  {/* Audit Note + Photo Evidence */}
                  <div className="flex flex-col sm:flex-row gap-3 items-start">
                    <div className="flex-1 bg-slate-50/70 rounded-xl p-3 border border-slate-200 text-xs text-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Preparer Audit Explanation
                      </div>
                      <p className="leading-relaxed">{adj.auditNote}</p>
                    </div>
                    {adj.evidencePhotoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewPhotoUrl(adj.evidencePhotoDataUrl || null)}
                        className="shrink-0 group relative rounded-xl overflow-hidden border border-slate-300 w-24 h-20 bg-slate-100"
                        title="View attached evidence photo"
                      >
                        <img
                          src={adj.evidencePhotoDataUrl}
                          alt="Evidence"
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <span className="absolute bottom-1 right-1 bg-slate-900/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                          Photo
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Anomaly Warning Chips */}
                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map((flag) => {
                        const meta = ANOMALY_LABELS[flag] || {
                          label: flag,
                          tone: 'bg-amber-100 text-amber-900 border-amber-300',
                        };
                        return (
                          <span
                            key={flag}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${meta.tone}`}
                          >
                            <FileWarning className="w-3 h-3" />
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    {(adj.createdBy === currentUser?.id || isOwner) && (
                      <button
                        type="button"
                        onClick={() => handleCancelPending(adj)}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition"
                      >
                        Cancel Request
                      </button>
                    )}

                    {isOwner && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectTarget(adj);
                            setRejectReasonInput('');
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition flex items-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPinFlow({ kind: 'APPROVE', adjustment: adj })}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition flex items-center gap-1.5"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Approve with Owner PIN</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: ADJUSTMENT AUDIT TRAIL */}
      {activeTab === 'ADJUSTMENTS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search ID, product, staff, audit note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING_OWNER_APPROVAL">Pending Owner Approval</option>
              <option value="APPROVED">Approved &amp; Synced</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Products</option>
              {items.map((i, idx) => (
                <option key={`${i.itemId}-${idx}`} value={i.itemId}>
                  {i.itemId} — {i.itemName}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-600 uppercase tracking-wider font-semibold border-b border-slate-200">
                    <th className="py-3 px-4">ID &amp; Status</th>
                    <th className="py-3 px-4">Product &amp; Reason</th>
                    <th className="py-3 px-3 text-center">Delta</th>
                    <th className="py-3 px-3 text-center">Before → After</th>
                    <th className="py-3 px-3 text-right">MWAC Impact</th>
                    <th className="py-3 px-4">Maker / Owner Sign-Off</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAdjustments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                        No stock adjustment records match your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredAdjustments.map((adj) => {
                      const reasonMeta = getReasonMeta(adj.reasonCode);
                      return (
                        <tr key={adj.id} className="hover:bg-slate-50/75 transition-colors">
                          <td className="py-3.5 px-4 space-y-1">
                            <div className="font-mono font-bold text-slate-900">{adj.id}</div>
                            <div>{getStatusBadge(adj.status)}</div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(adj.createdAt).toLocaleString()}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 max-w-[260px]">
                            <div className="font-bold text-slate-900">{adj.itemName}</div>
                            <div className="text-[11px] font-semibold text-indigo-700">
                              {reasonMeta.label}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">
                              {adj.auditNote}
                            </div>
                            {adj.rejectionReason && (
                              <div className="text-[11px] text-rose-700 font-semibold mt-1">
                                Rejected: {adj.rejectionReason}
                              </div>
                            )}
                            {adj.reversesAdjustmentId && (
                              <div className="text-[10px] font-mono text-purple-700 mt-0.5">
                                Reverses {adj.reversesAdjustmentId}
                              </div>
                            )}
                            {adj.reversedByAdjustmentId && (
                              <div className="text-[10px] font-mono text-amber-700 mt-0.5">
                                Reversed by {adj.reversedByAdjustmentId}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-center font-mono font-black">
                            <span
                              className={
                                adj.deltaUnits < 0 ? 'text-rose-600' : 'text-emerald-600'
                              }
                            >
                              {adj.deltaUnits >= 0 ? `+${adj.deltaUnits}u` : `${adj.deltaUnits}u`}
                            </span>
                          </td>

                          <td className="py-3.5 px-3 text-center font-mono text-slate-800">
                            {adj.status === 'APPROVED' ? (
                              <span>
                                {adj.beforeTotalUnits ?? adj.submittedTotalUnits}u →{' '}
                                <strong>{adj.afterTotalUnits}u</strong>
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                {adj.submittedTotalUnits}u (unchanged)
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono font-bold">
                            <span
                              className={
                                adj.valuationImpactUsd < 0 ? 'text-rose-700' : 'text-emerald-700'
                              }
                            >
                              {adj.valuationImpactUsd >= 0 ? '+' : '-'}$
                              {Math.abs(adj.valuationImpactUsd).toFixed(2)}
                            </span>
                            {adj.shrinkageExpenseId && (
                              <div className="text-[10px] font-sans text-slate-500">
                                P&amp;L Shrinkage Logged
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-[11px] text-slate-600 space-y-0.5">
                            <div>
                              Maker: <strong className="text-slate-900">{adj.createdByName}</strong> (
                              {adj.createdByRole})
                            </div>
                            {adj.approvedByName && (
                              <div className="text-emerald-700">
                                Owner: <strong>{adj.approvedByName}</strong>
                              </div>
                            )}
                            {adj.rejectedByName && (
                              <div className="text-rose-700">
                                Rejected by: <strong>{adj.rejectedByName}</strong>
                              </div>
                            )}
                            {adj.evidencePhotoDataUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewPhotoUrl(adj.evidencePhotoDataUrl || null)}
                                className="text-indigo-700 underline font-semibold inline-flex items-center gap-1 mt-0.5"
                              >
                                <Camera className="w-3 h-3" /> View Photo
                              </button>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            {isOwner &&
                              adj.status === 'APPROVED' &&
                              !adj.reversedByAdjustmentId &&
                              adj.reasonCode !== 'REVERSAL' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReverseTarget(adj);
                                    setReverseNoteInput('');
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 inline-flex items-center gap-1 transition"
                                  title="Post an equal-and-opposite immutable reversal"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Reverse
                                </button>
                              )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ALL STOCK MOVEMENTS LEDGER */}
      {activeTab === 'MOVEMENTS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Movement ID, Reference, Note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Movement Types</option>
              <option value="GOODS_RECEIVED">Goods Received (GRN)</option>
              <option value="BREAK_CASE">Case Breaks</option>
              <option value="SALE">POS Sales</option>
              <option value="RETURN">Customer Returns</option>
              <option value="DAMAGE_LOSS">Damage / Spoilage</option>
              <option value="ADJUSTMENT">Manual / Stocktake Adjustments</option>
            </select>

            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Products / Items</option>
              {items.map((i, idx) => (
                <option key={`${i.itemId}-${idx}`} value={i.itemId}>
                  {i.itemId} — {i.itemName}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-600 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                    <th className="py-3 px-4">Log ID &amp; Time</th>
                    <th className="py-3 px-4">Item (ID &amp; Name)</th>
                    <th className="py-3 px-3">Movement Type</th>
                    <th className="py-3 px-3 text-center">Cases Δ</th>
                    <th className="py-3 px-3 text-center">Singles Δ</th>
                    <th className="py-3 px-3 text-center bg-slate-50/50">Resulting Balance</th>
                    <th className="py-3 px-3">Reference / Rule</th>
                    <th className="py-3 px-4">Reason &amp; Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                        No matching stock movement logs found.
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.slice(0, 300).map((mov, movIdx) => (
                      <tr
                        key={`${mov.movementId || mov.txnId || 'mov'}-${movIdx}`}
                        className="hover:bg-slate-50/75 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono">
                          <div className="text-xs font-bold text-slate-900">{mov.movementId}</div>
                          <div className="text-[11px] text-slate-500">{mov.timestamp}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900 text-xs">{mov.itemName}</div>
                          <div className="text-[11px] font-mono text-slate-400">{mov.itemId}</div>
                        </td>
                        <td className="py-3.5 px-3">
                          {getMovementBadge(mov.movementType, mov.triggerRule)}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono font-bold">
                          {mov.casesChange > 0 ? (
                            <span className="text-emerald-600">+{mov.casesChange} cs</span>
                          ) : mov.casesChange < 0 ? (
                            <span className="text-rose-600">{mov.casesChange} cs</span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono font-bold">
                          {mov.singlesChange > 0 ? (
                            <span className="text-emerald-600">+{mov.singlesChange} ea</span>
                          ) : mov.singlesChange < 0 ? (
                            <span className="text-rose-600">{mov.singlesChange} ea</span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-center bg-slate-50/50 font-mono">
                          <div className="text-xs font-bold text-slate-900">
                            {mov.resultingStockCases} cs / {mov.resultingStockSingles} ea
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-xs">
                          <div className="text-slate-700 font-semibold">
                            {mov.referenceId || '—'}
                          </div>
                          {mov.triggerRule && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded mt-0.5">
                              <Sparkles className="w-2.5 h-2.5" />
                              {mov.triggerRule}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          <div className="max-w-[220px] truncate" title={mov.reason}>
                            {mov.reason || '—'}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                            By {mov.staffName || mov.staffId || 'System'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / PREPARE STOCK ADJUSTMENT MODAL */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-xl w-full shadow-2xl border border-slate-200 space-y-4 my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                    {isOwner
                      ? 'Record Manual Stock Adjustment'
                      : 'Prepare Adjustment for Owner Approval'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {isOwner
                      ? 'Requires Owner PIN confirmation to post immediately, or submit to pending queue.'
                      : 'Live stock will NOT change until an Owner approves this request with PIN.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPending} className="space-y-4">
              {/* Product Search & Select */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800">
                  1. Select Product *
                </label>
                <input
                  type="text"
                  placeholder="Filter product by name, SKU, or ID..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <select
                  value={adjItemId}
                  onChange={(e) => handleSelectModalItem(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {modalFilteredItems.map((i, idx) => (
                    <option key={`${i.itemId}-${idx}`} value={i.itemId}>
                      {i.itemName} ({i.itemId}) — {resolveEffectiveTotalUnits(i)}u in stock ($
                      {resolveEffectiveUnitCost(i).toFixed(2)}/u)
                    </option>
                  ))}
                </select>
              </div>

              {/* Entry Mode Toggle */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1.5">
                  2. Entry Method *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEntryMode('PHYSICAL_COUNT')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      entryMode === 'PHYSICAL_COUNT'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Physical Shelf Count (Recommended)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode('DELTA')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      entryMode === 'DELTA'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    +/- Quantity Delta
                  </button>
                </div>
              </div>

              {/* Quantity Inputs */}
              {entryMode === 'PHYSICAL_COUNT' ? (
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                      Actual Counted Cases
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={countedCases}
                      onChange={(e) => setCountedCases(e.target.value)}
                      className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                      Actual Counted Singles
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={countedSingles}
                      onChange={(e) => setCountedSingles(e.target.value)}
                      className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDirection('SUBTRACT')}
                      className={`py-2 rounded-xl text-xs font-bold border transition ${
                        direction === 'SUBTRACT'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Subtract / Write-Off (-)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection('ADD')}
                      className={`py-2 rounded-xl text-xs font-bold border transition ${
                        direction === 'ADD'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Add / Surplus (+)
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                        Cases ({direction === 'SUBTRACT' ? '-' : '+'})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={deltaCases}
                        onChange={(e) => setDeltaCases(e.target.value)}
                        className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                        Singles ({direction === 'SUBTRACT' ? '-' : '+'})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={deltaSingles}
                        onChange={(e) => setDeltaSingles(e.target.value)}
                        className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Live Calculation & Anomaly Preview */}
              {previewCalc && (
                <div className="rounded-2xl p-3.5 bg-slate-900 text-white space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center font-mono">
                    <div>
                      <div className="text-[10px] font-sans uppercase text-slate-400">Current</div>
                      <div className="text-sm font-bold">{previewCalc.currentTotal}u</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans uppercase text-slate-400">Delta</div>
                      <div
                        className={`text-sm font-black ${
                          previewCalc.deltaUnits < 0
                            ? 'text-rose-400'
                            : previewCalc.deltaUnits > 0
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {previewCalc.deltaUnits >= 0
                          ? `+${previewCalc.deltaUnits}u`
                          : `${previewCalc.deltaUnits}u`}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans uppercase text-slate-400">
                        Projected
                      </div>
                      <div className="text-sm font-bold">{previewCalc.projectedTotal}u</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">
                      MWAC Cost: ${previewCalc.mwacUnitCost.toFixed(4)}/u
                    </span>
                    <span
                      className={`font-black ${
                        previewCalc.valuationImpactUsd < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      Impact: {previewCalc.valuationImpactUsd >= 0 ? '+' : '-'}$
                      {Math.abs(previewCalc.valuationImpactUsd).toFixed(2)}
                    </span>
                  </div>
                  {previewCalc.anomalyFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {previewCalc.anomalyFlags.map((flag) => (
                        <span
                          key={flag}
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-400/40"
                        >
                          {ANOMALY_LABELS[flag]?.label || flag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* GRV Bypass Warning for Manual Additions */}
              {effectiveDirection === 'ADD' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3 text-xs text-indigo-950 flex items-start justify-between gap-2">
                  <div>
                    <strong>Incoming supplier delivery?</strong> Do not use Manual Addition — use{' '}
                    <strong>Goods Received (GRV)</strong> so supplier payables and MWAC cost update properly.
                  </div>
                  {onTriggerGRN && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdjustModal(false);
                        onTriggerGRN();
                      }}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold text-[11px]"
                    >
                      Open GRV
                    </button>
                  )}
                </div>
              )}

              {/* Structured Reason Code */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                  3. Structured Reason Code *
                </label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value as StockAdjustmentReasonCode)}
                  className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {validReasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mandatory Detailed Audit Note */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    4. Mandatory Audit Explanation *
                  </label>
                  <span
                    className={`text-[11px] font-mono font-bold ${
                      auditNote.trim().length >= STOCK_ADJUSTMENT_MIN_NOTE_LENGTH
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                    }`}
                  >
                    {auditNote.trim().length}/{STOCK_ADJUSTMENT_MIN_NOTE_LENGTH} min chars
                  </span>
                </div>
                <textarea
                  rows={2}
                  required
                  placeholder="Describe exact cause, batch/expiry date, shelf location, or witness name..."
                  value={auditNote}
                  onChange={(e) => setAuditNote(e.target.value)}
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              {/* Evidence Photo Upload / Camera Capture */}
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-slate-600" />
                    Photo Evidence{' '}
                    {previewCalc &&
                    Math.abs(previewCalc.valuationImpactUsd) >=
                      STOCK_ADJUSTMENT_PHOTO_RECOMMENDED_USD
                      ? '(Recommended for write-offs ≥ $10)'
                      : '(Optional)'}
                  </span>
                  {evidencePhoto && (
                    <button
                      type="button"
                      onClick={() => setEvidencePhoto('')}
                      className="text-[11px] font-bold text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {evidencePhoto ? (
                  <img
                    src={evidencePhoto}
                    alt="Attachment preview"
                    className="h-28 w-auto rounded-xl border border-slate-300 object-cover"
                  />
                ) : (
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{photoBusy ? 'Compressing...' : 'Take / Attach Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {formError && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black shadow-sm transition"
                >
                  Submit for Owner Approval
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={handleOwnerDirectPostClick}
                    className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black shadow-md transition flex items-center justify-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Post Now (Owner PIN)</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT REASON MODAL */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              Reject Adjustment {rejectTarget.id}
            </h3>
            <p className="text-xs text-slate-600">
              Live stock for <strong>{rejectTarget.itemName}</strong> will remain untouched. Enter
              a rejection reason (min 5 characters), then confirm with your Owner PIN.
            </p>
            <textarea
              rows={3}
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              placeholder="e.g. Recount shelf with manager before writing off stock..."
              className="w-full p-3 border border-slate-300 rounded-xl text-xs font-semibold text-slate-950"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectReasonInput.trim().length < 5}
                onClick={() =>
                  setPinFlow({
                    kind: 'REJECT',
                    adjustment: rejectTarget,
                    rejectionReason: rejectReasonInput.trim(),
                  })
                }
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                Continue to Owner PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMMUTABLE REVERSAL MODAL */}
      {reverseTarget && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              Reverse Approved Adjustment {reverseTarget.id}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Approved adjustments are immutable and cannot be deleted. Reversing will post an
              equal-and-opposite adjustment of{' '}
              <strong className="font-mono">
                {reverseTarget.deltaUnits < 0
                  ? `+${Math.abs(reverseTarget.deltaUnits)}u`
                  : `-${Math.abs(reverseTarget.deltaUnits)}u`}
              </strong>{' '}
              for <strong>{reverseTarget.itemName}</strong> and sync to all devices.
            </p>
            <textarea
              rows={3}
              value={reverseNoteInput}
              onChange={(e) => setReverseNoteInput(e.target.value)}
              placeholder={`Explain why ${reverseTarget.id} is being reversed (min ${STOCK_ADJUSTMENT_MIN_NOTE_LENGTH} chars)...`}
              className="w-full p-3 border border-slate-300 rounded-xl text-xs font-semibold text-slate-950"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reverseNoteInput.trim().length < STOCK_ADJUSTMENT_MIN_NOTE_LENGTH}
                onClick={() =>
                  setPinFlow({
                    kind: 'REVERSE',
                    adjustment: reverseTarget,
                    reversalNote: reverseNoteInput.trim(),
                  })
                }
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50"
              >
                Confirm Reversal with Owner PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHOTO LIGHTBOX MODAL */}
      {previewPhotoUrl && (
        <div
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewPhotoUrl(null)}
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-lg font-bold"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={previewPhotoUrl}
              alt="Stock Adjustment Evidence"
              className="w-full max-h-[80vh] object-contain rounded-2xl bg-black"
            />
          </div>
        </div>
      )}

      {/* OWNER-ONLY PIN VERIFICATION MODAL */}
      <ManagerPinModal
        isOpen={Boolean(pinFlow)}
        onClose={() => setPinFlow(null)}
        ownerOnly
        actionType="APPROVAL"
        reasonRequired={false}
        currentStaff={currentUser}
        title={
          pinFlow?.kind === 'APPROVE'
            ? 'Owner Approval Required'
            : pinFlow?.kind === 'REJECT'
            ? 'Confirm Rejection (Owner PIN)'
            : pinFlow?.kind === 'REVERSE'
            ? 'Confirm Reversal (Owner PIN)'
            : 'Confirm Stock Adjustment (Owner PIN)'
        }
        subtitle="Only Owner / Administrator PIN can authorize manual inventory changes"
        actionDescription={
          pinFlow?.kind === 'APPROVE'
            ? `Approve ${pinFlow.adjustment.id}: ${pinFlow.adjustment.itemName} (${pinFlow.adjustment.deltaUnits >= 0 ? '+' : ''}${pinFlow.adjustment.deltaUnits}u) prepared by ${pinFlow.adjustment.createdByName}.`
            : pinFlow?.kind === 'REJECT'
            ? `Reject ${pinFlow.adjustment.id} (${pinFlow.adjustment.itemName}): "${pinFlow.rejectionReason}"`
            : pinFlow?.kind === 'REVERSE'
            ? `Reverse approved adjustment ${pinFlow.adjustment.id} for ${pinFlow.adjustment.itemName}.`
            : `Post manual stock adjustment for ${selectedItem?.itemName || ''} (${previewCalc ? (previewCalc.deltaUnits >= 0 ? `+${previewCalc.deltaUnits}u` : `${previewCalc.deltaUnits}u`) : ''}).`
        }
        amount={
          pinFlow?.kind === 'APPROVE' || pinFlow?.kind === 'REJECT' || pinFlow?.kind === 'REVERSE'
            ? Math.abs(pinFlow.adjustment.valuationImpactUsd)
            : previewCalc
            ? Math.abs(previewCalc.valuationImpactUsd)
            : undefined
        }
        onAuthorize={handlePinAuthorized}
      />
    </div>
  );
};
