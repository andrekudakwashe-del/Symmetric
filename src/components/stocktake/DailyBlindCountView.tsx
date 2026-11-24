import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  EyeOff,
  FileText,
  Filter,
  Lock,
  MessageSquare,
  Package,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import {
  DailyBlindBranchConfig,
  DailyBlindCountLine,
  DailyBlindCountRecord,
  InventoryItem,
  Salesperson,
  StocktakeVarianceReasonCode,
} from '../../types';
import {
  archiveDailyBlindCount,
  captureDailyBlindItemFreeze,
  getCurrentBranchId,
  getCurrentCompanyId,
  getDailyBlindBranchConfig,
  getDailyBlindCounts,
  getInventoryItems,
  getSalespeople,
  isStaffAssignedToBranch,
  requestDailyBlindExplanations,
  resolveDailyBlindTargetItems,
  saveDailyBlindBranchConfig,
  submitDailyBlindCount,
  submitDailyBlindStaffExplanations,
} from '../../db/roomDatabase';
import { isDailyBlindDesignatedAuditor } from '../../services/stocktakeAccessService';

interface DailyBlindCountViewProps {
  currentUser: Salesperson | null;
  branchId?: string;
}

type DailyBlindSubTab = 'COUNT_FLOOR' | 'MY_EXPLANATIONS' | 'RESULTS_ARCHIVE' | 'CONFIG';

interface FrozenLineSnapshot {
  frozenSystemCases: number;
  frozenSystemSingles: number;
  frozenSystemUnits: number;
  unitCost: number;
  frozenTimestamp: string;
}

interface FloorLineDraft {
  cases: string;
  singles: string;
  confirmed: boolean;
  frozenSnapshot?: FrozenLineSnapshot;
}

const REASON_CODE_OPTIONS: { code: StocktakeVarianceReasonCode; label: string }[] = [
  { code: 'THEFT_SHRINKAGE', label: 'Theft / Suspected Shrinkage' },
  { code: 'DAMAGED_EXPIRED', label: 'Damaged / Spoiled / Expired' },
  { code: 'GRN_RECEIVING_ERROR', label: 'GRN / Delivery Receiving Error' },
  { code: 'CASHIER_SKU_SWAP', label: 'Cashier Barcode / SKU Swap' },
  { code: 'UNRECORDED_SHOP_USE', label: 'Unrecorded Shop Use / Tasting' },
  { code: 'PREVIOUS_COUNT_ERROR', label: 'Previous Count Miscount' },
  { code: 'SUPPLIER_SHORT_DELIVERY', label: 'Supplier Short Delivery' },
  { code: 'OTHER', label: 'Other (Specify Below)' },
];

const formatTimeOnly = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatReasonLabel = (code?: string): string => {
  if (!code) return '—';
  return REASON_CODE_OPTIONS.find((r) => r.code === code)?.label || code.replace(/_/g, ' ');
};

