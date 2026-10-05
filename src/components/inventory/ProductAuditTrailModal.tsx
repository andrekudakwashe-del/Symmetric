import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  X,
  DollarSign,
  Package,
  AlertTriangle,
  ArrowDownRight,
  ShoppingBag,
  Scissors,
  Sliders,
  Trash2,
  Calendar,
  User,
  Download,
  PlusCircle,
  CheckCircle2,
  Table as TableIcon,
  LayoutGrid,
  Search,
  Filter,
} from 'lucide-react';
import { InventoryItem, StockMovementEntry, Salesperson } from '../../types';
import {
  getProductAuditTrail,
  removeManualStock,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';

interface ProductAuditTrailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  currentUser: Salesperson | null;
  onStockUpdated?: () => void;
}

type FilterTab = 'ALL' | 'PRICE_COST' | 'MANUAL_REMOVAL' | 'RECEIVING' | 'SALES' | 'ADJUSTMENTS';

export const ProductAuditTrailModal: React.FC<ProductAuditTrailModalProps> = ({
  isOpen,
  onClose,
  item,
  currentUser,
  onStockUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [trail, setTrail] = useState<StockMovementEntry[]>([]);
  const [showRemovalDrawer, setShowRemovalDrawer] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Manual Removal Form State (allow string so user can clear and type freely)
  const [removalReason, setRemovalReason] = useState<
    'DAMAGE_LOSS' | 'EXPIRY' | 'SPOILAGE' | 'SHRINKAGE' | 'INTERNAL_USE' | 'ADJUSTMENT'
  >('DAMAGE_LOSS');
  const [casesToRemove, setCasesToRemove] = useState<string | number>('');
  const [singlesToRemove, setSinglesToRemove] = useState<string | number>('');
  const [removalNotes, setRemovalNotes] = useState<string>('');

  // Phone / Android Hardware Back Button: close audit modal or removal drawer on back press
  useEffect(() => {
    if (!isOpen) return;
    const handleHardwareBack = (e: Event) => {
      e.preventDefault();
      if (showRemovalDrawer) {
        setShowRemovalDrawer(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('saimetric_hardware_back', handleHardwareBack);
    return () => {
      window.removeEventListener('saimetric_hardware_back', handleHardwareBack);
    };
  }, [isOpen, showRemovalDrawer, onClose]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 4000);
  };

  const loadAuditTrail = () => {
    if (!item?.itemId) return;
    const history = getProductAuditTrail(item.itemId);
    setTrail(history);
  };

  useEffect(() => {
    if (isOpen && item?.itemId) {
      loadAuditTrail();
      setShowRemovalDrawer(false);
      setCasesToRemove('');
      setSinglesToRemove('');
      setRemovalNotes('');

      // Auto-refresh trail live if any stock/audit action takes place
      const unsubscribe = subscribeRoomDatabase(() => {
        loadAuditTrail();
      });
      return () => unsubscribe();
    }
  }, [isOpen, item?.itemId]);

  // Classification Helpers with resilient multi-condition detection
  const isEntryPriceChange = (e: StockMovementEntry) =>
    e.movementType === 'PRICE_CHANGE' ||
    e.movementType === 'COST_CHANGE' ||
    e.txnType === 'PRICE_CHANGE' ||
    e.txnType === 'COST_CHANGE' ||
    e.actionTaken === 'PRICE_REVISION' ||
    e.actionTaken === 'COST_REVISION' ||
    Boolean(e.fieldChanged) ||
    Boolean(e.oldValue !== undefined && e.newValue !== undefined) ||
    (e.reason && (e.reason.toLowerCase().includes('price') || e.reason.toLowerCase().includes('cost revision')));

  const isEntryRemoval = (e: StockMovementEntry) =>
    e.movementType === 'DAMAGE_LOSS' ||
    (e.movementType as string) === 'DAMAGE_REMOVAL' ||
    e.txnType === 'DAMAGE_LOSS' ||
    e.actionTaken === 'MANUAL_REMOVAL' ||
    ['DAMAGE_LOSS', 'EXPIRY', 'SPOILAGE', 'SHRINKAGE', 'INTERNAL_USE'].includes((e as any).reasonType) ||
    (e.reason && (
      e.reason.toLowerCase().includes('damage') ||
      e.reason.toLowerCase().includes('spoilage') ||
      e.reason.toLowerCase().includes('expiry') ||
      e.reason.toLowerCase().includes('shrinkage') ||
      e.reason.toLowerCase().includes('manual removal')
    ));

  const isEntryReceive = (e: StockMovementEntry) =>
    e.movementType === 'GOODS_RECEIVED' ||
    e.txnType === 'RECEIVE' ||
    e.actionTaken === 'DIRECT_DELIVERY_RECEIVE' ||
    e.actionTaken === 'GOODS_RECEIVED' ||
    e.actionTaken === 'CONVERTED_TO_SINGLES_NO_CASE_SALE' ||
    (e.referenceId && (
      e.referenceId.startsWith('GRN') ||
      e.referenceId.startsWith('GRV') ||
      e.referenceId.startsWith('VOUCHER') ||
      e.referenceId.includes('PO:')
    )) ||
    (e.reason && (
      e.reason.toLowerCase().includes('grn') ||
      e.reason.toLowerCase().includes('delivery') ||
      e.reason.toLowerCase().includes('goods received')
    ));

  const isEntrySale = (e: StockMovementEntry) =>
    e.movementType === 'SALE' ||
    e.txnType === 'SALE' ||
    e.actionTaken === 'SOLD' ||
    e.actionTaken === 'POS_SALE' ||
    e.actionTaken === 'SOLD_NEGATIVE_BALANCE' ||
    e.actionTaken === 'AUTO_BROKE_AND_SOLD' ||
    (e.referenceId && (
      e.referenceId.startsWith('INV-') ||
      e.referenceId.startsWith('SALE-') ||
      e.referenceId.startsWith('POS-')
    )) ||
    (e.reason && (
      e.reason.toLowerCase().includes('pos sale') ||
      e.reason.toLowerCase().includes('pos outflow') ||
      e.reason.toLowerCase().includes('sold ')
    ));

  const isEntryCaseBreak = (e: StockMovementEntry) =>
    e.movementType === 'BREAK_CASE' ||
    e.txnType === 'BREAK_CASE' ||
    e.actionTaken === 'MANUAL_CASE_BREAK' ||
    e.actionTaken === 'AUTO_BREAK_RULE_A';

  if (!isOpen || !item) return null;

  const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
  const casePkgName = item.casePackageName || 'Case';
  const casePkgPlural = casePkgName.toLowerCase().endsWith('s') ? casePkgName : `${casePkgName}s`;
  const totalUnits = (item.stockCases * unitsPerCase) + item.stockSingles;

  // Filter trail
  const filteredTrail = trail.filter((entry) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (entry.reason && entry.reason.toLowerCase().includes(q)) ||
      (entry.staffName && entry.staffName.toLowerCase().includes(q)) ||
      (entry.referenceId && entry.referenceId.toLowerCase().includes(q)) ||
      (entry.movementId && entry.movementId.toLowerCase().includes(q)) ||
      (entry.actionTaken && entry.actionTaken.toLowerCase().includes(q)) ||
      (entry.itemName && entry.itemName.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    switch (activeTab) {
      case 'PRICE_COST':
        return isEntryPriceChange(entry);
      case 'MANUAL_REMOVAL':
        return isEntryRemoval(entry);
      case 'RECEIVING':
        return isEntryReceive(entry);
      case 'SALES':
        return isEntrySale(entry);
      case 'ADJUSTMENTS':
        return (
          entry.movementType === 'ADJUSTMENT' ||
          isEntryCaseBreak(entry) ||
          entry.movementType === 'RETURN'
        );
      case 'ALL':
      default:
        return true;
    }
  });

  // Calculate audit statistics and tab counts
  const tabCounts = {
    all: trail.length,
    priceCost: trail.filter(isEntryPriceChange).length,
    removal: trail.filter(isEntryRemoval).length,
    receiving: trail.filter(isEntryReceive).length,
    sales: trail.filter(isEntrySale).length,
  };

  const stats = {
    priceChangesCount: tabCounts.priceCost,
    receivedUnitsTotal: trail
      .filter(isEntryReceive)
      .reduce((sum, e) => sum + ((e.casesChange || e.qtyCases || 0) * unitsPerCase + (e.singlesChange || e.qtySingles || 0)), 0),
    soldUnitsTotal: trail
      .filter(isEntrySale)
      .reduce((sum, e) => sum + Math.abs((e.casesChange || e.qtyCases || 0) * unitsPerCase + (e.singlesChange || e.qtySingles || 0)), 0),
    deductionsTotal: trail
      .filter(isEntryRemoval)
      .reduce((sum, e) => sum + Math.abs((e.casesChange || e.qtyCases || 0) * unitsPerCase + (e.singlesChange || e.qtySingles || 0)), 0),
  };

  const handleExecuteRemoval = (e: React.FormEvent) => {
    e.preventDefault();
    const numCases = Math.max(0, parseFloat(String(casesToRemove)) || 0);
    const numSingles = Math.max(0, parseFloat(String(singlesToRemove)) || 0);
    if (numCases <= 0 && numSingles <= 0) {
      showToast('error', `Please enter a quantity of ${casePkgPlural} or singles to remove.`);
      return;
    }
    if (!removalNotes.trim()) {
      showToast('error', 'An audit explanation/reason note is mandatory.');
      return;
    }

    const res = removeManualStock({
      itemId: item.itemId,
      casesToRemove: numCases,
      singlesToRemove: numSingles,
      reasonType: removalReason,
      notes: removalNotes.trim(),
      staffId: currentUser?.id || 'USR-001',
      staffName: currentUser?.name || 'Administrator',
    });

    if (res.success) {
      showToast('success', res.message);
      setShowRemovalDrawer(false);
      setCasesToRemove('');
      setSinglesToRemove('');
      setRemovalNotes('');
      loadAuditTrail();
      if (onStockUpdated) onStockUpdated();
    } else {
      showToast('error', res.message);
    }
  };

  const handleExportCSV = () => {
    const listToExport = filteredTrail.length > 0 ? filteredTrail : trail;
    if (listToExport.length === 0) {
      showToast('error', 'No audit trail entries to export.');
      return;
    }

    const headers = [
      'Timestamp',
      'Movement ID / Txn ID',
      'Category / Type',
      'Action Taken',
      `${casePkgName} Delta`,
      'Singles Delta',
      `Closing ${casePkgPlural}`,
      'Closing Singles',
      'Old Value ($)',
      'New Value ($)',
      'Staff Name',
      'Reference / Voucher',
      'Reason / Audit Notes',
    ];

    const rows = listToExport.map((m) => {
      const isRemoval = isEntryRemoval(m);
      const isSale = isEntrySale(m);
      const isRecv = isEntryReceive(m);

      let cDelta = m.casesChange !== undefined ? m.casesChange : m.qtyCases || 0;
      let sDelta = m.singlesChange !== undefined ? m.singlesChange : m.qtySingles || 0;

      if ((isRemoval || isSale) && cDelta > 0) cDelta = -cDelta;
      if ((isRemoval || isSale) && sDelta > 0) sDelta = -sDelta;

      return [
        `"${m.timestamp || m.date || ''}"`,
        `"${m.movementId || m.txnId || ''}"`,
        `"${m.movementType || m.txnType || (isSale ? 'SALE' : isRecv ? 'RECEIVE' : isRemoval ? 'REMOVAL' : 'ADJUSTMENT')}"`,
        `"${m.actionTaken || ''}"`,
        cDelta,
        sDelta,
        m.closingCases !== undefined ? m.closingCases : (m.resultingStockCases ?? ''),
        m.closingSingles !== undefined ? m.closingSingles : (m.resultingStockSingles ?? ''),
        m.oldValue !== undefined ? m.oldValue : '',
        m.newValue !== undefined ? m.newValue : '',
        `"${(m.staffName || '').replace(/"/g, '""')}"`,
        `"${(m.referenceId || '').replace(/"/g, '""')}"`,
        `"${(m.reason || m.promptShown || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Audit_Trail_${item.itemId}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', `Exported ${listToExport.length} audit entries to CSV.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 rounded-3xl max-w-6xl w-full max-h-[94vh] flex flex-col shadow-2xl border border-slate-700 overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-md">
              <History className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-white tracking-tight">{item.itemName}</h2>
                <span className="text-xs font-mono font-bold bg-slate-800 text-amber-300 px-2.5 py-0.5 rounded-md border border-slate-700">
                  {item.itemId}
                </span>
                {item.sku && (
                  <span className="text-xs font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded">
                    SKU: {item.sku}
                  </span>
                )}
                {item.casePackageName && (
                  <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30">
                    Package: {item.casePackageName} ({item.unitsPerCase} units)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete Inventory Ledger & Forensic Audit Trail: Sales Deductions, Price Changes, Goods Received & Removals
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  viewMode === 'table'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Excel-Style Ledger Table View"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Ledger Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  viewMode === 'cards'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Forensic Card Inspector View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>

            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-bold rounded-xl flex items-center gap-1.5 border border-emerald-500/40 transition shadow-sm"
              title="Download Audit Trail as Excel/CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export Excel/CSV</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition border border-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toast */}
        {notification && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2 ${
              notification.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{notification.text}</span>
          </div>
        )}

        {/* Metric Badges Banner: 4 Pillars */}
        <div className="p-4 sm:p-5 bg-slate-900/60 border-b border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Current Stock */}
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Current Balance
            </span>
            <div className="text-lg font-mono font-black text-white">
              {item.stockCases} {casePkgPlural}, {item.stockSingles} ea
            </div>
            <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
              Total Units: <strong className="text-amber-400">{totalUnits}</strong> (Cost: ${item.costPerUnit.toFixed(2)})
            </span>
          </div>

          {/* Card 2: Deliveries & Inflow */}
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Deliveries & Inflow
            </span>
            <div className="text-lg font-mono font-black text-emerald-400">
              +{stats.receivedUnitsTotal} units
            </div>
            <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
              {tabCounts.receiving} GRN / GRV deliveries logged
            </span>
          </div>

          {/* Card 3: POS Sales Outflow */}
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              POS Sales Outflow
            </span>
            <div className="text-lg font-mono font-black text-blue-400">
              -{stats.soldUnitsTotal} units
            </div>
            <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
              {tabCounts.sales} sale transaction(s) recorded
            </span>
          </div>

          {/* Card 4: Manual Removals & Losses */}
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Manual Removals / Losses
            </span>
            <div className="text-lg font-mono font-black text-rose-400">
              -{stats.deductionsTotal} units
            </div>
            <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
              Damages, Spoilage, Shrinkage ({tabCounts.removal})
            </span>
          </div>
        </div>

        {/* Toolbar & Filter Tabs */}
        <div className="px-5 sm:px-6 py-3 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'ALL'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              All Activities ({trail.length})
            </button>
            <button
              onClick={() => setActiveTab('SALES')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'SALES'
                  ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Sales Deductions</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                activeTab === 'SALES' ? 'bg-slate-950 text-blue-300' : 'bg-slate-700 text-slate-200'
              }`}>
                {tabCounts.sales}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('RECEIVING')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'RECEIVING'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              <span>Goods Received (GRN)</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                activeTab === 'RECEIVING' ? 'bg-slate-950 text-emerald-950' : 'bg-slate-700 text-slate-200'
              }`}>
                {tabCounts.receiving}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('PRICE_COST')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'PRICE_COST'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Price Changes</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                activeTab === 'PRICE_COST' ? 'bg-slate-950 text-amber-300' : 'bg-slate-700 text-slate-200'
              }`}>
                {tabCounts.priceCost}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('MANUAL_REMOVAL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'MANUAL_REMOVAL'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-950'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Manual Removals</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                activeTab === 'MANUAL_REMOVAL' ? 'bg-slate-950 text-rose-300' : 'bg-slate-700 text-slate-200'
              }`}>
                {tabCounts.removal}
              </span>
            </button>
          </div>

          {/* Search Box & Action */}
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ref, staff, reason..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={() => setShowRemovalDrawer(!showRemovalDrawer)}
              className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-rose-950 shrink-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Record Removal</span>
            </button>
          </div>
        </div>

        {/* Manual Stock Removal Drawer */}
        {showRemovalDrawer && (
          <div className="p-5 bg-slate-950 border-b border-rose-900/40 animate-in slide-in-from-top-2">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="font-bold text-sm text-white">
                    Record Manual Stock Deduction for {item.itemName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRemovalDrawer(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>

              <form onSubmit={handleExecuteRemoval} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Reason Type */}
                  <div className="sm:col-span-1">
                    <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">
                      Deduction Reason *
                    </label>
                    <select
                      value={removalReason}
                      onChange={(e) => setRemovalReason(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-rose-500"
                    >
                      <option value="DAMAGE_LOSS">Damaged Goods / Broken</option>
                      <option value="EXPIRY">Expired Stock / Outdated</option>
                      <option value="SPOILAGE">Spoilage / Rotten / Defective</option>
                      <option value="SHRINKAGE">Shrinkage / Unaccounted Theft</option>
                      <option value="INTERNAL_USE">Internal Store Consumption</option>
                      <option value="ADJUSTMENT">Stocktake Count Audit Variance</option>
                    </select>
                  </div>

                  {/* Cases to remove */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">
                      {casePkgPlural} To Deduct
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={casesToRemove}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setCasesToRemove(e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  {/* Singles to remove */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">
                      Singles To Deduct (Can be 0.5)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={singlesToRemove}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setSinglesToRemove(e.target.value)}
                      placeholder="0 or 0.5"
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">
                    Auditor Explanation / Notes *
                  </label>
                  <input
                    type="text"
                    value={removalNotes}
                    onChange={(e) => setRemovalNotes(e.target.value)}
                    placeholder="e.g. Expired batch discarded, broken during shelf stocking, half loaf returned damaged"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-500 font-medium"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRemovalDrawer(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-950 flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm & Deduct Stock</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Audit Trail List: Ledger Table View vs Card View */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {filteredTrail.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-800 text-slate-500 flex items-center justify-center mx-auto mb-3">
                <History className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">No Audit Entries Found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery
                  ? `No events matching "${searchQuery}". Try clearing the search query.`
                  : 'No activity has been logged for this filter. Deliveries, price changes, manual removals, and sales will appear here automatically.'}
              </p>
            </div>
          ) : viewMode === 'table' ? (
            /* EXCEL LEDGER TABLE VIEW */
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-inner">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-300 border-b border-slate-800 text-[11px] font-black uppercase tracking-wider">
                    <th className="py-3 px-3.5 whitespace-nowrap">Date & Time</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Activity / Type</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Ref / Voucher #</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Action Taken</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">{casePkgName} Δ</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Singles Δ</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap">Stock After</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Price / Cost</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Staff</th>
                    <th className="py-3 px-3.5 min-w-[200px]">Reason & Audit Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredTrail.map((entry, index) => {
                    const isPriceChange = isEntryPriceChange(entry);
                    const isRemoval = isEntryRemoval(entry);
                    const isReceive = isEntryReceive(entry);
                    const isSale = isEntrySale(entry);
                    const isCaseBreak = isEntryCaseBreak(entry);

                    let cDelta = entry.casesChange !== undefined ? entry.casesChange : (entry.qtyCases || 0);
                    let sDelta = entry.singlesChange !== undefined ? entry.singlesChange : (entry.qtySingles || 0);

                    if ((isRemoval || isSale) && cDelta > 0) cDelta = -cDelta;
                    if ((isRemoval || isSale) && sDelta > 0) sDelta = -sDelta;

                    const formattedDate = entry.timestamp
                      ? new Date(entry.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : entry.date || '—';

                    return (
                      <tr
                        key={entry.txnId || entry.movementId || index}
                        className="hover:bg-slate-900/60 transition-colors"
                      >
                        {/* 1. Date & Time */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono text-slate-300">
                          {formattedDate}
                        </td>

                        {/* 2. Activity Type Badge */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          {isSale && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              <ShoppingBag className="w-3 h-3 text-blue-400" />
                              POS Sale
                            </span>
                          )}
                          {isReceive && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <ArrowDownRight className="w-3 h-3 text-emerald-400" />
                              GRN Receive
                            </span>
                          )}
                          {isRemoval && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              <Trash2 className="w-3 h-3 text-rose-400" />
                              Stock Removal
                            </span>
                          )}
                          {isPriceChange && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <DollarSign className="w-3 h-3 text-amber-400" />
                              {entry.fieldChanged === 'COST' ? 'Cost Revision' : 'Price Revision'}
                            </span>
                          )}
                          {isCaseBreak && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <Scissors className="w-3 h-3 text-indigo-400" />
                              Case Break
                            </span>
                          )}
                          {!isSale && !isReceive && !isRemoval && !isPriceChange && !isCaseBreak && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              <Sliders className="w-3 h-3 text-slate-400" />
                              {entry.movementType || entry.txnType || 'Adjustment'}
                            </span>
                          )}
                        </td>

                        {/* 3. Ref / Voucher */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono text-slate-400">
                          {entry.referenceId || entry.movementId || entry.txnId || '—'}
                        </td>

                        {/* 4. Action Taken */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono text-[11px] text-slate-400">
                          {entry.actionTaken || entry.movementType || '—'}
                        </td>

                        {/* 5. Cases Delta */}
                        <td className={`py-3 px-3.5 text-right font-mono font-bold whitespace-nowrap ${
                          cDelta > 0 ? 'text-emerald-400' : cDelta < 0 ? 'text-rose-400' : 'text-slate-500'
                        }`}>
                          {cDelta > 0 ? `+${cDelta}` : cDelta !== 0 ? cDelta : '0'}
                        </td>

                        {/* 6. Singles Delta */}
                        <td className={`py-3 px-3.5 text-right font-mono font-bold whitespace-nowrap ${
                          sDelta > 0 ? 'text-emerald-400' : sDelta < 0 ? 'text-rose-400' : 'text-slate-500'
                        }`}>
                          {sDelta > 0 ? `+${sDelta}` : sDelta !== 0 ? sDelta : '0'}
                        </td>

                        {/* 7. Stock After */}
                        <td className="py-3 px-3.5 text-center font-mono text-slate-300 whitespace-nowrap">
                          {entry.closingCases !== undefined || entry.resultingStockCases !== undefined ? (
                            <span>
                              {entry.closingCases ?? entry.resultingStockCases} cs, {entry.closingSingles ?? entry.resultingStockSingles} ea
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* 8. Price / Cost */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono">
                          {isPriceChange || (entry.oldValue !== undefined && entry.newValue !== undefined) ? (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="line-through text-rose-400/80">
                                ${Number(entry.oldValue || 0).toFixed(2)}
                              </span>
                              <span className="text-slate-500">→</span>
                              <span className="font-bold text-emerald-400">
                                ${Number(entry.newValue || 0).toFixed(2)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* 9. Staff */}
                        <td className="py-3 px-3.5 whitespace-nowrap text-slate-300">
                          {entry.staffName || 'Staff'}
                        </td>

                        {/* 10. Reason / Notes */}
                        <td className="py-3 px-3.5 text-slate-300 text-xs">
                          {entry.reason || entry.promptShown || '—'}
                          {entry.itemName && entry.itemName !== item.itemName && (
                            <span className="ml-2 text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                              {entry.itemName}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* FORENSIC CARDS VIEW */
            <div className="space-y-3">
              {filteredTrail.map((entry, index) => {
                const isPriceChange = isEntryPriceChange(entry);
                const isRemoval = isEntryRemoval(entry);
                const isReceive = isEntryReceive(entry);
                const isSale = isEntrySale(entry);
                const isCaseBreak = isEntryCaseBreak(entry);

                let cDelta = entry.casesChange !== undefined ? entry.casesChange : (entry.qtyCases || 0);
                let sDelta = entry.singlesChange !== undefined ? entry.singlesChange : (entry.qtySingles || 0);

                if ((isRemoval || isSale) && cDelta > 0) cDelta = -cDelta;
                if ((isRemoval || isSale) && sDelta > 0) sDelta = -sDelta;

                let activityTitle = '';
                if (isPriceChange) {
                  const field = entry.fieldChanged === 'COST' ? 'Cost Price Revision' : 'Selling Price Revision';
                  activityTitle = `${field}: $${Number(entry.oldValue || 0).toFixed(2)} → $${Number(entry.newValue || 0).toFixed(2)}`;
                } else if (isReceive) {
                  activityTitle = `Stock Inflow (GRN/GRV): +${cDelta} ${casePkgPlural}, +${sDelta} Singles`;
                } else if (isSale) {
                  activityTitle = `POS Outflow (Sale): ${cDelta} ${casePkgPlural}, ${sDelta} Singles`;
                } else if (isRemoval) {
                  activityTitle = `Manual Stock Removal: ${cDelta} ${casePkgPlural}, ${sDelta} Singles`;
                } else if (isCaseBreak) {
                  activityTitle = `Case Break: Broken to Singles for Shelf Stock`;
                } else {
                  activityTitle = `Inventory Adjustment: ${entry.movementType || entry.txnType || 'Recorded'}`;
                }

                return (
                  <div
                    key={entry.txnId || entry.movementId || index}
                    className="bg-slate-950 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        {/* Type Icon Badge */}
                        {isPriceChange && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                            {entry.fieldChanged === 'COST' ? 'Cost Revision' : 'Price Revision'}
                          </span>
                        )}
                        {isRemoval && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 text-rose-300 border border-rose-500/30">
                            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            Manual Stock Removal
                          </span>
                        )}
                        {isReceive && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" />
                            Goods Received (GRN)
                          </span>
                        )}
                        {isSale && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-300 border border-blue-500/30">
                            <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />
                            POS Sale
                          </span>
                        )}
                        {isCaseBreak && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                            <Scissors className="w-3.5 h-3.5 text-indigo-400" />
                            Case Break
                          </span>
                        )}
                        {!isPriceChange && !isRemoval && !isReceive && !isSale && !isCaseBreak && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            <Sliders className="w-3.5 h-3.5 text-slate-400" />
                            {entry.movementType || entry.txnType || 'Adjustment'}
                          </span>
                        )}

                        <span className="text-xs font-mono text-slate-400">
                          Ref: {entry.referenceId || entry.movementId || entry.txnId}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : entry.date}
                        </span>
                        <span className="flex items-center gap-1 text-slate-300">
                          <User className="w-3.5 h-3.5 text-amber-400" />
                          {entry.staffName || 'Staff'} ({entry.userRole || 'Staff'})
                        </span>
                      </div>
                    </div>

                    {/* Headline Banner */}
                    <div className="mb-2.5">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{activityTitle}</span>
                        {entry.itemName && entry.itemName !== item.itemName && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            Variant: {entry.itemName}
                          </span>
                        )}
                      </h4>
                    </div>

                    {/* Entry Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      {/* Left: What Changed */}
                      <div className="sm:col-span-2 space-y-1.5">
                        {isPriceChange ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">Price Movement:</span>
                              <span className="font-mono text-rose-400 line-through">
                                ${Number(entry.oldValue || 0).toFixed(2)}
                              </span>
                              <span className="text-slate-500">→</span>
                              <span className="font-mono text-emerald-400 font-bold text-sm">
                                ${Number(entry.newValue || 0).toFixed(2)}
                              </span>
                              {entry.percentChange !== undefined && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  entry.percentChange > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                                }`}>
                                  {entry.percentChange > 0 ? `+${entry.percentChange}%` : `${entry.percentChange}%`}
                                </span>
                              )}
                            </div>
                            {entry.reason && (
                              <p className="text-slate-300 font-medium italic">
                                "{entry.reason}"
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">Quantity Delta:</span>
                              <span className={`font-mono font-bold text-sm ${
                                cDelta < 0 || sDelta < 0 ? 'text-rose-400' : 'text-emerald-400'
                              }`}>
                                {cDelta > 0 ? `+${cDelta} ${casePkgPlural} ` : cDelta < 0 ? `${cDelta} ${casePkgPlural} ` : ''}
                                {sDelta > 0 ? `+${sDelta} ea` : sDelta < 0 ? `${sDelta} ea` : ''}
                                {cDelta === 0 && sDelta === 0 ? '0' : ''}
                              </span>
                            </div>
                            {entry.reason && (
                              <p className="text-slate-300 font-medium italic">
                                "{entry.reason}"
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: Balance After Event */}
                      <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 space-y-1 font-mono text-[11px]">
                        <span className="text-slate-400 block font-sans font-bold text-[10px] uppercase tracking-wider">
                          Stock Balance After Event:
                        </span>
                        {entry.closingCases !== undefined || entry.resultingStockCases !== undefined ? (
                          <div className="text-slate-200">
                            <strong>{entry.closingCases ?? entry.resultingStockCases}</strong> {casePkgPlural}, <strong className="text-amber-400">{entry.closingSingles ?? entry.resultingStockSingles}</strong> singles
                          </div>
                        ) : (
                          <div className="text-slate-500 italic">Not tracked on legacy records</div>
                        )}
                        <div className="text-[10px] text-slate-500 pt-0.5">
                          Action: {entry.actionTaken || 'STOCK_EVENT'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>Showing {filteredTrail.length} of {trail.length} audit entries</span>
            {searchQuery && (
              <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px]">
                Filtered by: "{searchQuery}"
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition ml-auto"
          >
            Close Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