export const DailyBlindCountView: React.FC<DailyBlindCountViewProps> = ({
  currentUser,
  branchId,
}) => {
  const activeBranchId = branchId || currentUser?.branchId || currentUser?.branch_id || getCurrentBranchId();
  const activeCompanyId = getCurrentCompanyId();

  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live refresh whenever local/mesh/cloud updates arrive
  useEffect(() => {
    const onUpdated = () => setRefreshTick((t) => t + 1);
    window.addEventListener('saimetric_daily_blind_updated', onUpdated);
    window.addEventListener('saimetric_inventory_updated', onUpdated);
    window.addEventListener('saimetric_sales_updated', onUpdated);
    return () => {
      window.removeEventListener('saimetric_daily_blind_updated', onUpdated);
      window.removeEventListener('saimetric_inventory_updated', onUpdated);
      window.removeEventListener('saimetric_sales_updated', onUpdated);
    };
  }, []);

  const resolvedTargets = useMemo(
    () => resolveDailyBlindTargetItems(activeBranchId, activeCompanyId),
    [activeBranchId, activeCompanyId, refreshTick]
  );

  const branchConfig: DailyBlindBranchConfig | null = useMemo(
    () => getDailyBlindBranchConfig(activeBranchId, activeCompanyId),
    [activeBranchId, activeCompanyId, refreshTick]
  );

  const isAuditor = useMemo(
    () => isDailyBlindDesignatedAuditor(currentUser, branchConfig),
    [currentUser, branchConfig]
  );

  const allBranchCounts = useMemo(
    () => getDailyBlindCounts(activeBranchId, activeCompanyId),
    [activeBranchId, activeCompanyId, refreshTick]
  );

  // Counts flagged specifically for the currently logged-in staff member to explain (optional auditor request)
  const myPendingExplanationCounts = useMemo(() => {
    if (!currentUser?.id) return [];
    const myId = String(currentUser.id).trim().toUpperCase();
    return allBranchCounts.filter(
      (rec) =>
        rec.status !== 'ARCHIVED' &&
        String(rec.countedById || '').trim().toUpperCase() === myId &&
        rec.lines.some((l) => l.explanationRequested && !l.explainedAt)
    );
  }, [allBranchCounts, currentUser?.id]);

  const myPendingFlaggedLinesCount = useMemo(
    () =>
      myPendingExplanationCounts.reduce(
        (sum, rec) => sum + rec.lines.filter((l) => l.explanationRequested && !l.explainedAt).length,
        0
      ),
    [myPendingExplanationCounts]
  );

  const pendingAuditorReviewCount = useMemo(
    () => allBranchCounts.filter((r) => r.status !== 'ARCHIVED').length,
    [allBranchCounts]
  );

  const [activeSubTab, setActiveSubTab] = useState<DailyBlindSubTab>('COUNT_FLOOR');

  // Guard: never leave a non-auditor on auditor-only tabs if config/user changes
  useEffect(() => {
    if (!isAuditor && (activeSubTab === 'RESULTS_ARCHIVE' || activeSubTab === 'CONFIG')) {
      setActiveSubTab('COUNT_FLOOR');
    }
  }, [isAuditor, activeSubTab]);

  // ============================================================================
  // TAB 1: COUNT FLOOR STATE (BLIND — ZERO SOH/COST/VARIANCE)
  // ============================================================================
  const [floorDrafts, setFloorDrafts] = useState<Record<string, FloorLineDraft>>({});
  const [floorSearch, setFloorSearch] = useState('');
  const [lastBlindReceipt, setLastBlindReceipt] = useState<{
    id: string;
    submittedAt: string;
    itemsCounted: number;
    listSource: 'MANAGER_LIST' | 'AUTO_TOP_10';
  } | null>(null);

  const filteredTargetItems = useMemo(() => {
    const q = floorSearch.trim().toLowerCase();
    if (!q) return resolvedTargets.items;
    return resolvedTargets.items.filter(
      (it) =>
        String(it.itemName || '').toLowerCase().includes(q) ||
        String(it.sku || '').toLowerCase().includes(q) ||
        String(it.barcode || '').toLowerCase().includes(q) ||
        String(it.category || '').toLowerCase().includes(q)
    );
  }, [resolvedTargets.items, floorSearch]);

  const updateFloorDraft = (itemId: string, patch: Partial<FloorLineDraft>) => {
    setFloorDrafts((prev) => {
      const existing = prev[itemId] || { cases: '', singles: '', confirmed: false };
      return {
        ...prev,
        [itemId]: {
          ...existing,
          ...patch,
          // Editing quantities unlocks prior confirmation so SOH re-freezes on re-confirm
          ...(patch.cases !== undefined || patch.singles !== undefined
            ? { confirmed: false, frozenSnapshot: undefined }
            : {}),
        },
      };
    });
  };

  const handleConfirmFreezeItem = (item: InventoryItem) => {
    setErrorMsg(null);
    const existing = floorDrafts[item.itemId] || { cases: '', singles: '', confirmed: false };
    const snap = captureDailyBlindItemFreeze(item.itemId, activeBranchId, activeCompanyId);
    const frozenSnapshot: FrozenLineSnapshot = snap || {
      frozenSystemCases: Number(item.stockCases || 0),
      frozenSystemSingles: Number(item.stockSingles || 0),
      frozenSystemUnits:
        item.totalUnits !== undefined && item.totalUnits !== null
          ? Number(item.totalUnits)
          : Number(item.stockCases || 0) * Math.max(1, Number(item.unitsPerCase || 1)) +
            Number(item.stockSingles || 0),
      unitCost: Number(item.costPriceUnit || 0),
      frozenTimestamp: new Date().toISOString(),
    };

    setFloorDrafts((prev) => ({
      ...prev,
      [item.itemId]: {
        cases: existing.cases === '' ? '0' : existing.cases,
        singles: existing.singles === '' ? '0' : existing.singles,
        confirmed: true,
        frozenSnapshot,
      },
    }));
  };

  const confirmedCount = useMemo(
    () =>
      resolvedTargets.items.filter((it) => Boolean(floorDrafts[it.itemId]?.confirmed)).length,
    [resolvedTargets.items, floorDrafts]
  );

  const enteredCount = useMemo(
    () =>
      resolvedTargets.items.filter((it) => {
        const d = floorDrafts[it.itemId];
        return Boolean(d && (d.confirmed || d.cases !== '' || d.singles !== ''));
      }).length,
    [resolvedTargets.items, floorDrafts]
  );

  const handleSubmitBlindCount = () => {
    setErrorMsg(null);
    setNotice(null);
    if (!currentUser) {
      setErrorMsg('You must be signed in to submit a Daily Blind Count.');
      return;
    }

    const entries = resolvedTargets.items
      .map((item) => {
        const draft = floorDrafts[item.itemId];
        if (!draft || (!draft.confirmed && draft.cases === '' && draft.singles === '')) {
          return null;
        }
        return {
          item,
          countedCases: Math.max(0, Math.floor(Number(draft.cases || 0))),
          countedSingles: Math.max(0, Math.floor(Number(draft.singles || 0))),
          frozenSnapshot: draft.frozenSnapshot,
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    if (entries.length === 0) {
      setErrorMsg('Enter and confirm at least one product count before submitting.');
      return;
    }

    const saved = submitDailyBlindCount({
      entries,
      listSource: resolvedTargets.source,
      counter: {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
      },
      branchId: activeBranchId,
      companyId: activeCompanyId,
    });

    setFloorDrafts({});
    setLastBlindReceipt({
      id: saved.id,
      submittedAt: saved.submittedAt,
      itemsCounted: saved.totalItemsCounted,
      listSource: saved.listSource,
    });
    setRefreshTick((t) => t + 1);
    setNotice(
      `Blind count ${saved.id} submitted (${saved.totalItemsCounted} item${saved.totalItemsCounted === 1 ? '' : 's'}). Results are locked for the Designated Auditor.`
    );
  };

  // ============================================================================
  // TAB 2: MY EXPLANATIONS STATE (STAFF ONLY SEES FLAGGED ITEMS)
  // ============================================================================
  const [staffAnswers, setStaffAnswers] = useState<
    Record<string, { reasonCode: StocktakeVarianceReasonCode; staffExplanation: string }>
  >({});

  const getAnswerKey = (recordId: string, itemId: string) => `${recordId}::${itemId}`;

  const handleSubmitStaffExplanationForRecord = (record: DailyBlindCountRecord) => {
    if (!currentUser) return;
    setErrorMsg(null);
    const flagged = record.lines.filter((l) => l.explanationRequested && !l.explainedAt);
    const answers = flagged
      .map((line) => {
        const ans = staffAnswers[getAnswerKey(record.id, line.itemId)];
        if (!ans || !ans.reasonCode) return null;
        return {
          itemId: line.itemId,
          reasonCode: ans.reasonCode,
          staffExplanation: ans.staffExplanation || '',
        };
      })
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    if (answers.length === 0) {
      setErrorMsg('Select a reason code for at least one flagged item before submitting.');
      return;
    }

    submitDailyBlindStaffExplanations(record.id, answers, {
      id: currentUser.id,
      name: currentUser.name,
    });
    setRefreshTick((t) => t + 1);
    setNotice(`Explanation submitted for count ${record.id} and sent back to the Designated Auditor.`);
  };

  // ============================================================================
  // TAB 3: DESIGNATED AUDITOR RESULTS & PERMANENT ARCHIVE
  // ============================================================================
  const [archiveViewMode, setArchiveViewMode] = useState<'PENDING' | 'ARCHIVED' | 'ALL'>('PENDING');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [openPromptLineKey, setOpenPromptLineKey] = useState<string | null>(null);
  const [summaryNoteDrafts, setSummaryNoteDrafts] = useState<Record<string, string>>({});

  const filteredAuditorCounts = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    return allBranchCounts.filter((rec) => {
      if (archiveViewMode === 'PENDING' && rec.status === 'ARCHIVED') return false;
      if (archiveViewMode === 'ARCHIVED' && rec.status !== 'ARCHIVED') return false;
      if (dateFrom && rec.date < dateFrom) return false;
      if (dateTo && rec.date > dateTo) return false;
      if (q) {
        const matchesHeader =
          String(rec.id || '').toLowerCase().includes(q) ||
          String(rec.countedByName || '').toLowerCase().includes(q) ||
          String(rec.date || '').toLowerCase().includes(q) ||
          String(rec.auditorSummaryNote || '').toLowerCase().includes(q);
        const matchesLine = (rec.lines || []).some(
          (l) =>
            String(l.itemName || '').toLowerCase().includes(q) ||
            String(l.sku || '').toLowerCase().includes(q) ||
            String(l.barcode || '').toLowerCase().includes(q)
        );
        if (!matchesHeader && !matchesLine) return false;
      }
      return true;
    });
  }, [allBranchCounts, archiveViewMode, archiveSearch, dateFrom, dateTo]);

  const handleRequestLineExplanation = (recordId: string, line: DailyBlindCountLine) => {
    if (!currentUser || !isAuditor) return;
    const key = getAnswerKey(recordId, line.itemId);
    const promptText = promptDrafts[key] || 'Please explain the variance observed on this product.';
    requestDailyBlindExplanations(
      recordId,
      [{ itemId: line.itemId, prompt: promptText }],
      { id: currentUser.id, name: currentUser.name }
    );
    setOpenPromptLineKey(null);
    setRefreshTick((t) => t + 1);
    setNotice(`Optional explanation request sent to counter for "${line.itemName}".`);
  };

  const handleArchiveRecord = (record: DailyBlindCountRecord) => {
    if (!currentUser || !isAuditor) return;
    const note = summaryNoteDrafts[record.id];
    archiveDailyBlindCount(
      record.id,
      { id: currentUser.id, name: currentUser.name },
      note
    );
    setRefreshTick((t) => t + 1);
    setNotice(`Count ${record.id} reviewed and permanently archived (Report-Only — no stock adjusted).`);
  };

  const handleExportCsv = () => {
    if (!isAuditor || filteredAuditorCounts.length === 0) return;
    const headers = [
      'CountID',
      'Date',
      'SubmittedAt',
      'Branch',
      'Counter',
      'ListSource',
      'Status',
      'Product',
      'SKU',
      'CountedCases',
      'CountedSingles',
      'CountedUnits',
      'FrozenSystemUnits',
      'FrozenTimestamp',
      'VarianceUnits',
      'UnitCost',
      'VarianceCostValue',
      'ExplanationRequested',
      'ReasonCode',
      'StaffExplanation',
      'ReviewedBy',
      'ArchivedAt',
      'AuditorNote',
    ];

    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows: string[] = [headers.join(',')];
    for (const rec of filteredAuditorCounts) {
      for (const l of rec.lines || []) {
        rows.push(
          [
            rec.id,
            rec.date,
            rec.submittedAt,
            rec.branchName,
            rec.countedByName,
            rec.listSource,
            rec.status,
            l.itemName,
            l.sku || '',
            l.countedCases,
            l.countedSingles,
            l.countedTotalUnits,
            l.frozenSystemUnits,
            l.frozenTimestamp,
            l.varianceUnits,
            l.unitCost,
            l.varianceCostValue,
            l.explanationRequested ? 'YES' : 'NO',
            l.reasonCode || '',
            l.staffExplanation || '',
            rec.reviewedByName || '',
            rec.archivedAt || '',
            rec.auditorSummaryNote || '',
          ]
            .map(escapeCsv)
            .join(',')
        );
      }
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-blind-counts-${activeBranchId}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ============================================================================
  // TAB 4: LIST & DESIGNATED AUDITOR CONFIGURATION (AUDITOR / MANAGER ONLY)
  // ============================================================================
  const branchInventory = useMemo(
    () =>
      getInventoryItems()
        .filter((it) => it && !it.isDeleted && it.itemId)
        .sort((a, b) => String(a.itemName || '').localeCompare(String(b.itemName || ''))),
    [activeBranchId, refreshTick]
  );

  const branchStaffCandidates = useMemo(
    () =>
      getSalespeople().filter(
        (s) => s && s.active !== 'N' && !s.isCasual && !s.isVisitingCounter && isStaffAssignedToBranch(s, activeBranchId)
      ),
    [activeBranchId, refreshTick]
  );

  const [configSelectedIds, setConfigSelectedIds] = useState<string[]>(() => branchConfig?.selectedItemIds || []);
  const [configAuditorId, setConfigAuditorId] = useState<string>(() => branchConfig?.designatedAuditorId || '');
  const [configSearch, setConfigSearch] = useState('');

  useEffect(() => {
    setConfigSelectedIds(branchConfig?.selectedItemIds || []);
    setConfigAuditorId(branchConfig?.designatedAuditorId || '');
  }, [branchConfig?.id, branchConfig?.updatedAt]);

  const filteredConfigInventory = useMemo(() => {
    const q = configSearch.trim().toLowerCase();
    if (!q) return branchInventory;
    return branchInventory.filter(
      (it) =>
        String(it.itemName || '').toLowerCase().includes(q) ||
        String(it.sku || '').toLowerCase().includes(q) ||
        String(it.barcode || '').toLowerCase().includes(q) ||
        String(it.category || '').toLowerCase().includes(q)
    );
  }, [branchInventory, configSearch]);

  const toggleConfigItem = (itemId: string) => {
    setConfigSelectedIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleSaveConfig = (overrideSelectedIds?: string[]) => {
    if (!currentUser || !isAuditor) return;
    const idsToSave = overrideSelectedIds !== undefined ? overrideSelectedIds : configSelectedIds;
    const pickedStaff = branchStaffCandidates.find((s) => s.id === configAuditorId);

    saveDailyBlindBranchConfig({
      company_id: activeCompanyId,
      branch_id: activeBranchId,
      selectedItemIds: idsToSave,
      designatedAuditorId: configAuditorId || '',
      designatedAuditorName: pickedStaff?.name || '',
      updatedBy: currentUser.id,
      updatedByName: currentUser.name,
    });

    if (overrideSelectedIds !== undefined) {
      setConfigSelectedIds(overrideSelectedIds);
    }
    setRefreshTick((t) => t + 1);
    setNotice(
      idsToSave.length > 0
        ? `Saved ${idsToSave.length} product(s) to the Daily Blind Count list and synced to branch devices.`
        : 'Cleared custom list — branch will automatically use the Top 10 Fastest-Moving Products.'
    );
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  const statusBadge = (status: DailyBlindCountRecord['status']) => {
    switch (status) {
      case 'ARCHIVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
            <Archive className="w-3 h-3" /> Archived
          </span>
        );
      case 'EXPLANATION_REQUESTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-700">
            <MessageSquare className="w-3 h-3" /> Awaiting Staff Note
          </span>
        );
      case 'EXPLANATION_SUBMITTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-950 text-blue-300 border border-blue-700">
            <CheckCircle2 className="w-3 h-3" /> Explanation Received
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-600">
            <Clock className="w-3 h-3" /> Pending Review
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Banner & Governance Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-800 text-[11px] font-bold">
              <EyeOff className="w-3.5 h-3.5" /> Blind Real-Time Count
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-blue-950/90 text-blue-300 border border-blue-800 text-[11px] font-bold">
              <FileText className="w-3.5 h-3.5" /> Report-Only • No Direct Stock Adjustment
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold">
              {resolvedTargets.source === 'MANAGER_LIST'
                ? `Manager List (${resolvedTargets.items.length} SKUs)`
                : `Auto Top 10 Fast Movers (${resolvedTargets.items.length} SKUs)`}
            </span>
          </div>
          <h2 className="text-lg font-bold text-white">Daily Blind Counts</h2>
          <p className="text-xs text-slate-400">
            Any floor staff member can perform quick blind counts while tills continue trading. Live SOH freezes at the exact instant each item is confirmed. Only the Designated Auditor can view results and archive reports.
          </p>
        </div>

        {/* Sub-navigation tabs (Strictly Role-Gated) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('COUNT_FLOOR')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
              activeSubTab === 'COUNT_FLOOR'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Count Floor
          </button>

          {myPendingFlaggedLinesCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveSubTab('MY_EXPLANATIONS')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                activeSubTab === 'MY_EXPLANATIONS'
                  ? 'bg-amber-600 text-white border-amber-500 shadow-lg'
                  : 'bg-amber-950/70 text-amber-200 border-amber-700 hover:bg-amber-900/70'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              My Explanations ({myPendingFlaggedLinesCount})
            </button>
          )}

          {isAuditor && (
            <>
              <button
                type="button"
                onClick={() => setActiveSubTab('RESULTS_ARCHIVE')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                  activeSubTab === 'RESULTS_ARCHIVE'
                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-950/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                }`}
              >
                <Archive className="w-4 h-4" />
                Results & Archive
                {pendingAuditorReviewCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded bg-blue-950 text-blue-200 text-[10px] font-mono">
                    {pendingAuditorReviewCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('CONFIG')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                  activeSubTab === 'CONFIG'
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                }`}
              >
                <Settings2 className="w-4 h-4" />
                List & Auditor Setup
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notices */}
      {notice && (
        <div className="bg-emerald-950/70 border border-emerald-700 text-emerald-100 rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-950/70 border border-rose-700 text-rose-100 rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            {errorMsg}
          </span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-rose-300 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          TAB 1: COUNT FLOOR (VISIBLE TO ALL STAFF — STRICTLY BLIND)
      ==================================================================== */}
      {activeSubTab === 'COUNT_FLOOR' && (
        <div className="space-y-4">
          {lastBlindReceipt && (
            <div className="bg-emerald-950/40 border border-emerald-700/70 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-emerald-200">
                    Blind Count Receipt • {lastBlindReceipt.id}
                  </div>
                  <p className="text-xs text-emerald-100/80">
                    Submitted at {formatDateTime(lastBlindReceipt.submittedAt)} • {lastBlindReceipt.itemsCounted}{' '}
                    product(s) recorded with real-time frozen SOH. Results are locked for the Designated Auditor.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLastBlindReceipt(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300"
              >
                Hide Receipt
              </button>
            </div>
          )}

          {/* Floor Toolbar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={floorSearch}
                onChange={(e) => setFloorSearch(e.target.value)}
                placeholder="Filter count list by product name, SKU, or barcode..."
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-400">
                Confirmed & Frozen:{' '}
                <strong className="text-emerald-400 font-mono">
                  {confirmedCount}/{resolvedTargets.items.length}
                </strong>
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">
                Ready to Submit:{' '}
                <strong className="text-white font-mono">{enteredCount}</strong>
              </span>
              <button
                type="button"
                onClick={handleSubmitBlindCount}
                disabled={enteredCount === 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Submit Blind Count ({enteredCount})
              </button>
            </div>
          </div>

          {/* Blind Product Cards */}
          {filteredTargetItems.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
              <Package className="w-9 h-9 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">
                No products available in this branch's Inventory Master yet.
              </div>
              <p className="text-xs text-slate-500">
                Once products exist in Inventory Master, Daily Blind Counts automatically loads the Manager's selected list or the Top 10 fastest-moving items.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredTargetItems.map((item) => {
                const draft = floorDrafts[item.itemId] || { cases: '', singles: '', confirmed: false };
                const upc = Math.max(1, Number(item.unitsPerCase || 1));
                const showCases = upc > 1;
                const totalEntered =
                  Math.max(0, Math.floor(Number(draft.cases || 0))) * upc +
                  Math.max(0, Math.floor(Number(draft.singles || 0)));

                return (
                  <div
                    key={item.itemId}
                    className={`rounded-2xl p-4 border transition ${
                      draft.confirmed
                        ? 'bg-emerald-950/25 border-emerald-700/70'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{item.itemName}</div>
                        <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                          {item.sku && <span className="font-mono text-slate-300">SKU: {item.sku}</span>}
                          {item.barcode && <span className="font-mono text-slate-500">• {item.barcode}</span>}
                          <span>• {upc} unit{upc === 1 ? '' : 's'}/case</span>
                        </div>
                      </div>
                      {draft.confirmed && draft.frozenSnapshot ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold">
                          <Lock className="w-3 h-3" /> Frozen {formatTimeOnly(draft.frozenSnapshot.frozenTimestamp)}
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 text-[10px] font-semibold">
                          <EyeOff className="w-3 h-3" /> Blind
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-end gap-2.5">
                      {showCases && (
                        <div className="w-24">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            Cases
                          </label>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={draft.cases}
                            onChange={(e) => updateFloorDraft(item.itemId, { cases: e.target.value })}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      )}

                      <div className="w-28">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {showCases ? 'Singles / Loose' : 'Total Units'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={draft.singles}
                          onChange={(e) => updateFloorDraft(item.itemId, { singles: e.target.value })}
                          placeholder="0"
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="flex-1 flex items-center justify-between gap-2 min-w-[140px]">
                        <div className="text-[11px] text-slate-400">
                          Counted:{' '}
                          <span className="font-mono font-bold text-white">{totalEntered}</span> u
                        </div>
                        <button
                          type="button"
                          onClick={() => handleConfirmFreezeItem(item)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                            draft.confirmed
                              ? 'bg-emerald-900/60 text-emerald-200 border-emerald-600'
                              : 'bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white border-slate-700 hover:border-emerald-500'
                          }`}
                          title="Lock in your count and freeze live system SOH at this exact second"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {draft.confirmed ? 'Re-Freeze' : 'Confirm & Freeze'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 2: MY EXPLANATIONS (STAFF ONLY SEES ITEMS FLAGGED BY AUDITOR)
      ==================================================================== */}
      {activeSubTab === 'MY_EXPLANATIONS' && (
        <div className="space-y-4">
          {myPendingExplanationCounts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" />
              <div className="text-sm font-bold text-white">No Pending Explanations</div>
              <p className="text-xs text-slate-400">
                You have no variance items waiting for your explanation.
              </p>
            </div>
          ) : (
            myPendingExplanationCounts.map((rec) => {
              const flaggedLines = rec.lines.filter((l) => l.explanationRequested && !l.explainedAt);
              return (
                <div
                  key={rec.id}
                  className="bg-slate-900 border border-amber-700/60 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Explanation Requested • {rec.id}
                      </div>
                      <div className="text-xs text-slate-400">
                        Count submitted on {formatDateTime(rec.submittedAt)} • Showing only the{' '}
                        {flaggedLines.length} item(s) requested by the Designated Auditor
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSubmitStaffExplanationForRecord(rec)}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Submit Explanation
                    </button>
                  </div>

                  <div className="space-y-3">
                    {flaggedLines.map((line) => {
                      const k = getAnswerKey(rec.id, line.itemId);
                      const ans = staffAnswers[k] || { reasonCode: 'OTHER' as StocktakeVarianceReasonCode, staffExplanation: '' };
                      return (
                        <div
                          key={line.itemId}
                          className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-bold text-white">{line.itemName}</div>
                              <div className="text-[11px] text-slate-400">
                                Your Count: <strong className="text-slate-200 font-mono">{line.countedTotalUnits}</strong> unit(s) •
                                Frozen at {formatTimeOnly(line.frozenTimestamp)}
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-amber-300 bg-amber-950/70 border border-amber-800 px-2.5 py-0.5 rounded">
                              Auditor Question
                            </span>
                          </div>

                          <div className="text-xs text-amber-100 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">
                            <strong>{line.explanationRequestedByName || 'Designated Auditor'}:</strong>{' '}
                            {line.auditorPrompt || 'Please explain this variance.'}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Reason Code
                              </label>
                              <select
                                value={ans.reasonCode}
                                onChange={(e) =>
                                  setStaffAnswers((prev) => ({
                                    ...prev,
                                    [k]: { ...ans, reasonCode: e.target.value as StocktakeVarianceReasonCode },
                                  }))
                                }
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                              >
                                {REASON_CODE_OPTIONS.map((opt) => (
                                  <option key={opt.code} value={opt.code}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Your Explanation Note
                              </label>
                              <input
                                type="text"
                                value={ans.staffExplanation}
                                onChange={(e) =>
                                  setStaffAnswers((prev) => ({
                                    ...prev,
                                    [k]: { ...ans, staffExplanation: e.target.value },
                                  }))
                                }
                                placeholder="Briefly explain what happened on the floor..."
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 3: RESULTS & PERMANENT ARCHIVE (DESIGNATED AUDITOR ONLY)
      ==================================================================== */}
      {activeSubTab === 'RESULTS_ARCHIVE' && isAuditor && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                {(['PENDING', 'ARCHIVED', 'ALL'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setArchiveViewMode(mode)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      archiveViewMode === mode
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'PENDING'
                      ? `Pending Review (${pendingAuditorReviewCount})`
                      : mode === 'ARCHIVED'
                      ? `Archived (${allBranchCounts.length - pendingAuditorReviewCount})`
                      : `All (${allBranchCounts.length})`}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredAuditorCounts.length === 0}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV ({filteredAuditorCounts.length})
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
              <div className="md:col-span-2 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  placeholder="Search by counter name, product, SKU, count ID, or note..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 shrink-0">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 shrink-0">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Count Reports List */}
          {filteredAuditorCounts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
              <Filter className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">
                No Daily Blind Count reports match your filter.
              </div>
              <p className="text-xs text-slate-500">
                Submitted counts appear here immediately for review and permanent archiving.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAuditorCounts.map((rec) => {
                const isExpanded = expandedRecordId === rec.id;
                const isArchived = rec.status === 'ARCHIVED';
                return (
                  <div
                    key={rec.id}
                    className={`bg-slate-900 border rounded-2xl overflow-hidden transition ${
                      isArchived ? 'border-slate-800' : 'border-blue-800/60'
                    }`}
                  >
                    {/* Report Header Row */}
                    <button
                      type="button"
                      onClick={() => setExpandedRecordId(isExpanded ? null : rec.id)}
                      className="w-full text-left p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-800/40 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-300">{rec.id}</span>
                          {statusBadge(rec.status)}
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {rec.listSource === 'MANAGER_LIST' ? 'Manager List' : 'Auto Top 10'}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                            Report-Only
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{rec.countedByName}</span>
                          <span className="text-slate-500">•</span>
                          <span>{formatDateTime(rec.submittedAt)}</span>
                          <span className="text-slate-500">•</span>
                          <span>{rec.totalItemsCounted} item(s) counted</span>
                          {isArchived && rec.reviewedByName && (
                            <>
                              <span className="text-slate-500">•</span>
                              <span className="text-emerald-400">
                                Archived by {rec.reviewedByName} ({formatDateTime(rec.archivedAt)})
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[11px] text-slate-400">
                            Matched: <strong className="text-emerald-400 font-mono">{rec.matchedCount}</strong> •
                            Variances:{' '}
                            <strong
                              className={`font-mono ${
                                rec.varianceItemCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {rec.varianceItemCount}
                            </strong>
                          </div>
                          <div
                            className={`text-xs font-mono font-bold ${
                              rec.netVarianceCostValue < 0
                                ? 'text-rose-400'
                                : rec.netVarianceCostValue > 0
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                            }`}
                          >
                            Net: {rec.netVarianceUnits > 0 ? `+${rec.netVarianceUnits}` : rec.netVarianceUnits} u (
                            {rec.netVarianceCostValue >= 0 ? '+' : '-'}$
                            {Math.abs(rec.netVarianceCostValue).toFixed(2)})
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Expanded Frozen Snapshot Details */}
                    {isExpanded && (
                      <div className="border-t border-slate-800 p-4 space-y-4 bg-slate-950/60">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                                <th className="py-2 pr-3">Product</th>
                                <th className="py-2 px-2 text-right">Counted</th>
                                <th className="py-2 px-2 text-right">Frozen SOH</th>
                                <th className="py-2 px-2">Frozen At</th>
                                <th className="py-2 px-2 text-right">Variance</th>
                                <th className="py-2 px-2 text-right">Cost Impact</th>
                                <th className="py-2 pl-3">Optional Commentary</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                              {(rec.lines || []).map((line) => {
                                const lineKey = getAnswerKey(rec.id, line.itemId);
                                const isMatch = line.varianceUnits === 0;
                                const isShort = line.varianceUnits < 0;
                                return (
                                  <tr key={line.itemId} className="align-top">
                                    <td className="py-2.5 pr-3">
                                      <div className="font-semibold text-white">{line.itemName}</div>
                                      <div className="text-[10px] text-slate-500 font-mono">
                                        {line.sku || line.itemId}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-2 text-right font-mono text-white">
                                      {line.countedTotalUnits} u
                                      {line.unitsPerCase > 1 && (
                                        <div className="text-[10px] text-slate-500">
                                          {line.countedCases}c + {line.countedSingles}s
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-2 text-right font-mono text-slate-300">
                                      {line.frozenSystemUnits} u
                                      {line.unitsPerCase > 1 && (
                                        <div className="text-[10px] text-slate-500">
                                          {line.frozenSystemCases}c + {line.frozenSystemSingles}s
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                                      {formatTimeOnly(line.frozenTimestamp)}
                                    </td>
                                    <td
                                      className={`py-2.5 px-2 text-right font-mono font-bold ${
                                        isMatch
                                          ? 'text-emerald-400'
                                          : isShort
                                          ? 'text-rose-400'
                                          : 'text-amber-300'
                                      }`}
                                    >
                                      {line.varianceUnits > 0 ? `+${line.varianceUnits}` : line.varianceUnits} u
                                    </td>
                                    <td
                                      className={`py-2.5 px-2 text-right font-mono font-semibold ${
                                        isMatch
                                          ? 'text-slate-500'
                                          : isShort
                                          ? 'text-rose-300'
                                          : 'text-amber-200'
                                      }`}
                                    >
                                      {line.varianceCostValue >= 0 ? '+' : '-'}$
                                      {Math.abs(line.varianceCostValue).toFixed(2)}
                                    </td>
                                    <td className="py-2.5 pl-3 min-w-[230px]">
                                      {line.explainedAt ? (
                                        <div className="bg-blue-950/40 border border-blue-800/60 rounded-lg p-2 space-y-1">
                                          <div className="text-[10px] font-bold text-blue-300">
                                            {formatReasonLabel(line.reasonCode)}
                                          </div>
                                          {line.staffExplanation && (
                                            <div className="text-[11px] text-slate-200">
                                              "{line.staffExplanation}"
                                            </div>
                                          )}
                                          <div className="text-[10px] text-slate-500">
                                            {line.explainedByName} • {formatDateTime(line.explainedAt)}
                                          </div>
                                        </div>
                                      ) : line.explanationRequested ? (
                                        <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-2 space-y-0.5">
                                          <div className="text-[10px] font-bold text-amber-300">
                                            Awaiting Staff Explanation
                                          </div>
                                          {line.auditorPrompt && (
                                            <div className="text-[11px] text-amber-100/80">
                                              Prompt: {line.auditorPrompt}
                                            </div>
                                          )}
                                        </div>
                                      ) : !isMatch && !isArchived ? (
                                        openPromptLineKey === lineKey ? (
                                          <div className="space-y-1.5">
                                            <input
                                              type="text"
                                              value={promptDrafts[lineKey] || ''}
                                              onChange={(e) =>
                                                setPromptDrafts((prev) => ({ ...prev, [lineKey]: e.target.value }))
                                              }
                                              placeholder="Optional question for counter..."
                                              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-white focus:outline-none focus:border-amber-500"
                                            />
                                            <div className="flex items-center gap-1.5">
                                              <button
                                                type="button"
                                                onClick={() => handleRequestLineExplanation(rec.id, line)}
                                                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold"
                                              >
                                                Send Request
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setOpenPromptLineKey(null)}
                                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px]"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => setOpenPromptLineKey(lineKey)}
                                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-amber-950 text-slate-300 hover:text-amber-200 border border-slate-700 hover:border-amber-700 text-[11px] font-semibold inline-flex items-center gap-1 transition"
                                          >
                                            <MessageSquare className="w-3 h-3" />
                                            Ask Staff to Explain (Optional)
                                          </button>
                                        )
                                      ) : (
                                        <span className="text-[11px] text-slate-500">
                                          {isMatch ? 'Exact Match' : 'No explanation requested'}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Auditor Archive Bar (Strictly Report-Only — ZERO stock adjustment button) */}
                        {!isArchived ? (
                          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                            <input
                              type="text"
                              value={summaryNoteDrafts[rec.id] || ''}
                              onChange={(e) =>
                                setSummaryNoteDrafts((prev) => ({ ...prev, [rec.id]: e.target.value }))
                              }
                              placeholder="Optional auditor archive note (e.g. checked shelf, logged for weekly audit)..."
                              className="flex-1 min-w-[240px] px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleArchiveRecord(rec)}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg transition"
                            >
                              <Archive className="w-4 h-4" />
                              Mark Reviewed & Archive (Report-Only)
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800 text-xs text-slate-400">
                            <div>
                              <strong className="text-emerald-400">Permanently Archived (Report-Only)</strong> •
                              Reviewed by {rec.reviewedByName || 'Auditor'} on {formatDateTime(rec.archivedAt)}
                              {rec.auditorSummaryNote && (
                                <span className="block text-slate-300 mt-0.5">
                                  Auditor Note: {rec.auditorSummaryNote}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-slate-500">
                              Inventory Master Unchanged
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 4: PRODUCT LIST & DESIGNATED AUDITOR SETUP (AUDITOR ONLY)
      ==================================================================== */}
      {activeSubTab === 'CONFIG' && isAuditor && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left 2 Columns: Curate Product List */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">Branch Daily Blind Count Product List</h3>
                <p className="text-xs text-slate-400">
                  Select specific products for floor staff to count daily. Leave empty to automatically count the{' '}
                  <strong className="text-emerald-300">Top 10 Fastest-Moving Products</strong>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {configSelectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleSaveConfig([])}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Use Auto Top 10
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveConfig()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Save List ({configSelectedIds.length})
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={configSearch}
                onChange={(e) => setConfigSearch(e.target.value)}
                placeholder="Search branch Inventory Master to add/remove products..."
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/70 border border-slate-800 rounded-xl bg-slate-950/60">
              {filteredConfigInventory.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No matching products found in this branch's Inventory Master.
                </div>
              ) : (
                filteredConfigInventory.map((item) => {
                  const checked = configSelectedIds.includes(item.itemId);
                  const vel = resolvedTargets.velocityMap[item.itemId] || 0;
                  return (
                    <label
                      key={item.itemId}
                      className={`flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer transition ${
                        checked ? 'bg-indigo-950/35' : 'hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleConfigItem(item.itemId)}
                          className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-900 focus:ring-indigo-500"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{item.itemName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {item.sku || item.itemId} {item.category ? `• ${item.category}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                        30d Sold: {vel} u
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Designated Auditor & Auto Top-10 Preview */}
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <UserCheck className="w-4 h-4 text-indigo-400" />
                Designated Auditor Lock
              </div>
              <p className="text-xs text-slate-400">
                Choose a specific staff member to exclusively unlock Daily Blind Count Results & Archive for this branch, or leave on default so any Branch Manager / Supervisor / Owner can review.
              </p>
              <select
                value={configAuditorId}
                onChange={(e) => setConfigAuditorId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Default: Any Manager / Supervisor / Owner</option>
                {branchStaffCandidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleSaveConfig()}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 hover:border-indigo-500 text-xs font-bold transition"
              >
                Save Auditor Assignment
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Active Count Preview
              </div>
              <p className="text-[11px] text-slate-400">
                {resolvedTargets.source === 'MANAGER_LIST'
                  ? 'Currently serving your custom Manager List:'
                  : 'No custom list active — automatically serving Top 10 Fast Movers:'}
              </p>
              <ol className="space-y-1.5 text-xs">
                {resolvedTargets.items.map((it, idx) => (
                  <li
                    key={it.itemId}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800/80"
                  >
                    <span className="truncate text-slate-200">
                      <span className="text-slate-500 font-mono mr-1.5">{idx + 1}.</span>
                      {it.itemName}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 shrink-0">
                      {resolvedTargets.velocityMap[it.itemId] || 0} sold
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
