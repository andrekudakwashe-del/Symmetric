import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  Calendar,
  AlertTriangle,
  Clock,
  TrendingDown,
  TrendingUp,
  Search,
  Filter,
  CheckCircle2,
  DollarSign,
  User,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  FileSpreadsheet,
  Building2,
  History,
  Package,
  ArrowUpDown,
  Flame,
  AlertOctagon,
  Skull,
  Check,
} from 'lucide-react';
import {
  StockBatch,
  NegativeBalanceEntry,
  StockMovementEntry,
  InventoryItem,
  Salesperson,
} from '../../types';
import {
  getStockBatches,
  getNegativeBalances,
  getInventoryItems,
  getStockMovements,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';

interface BatchTrackingViewProps {
  currentUser: Salesperson | null;
  onOpenGRN?: (itemId?: string) => void;
}

export type BatchFlag = 'DEAD STOCK' | 'EXPIRY RISK' | 'SLOW MOVING' | 'OK';

export interface EnrichedBatch extends StockBatch {
  ageInDays: number;
  qtySoldLast90Days: number;
  avgDailySales: number;
  daysCovered: number;
  lastCost: number;
  valueStuck: number;
  lastSaleDate: string;
  flag: BatchFlag;
  isExpired: boolean;
  daysToExpiry: number | null;
}

export const BatchTrackingView: React.FC<BatchTrackingViewProps> = ({
  currentUser,
  onOpenGRN,
}) => {
  const [batches, setBatches] = useState<StockBatch[]>(() => getStockBatches());
  const [negativeBalances, setNegativeBalances] = useState<NegativeBalanceEntry[]>(() => getNegativeBalances());
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => getInventoryItems());
  const [stockMovements, setStockMovements] = useState<StockMovementEntry[]>(() => getStockMovements());

  const [activeSubTab, setActiveSubTab] = useState<'batches' | 'negative_balances' | 'fraud_loss_audit'>('batches');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductFilter, setSelectedProductFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DEAD_STOCK' | 'EXPIRY_RISK' | 'SLOW_MOVING' | 'OK' | 'ACTIVE'>('ALL');
  const [sortField, setSortField] = useState<keyof EnrichedBatch>('daysCovered');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const refreshData = () => {
    setBatches(getStockBatches());
    setNegativeBalances(getNegativeBalances());
    setInventoryItems(getInventoryItems());
    setStockMovements(getStockMovements());
  };

  useEffect(() => {
    const unsub = subscribeRoomDatabase(refreshData);
    return unsub;
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayTime = new Date(todayStr).getTime();
  const ninetyDaysAgoTime = todayTime - 90 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgoStr = new Date(ninetyDaysAgoTime).toISOString().split('T')[0];

  // Map inventory items by itemId for quick lookup of unitsPerCase etc.
  const inventoryItemsMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventoryItems.forEach((it) => map.set(it.itemId, it));
    return map;
  }, [inventoryItems]);

  // Aggregate 90-day sales and last sale date per product code from Stock Movement
  const productSalesStats = useMemo(() => {
    const salesMap = new Map<string, { qtySold90: number; lastSaleDate: string }>();

    stockMovements.forEach((m) => {
      const isSale =
        m.txnType === 'SALE' ||
        m.movementType === 'SALE' ||
        (m.actionTaken && m.actionTaken.includes('SOLD')) ||
        (m.promptShown && m.promptShown.toLowerCase().includes('sale'));

      if (!isSale) return;

      const item = inventoryItemsMap.get(m.itemId);
      const unitsPerCase = item?.unitsPerCase || 1;

      // Units out calculation
      const unitsOut =
        m.singlesChange && m.singlesChange < 0
          ? Math.abs(m.singlesChange) + Math.abs(m.casesChange || 0) * unitsPerCase
          : (m.qtyCases || 0) * unitsPerCase + (m.qtySingles || 0);

      const existing = salesMap.get(m.itemId) || { qtySold90: 0, lastSaleDate: '' };

      // Check if within last 90 days
      const movementDate = m.date || m.timestamp?.split('T')[0] || '';
      if (movementDate >= ninetyDaysAgoStr) {
        existing.qtySold90 += unitsOut;
      }

      // Track most recent sale date
      if (movementDate && (!existing.lastSaleDate || movementDate > existing.lastSaleDate)) {
        existing.lastSaleDate = movementDate;
      }

      salesMap.set(m.itemId, existing);
    });

    return salesMap;
  }, [stockMovements, inventoryItemsMap, ninetyDaysAgoStr]);

  // Calculate Enriched Batches with Days Covered & Flags
  const enrichedBatches: EnrichedBatch[] = useMemo(() => {
    return batches.map((batch) => {
      const receivedDate = batch.receivedDate || batch.createdAt?.split('T')[0] || todayStr;
      const receivedTime = new Date(receivedDate).getTime();
      const ageInDays = Math.max(0, Math.floor((todayTime - receivedTime) / (1000 * 60 * 60 * 24)));

      const stats = productSalesStats.get(batch.itemId) || { qtySold90: 0, lastSaleDate: '' };
      const qtySoldLast90Days = stats.qtySold90;
      const lastSaleDate = stats.lastSaleDate;

      // Average Daily Sales = Qty Sold Last 90 Days / 90
      const avgDailySales = qtySoldLast90Days / 90;

      // Days Covered = IF(Average Daily Sales = 0, 999, ROUND(Qty On Hand / Average Daily Sales, 0))
      const daysCovered = avgDailySales === 0 ? 999 : Math.round(batch.qtyOnHand / avgDailySales);

      const lastCost = batch.costPerUnit || 0;
      const valueStuck = (batch.qtyOnHand || 0) * lastCost;

      // Expiry calculations
      let isExpired = false;
      let daysToExpiry: number | null = null;
      let isExpiryRisk = false;

      if (batch.expiryDate) {
        const expTime = new Date(batch.expiryDate).getTime();
        daysToExpiry = Math.ceil((expTime - todayTime) / (1000 * 60 * 60 * 24));
        if (daysToExpiry < 0) {
          isExpired = true;
        }

        // Flag = "EXPIRY RISK" if Expiry Date <= TODAY() + Days Covered
        const coverageDeadlineTime = todayTime + daysCovered * 24 * 60 * 60 * 1000;
        if (expTime <= coverageDeadlineTime) {
          isExpiryRisk = true;
        }
      }

      // Flag calculation logic:
      // A. Flag = "DEAD STOCK" if Qty Sold Last 90 Days = 0 AND Age in Days > 90
      // B. Flag = "EXPIRY RISK" if Expiry Date <= TODAY() + Days Covered
      // C. Flag = "SLOW MOVING" if Days Covered > 120
      // D. Flag = "OK" if Days Covered <= 60
      let flag: BatchFlag = 'OK';
      if (qtySoldLast90Days === 0 && ageInDays > 90) {
        flag = 'DEAD STOCK';
      } else if (isExpiryRisk) {
        flag = 'EXPIRY RISK';
      } else if (daysCovered > 120) {
        flag = 'SLOW MOVING';
      } else if (daysCovered <= 60) {
        flag = 'OK';
      } else {
        flag = 'OK';
      }

      return {
        ...batch,
        ageInDays,
        qtySoldLast90Days,
        avgDailySales,
        daysCovered,
        lastCost,
        valueStuck,
        lastSaleDate,
        flag,
        isExpired,
        daysToExpiry,
      };
    });
  }, [batches, productSalesStats, todayStr, todayTime]);

  // Batches filtered & sorted (Default Sort: Days Covered DESC)
  const filteredBatches = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    return enrichedBatches
      .filter((b) => {
        const matchSearch =
          !q ||
          (b.itemName && b.itemName.toLowerCase().includes(q)) ||
          (b.itemId && b.itemId.toLowerCase().includes(q)) ||
          (b.batchNumber && b.batchNumber.toLowerCase().includes(q)) ||
          (b.supplier && b.supplier.toLowerCase().includes(q));

        const matchProduct = selectedProductFilter === 'ALL' || b.itemId === selectedProductFilter;

        if (!matchSearch || !matchProduct) return false;

        if (statusFilter === 'DEAD_STOCK') return b.flag === 'DEAD STOCK';
        if (statusFilter === 'EXPIRY_RISK') return b.flag === 'EXPIRY RISK';
        if (statusFilter === 'SLOW_MOVING') return b.flag === 'SLOW MOVING';
        if (statusFilter === 'OK') return b.flag === 'OK';
        if (statusFilter === 'ACTIVE') return b.qtyOnHand > 0;

        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortField];
        let valB: any = b[sortField];

        if (typeof valA === 'string') {
          valA = valA.toLowerCase();
          valB = (valB || '').toLowerCase();
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [enrichedBatches, searchQuery, selectedProductFilter, statusFilter, sortField, sortOrder]);

  const handleSort = (field: keyof EnrichedBatch) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Negative balances filtered
  const filteredNegativeBalances = negativeBalances.filter((n) => {
    const q = (searchQuery || '').trim().toLowerCase();
    const matchSearch =
      !q ||
      (n.itemName && n.itemName.toLowerCase().includes(q)) ||
      (n.itemId && n.itemId.toLowerCase().includes(q)) ||
      (n.id && n.id.toLowerCase().includes(q)) ||
      (n.soldByName && n.soldByName.toLowerCase().includes(q));
    const matchProduct = selectedProductFilter === 'ALL' || n.itemId === selectedProductFilter;
    return matchSearch && matchProduct;
  });

  // Price/Cost Audit logs filtered from movements
  const auditLogs = stockMovements.filter(
    (m) =>
      m.txnType === 'PRICE_CHANGE' ||
      m.txnType === 'COST_CHANGE' ||
      m.movementType === 'PRICE_CHANGE' ||
      m.movementType === 'COST_CHANGE' ||
      m.isNegativeSale
  );

  // Overall statistics & Flag Counts
  const totalBatchesCount = enrichedBatches.length;
  const activeBatchesCount = enrichedBatches.filter((b) => b.qtyOnHand > 0).length;
  const totalBatchValuation = enrichedBatches.reduce((acc, b) => acc + b.valueStuck, 0);

  const deadStockCount = enrichedBatches.filter((b) => b.qtyOnHand > 0 && b.flag === 'DEAD STOCK').length;
  const deadStockValue = enrichedBatches
    .filter((b) => b.qtyOnHand > 0 && b.flag === 'DEAD STOCK')
    .reduce((acc, b) => acc + b.valueStuck, 0);

  const expiryRiskCount = enrichedBatches.filter((b) => b.qtyOnHand > 0 && b.flag === 'EXPIRY RISK').length;
  const slowMovingCount = enrichedBatches.filter((b) => b.qtyOnHand > 0 && b.flag === 'SLOW MOVING').length;
  const okCount = enrichedBatches.filter((b) => b.qtyOnHand > 0 && b.flag === 'OK').length;

  const openNegativeCount = negativeBalances.filter((n) => n.status === 'OPEN').length;
  const totalNegativeUnits = negativeBalances
    .filter((n) => n.status === 'OPEN')
    .reduce((acc, n) => acc + (n.negativeQty - n.clearedQty), 0);

  const totalPotentialLossRealized = negativeBalances.reduce((acc, n) => acc + (n.potentialLoss || 0), 0);

  // Helper for Flag Badge styling
  const renderFlagBadge = (flag: BatchFlag) => {
    switch (flag) {
      case 'DEAD STOCK':
        return (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-rose-950 text-rose-300 border border-rose-500/50 flex items-center justify-center gap-1 shadow-sm shadow-rose-950/40">
            <Skull className="w-3 h-3 text-rose-400" />
            DEAD STOCK
          </span>
        );
      case 'EXPIRY RISK':
        return (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-rose-950 text-rose-300 border border-rose-500/50 flex items-center justify-center gap-1 shadow-sm shadow-rose-950/40">
            <AlertOctagon className="w-3 h-3 text-rose-400" />
            EXPIRY RISK
          </span>
        );
      case 'SLOW MOVING':
        return (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-500/50 flex items-center justify-center gap-1 shadow-sm shadow-amber-950/40">
            <Clock className="w-3 h-3 text-amber-400" />
            SLOW MOVING
          </span>
        );
      case 'OK':
      default:
        return (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center justify-center gap-1 shadow-sm shadow-emerald-950/40">
            <Check className="w-3 h-3 text-emerald-400" />
            OK
          </span>
        );
    }
  };

  return (
    <div id="batch-tracking-view" className="space-y-6 animate-fadeIn">
      {/* Header & Sub-Tab Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">
                  Batch Ledger &amp; Days Covered Velocity
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[11px] font-bold border border-purple-500/30 font-mono">
                  FIFO &bull; 90D Velocity &bull; Dead Stock
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Calculates Days Covered = (Qty On Hand / Avg Daily Sales) &bull; Flags Dead Stock, Expiry Risk &amp; Slow Moving
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshData}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
              title="Refresh Batches"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh</span>
            </button>
            {onOpenGRN && (
              <button
                type="button"
                onClick={() => onOpenGRN()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-950/40 flex items-center gap-1.5"
              >
                <Package className="w-4 h-4" />
                <span>+ Receive New Batch (GRN)</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Inventory Health Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-800/60 border border-slate-700/70 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Dead Stock Alert</span>
              <Skull className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black text-rose-400 font-mono">
              {deadStockCount} <span className="text-xs font-normal text-slate-400">batches</span>
            </div>
            <p className="text-[11px] text-rose-300 font-mono mt-1">
              ${deadStockValue.toFixed(2)} capital stuck (&gt;90d 0 sales)
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/70 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Expiry Risk (&le; Days Covered)</span>
              <AlertOctagon className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black text-rose-400 font-mono">
              {expiryRiskCount} <span className="text-xs font-normal text-slate-400">batches</span>
            </div>
            <p className="text-[11px] text-rose-300 font-mono mt-1">
              Will expire before stock depletes
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/70 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Slow Moving (&gt;120d)</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400 font-mono">
              {slowMovingCount} <span className="text-xs font-normal text-slate-400">batches</span>
            </div>
            <p className="text-[11px] text-amber-300 font-mono mt-1">
              Low velocity inventory
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/70 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Healthy Batches (OK)</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {okCount} <span className="text-xs font-normal text-slate-400">/ {activeBatchesCount}</span>
            </div>
            <p className="text-[11px] text-emerald-300 font-mono mt-1">
              ${totalBatchValuation.toFixed(2)} total active valuation
            </p>
          </div>
        </div>

        {/* Sub-Tab Selector */}
        <div className="flex items-center gap-2 border-b border-slate-800 pt-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('batches')}
            className={`px-4 py-2.5 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
              activeSubTab === 'batches'
                ? 'border-purple-500 text-purple-300 bg-purple-500/10 rounded-t-xl'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Batch Ledger (Days Covered &amp; FIFO)</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono">
              {filteredBatches.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('negative_balances')}
            className={`px-4 py-2.5 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
              activeSubTab === 'negative_balances'
                ? 'border-rose-500 text-rose-300 bg-rose-500/10 rounded-t-xl'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            <span>Negative Balances</span>
            {openNegativeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                {openNegativeCount} Open
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('fraud_loss_audit')}
            className={`px-4 py-2.5 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
              activeSubTab === 'fraud_loss_audit'
                ? 'border-amber-500 text-amber-300 bg-amber-500/10 rounded-t-xl'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Fraud / Loss &amp; Audit Log</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono">
              {auditLogs.length}
            </span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar with Explicit Filter 1, 2, 3 Buttons */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by product code, name, batch number, or supplier..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <select
            value={selectedProductFilter}
            onChange={(e) => setSelectedProductFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="ALL">All Products</option>
            {inventoryItems.map((item) => (
              <option key={item.itemId} value={item.itemId}>
                {item.itemName} ({item.itemId})
              </option>
            ))}
          </select>
        </div>

        {activeSubTab === 'batches' && (
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                statusFilter === 'ALL' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              All Batches
            </button>

            {/* Filter 1: Show Only DEAD STOCK */}
            <button
              type="button"
              onClick={() => setStatusFilter('DEAD_STOCK')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                statusFilter === 'DEAD_STOCK'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-rose-300 hover:bg-rose-950/40'
              }`}
            >
              <Skull className="w-3.5 h-3.5" />
              <span>DEAD STOCK ({deadStockCount})</span>
            </button>

            {/* Filter 2: Show Only EXPIRY RISK */}
            <button
              type="button"
              onClick={() => setStatusFilter('EXPIRY_RISK')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                statusFilter === 'EXPIRY_RISK'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-rose-300 hover:bg-rose-950/40'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>EXPIRY RISK ({expiryRiskCount})</span>
            </button>

            {/* Filter 3: Show Only SLOW MOVING */}
            <button
              type="button"
              onClick={() => setStatusFilter('SLOW_MOVING')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                statusFilter === 'SLOW_MOVING'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-300 hover:bg-amber-950/40'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>SLOW MOVING ({slowMovingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('OK')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                statusFilter === 'OK'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-300 hover:bg-emerald-950/40'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>OK ({okCount})</span>
            </button>
          </div>
        )}
      </div>

      {/* SUB-TAB 1: Batch Ledger with 14 Mandatory Columns & Days Covered Sort */}
      {activeSubTab === 'batches' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-4 bg-slate-850 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Batch Ledger (Sorted by Days Covered DESC)
              </h3>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-3 font-mono">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span> Red = Dead Stock / Expiry Risk
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span> Orange = Slow Moving (&gt;120d)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span> Green = OK (&le;60d)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 text-slate-300 font-semibold border-b border-slate-800 divide-x divide-slate-800/60">
                  {/* Column 1: Product Code */}
                  <th
                    className="py-3 px-3 min-w-[110px] cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('itemId')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Product Code</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 2: Product Name */}
                  <th
                    className="py-3 px-3 min-w-[180px] cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('itemName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Product Name</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 3: Batch No */}
                  <th
                    className="py-3 px-3 min-w-[130px] cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('batchNumber')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Batch No</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 4: Expiry Date */}
                  <th
                    className="py-3 px-2 min-w-[110px] text-center cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('expiryDate')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Expiry Date</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 5: Received Date */}
                  <th
                    className="py-3 px-2 min-w-[110px] text-center cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('receivedDate')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Received Date</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 6: Age in Days */}
                  <th
                    className="py-3 px-2 min-w-[95px] text-right cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('ageInDays')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Age in Days</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 7: Qty On Hand */}
                  <th
                    className="py-3 px-3 min-w-[100px] text-right font-extrabold text-emerald-400 bg-slate-900 cursor-pointer hover:bg-slate-850 transition"
                    onClick={() => handleSort('qtyOnHand')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Qty On Hand</span>
                      <ArrowUpDown className="w-3 h-3 text-emerald-400" />
                    </div>
                  </th>

                  {/* Column 8: Avg Daily Sales */}
                  <th
                    className="py-3 px-2 min-w-[110px] text-right cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('avgDailySales')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Avg Daily Sales</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 9: Days Covered (DEFAULT SORT) */}
                  <th
                    className="py-3 px-3 min-w-[115px] text-right bg-purple-950/40 text-purple-300 font-extrabold cursor-pointer hover:bg-purple-950/60 transition"
                    onClick={() => handleSort('daysCovered')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Days Covered</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-300" />
                    </div>
                  </th>

                  {/* Column 10: Last Cost */}
                  <th
                    className="py-3 px-2 min-w-[90px] text-right cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('lastCost')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Last Cost</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 11: Value Stuck */}
                  <th
                    className="py-3 px-2 min-w-[105px] text-right cursor-pointer hover:bg-slate-900 transition font-bold"
                    onClick={() => handleSort('valueStuck')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Value Stuck</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 12: Last Sale Date */}
                  <th
                    className="py-3 px-2 min-w-[110px] text-center cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('lastSaleDate')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Last Sale Date</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 13: Qty Sold Last 90 Days */}
                  <th
                    className="py-3 px-2 min-w-[125px] text-right cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('qtySoldLast90Days')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Sold (90 Days)</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>

                  {/* Column 14: Flag */}
                  <th
                    className="py-3 px-3 min-w-[135px] text-center cursor-pointer hover:bg-slate-900 transition"
                    onClick={() => handleSort('flag')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Flag</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-slate-400 font-sans">
                      <Layers className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                      <p className="font-semibold text-white">No batches found matching filter criteria.</p>
                      <p className="text-xs text-slate-500 mt-1">Adjust search or filters above to see inventory records.</p>
                    </td>
                  </tr>
                ) : (
                  filteredBatches.map((batch, index) => {
                    const isDepleted = batch.qtyOnHand === 0;

                    // Row background color based on flag:
                    // Red = DEAD STOCK or EXPIRY RISK
                    // Orange = SLOW MOVING
                    // Green = OK
                    let rowBgClass = 'hover:bg-slate-800/60';
                    if (batch.flag === 'DEAD STOCK' || batch.flag === 'EXPIRY RISK') {
                      rowBgClass = 'bg-rose-950/20 hover:bg-rose-950/40 border-l-2 border-l-rose-500';
                    } else if (batch.flag === 'SLOW MOVING') {
                      rowBgClass = 'bg-amber-950/15 hover:bg-amber-950/35 border-l-2 border-l-amber-500';
                    } else {
                      rowBgClass = 'bg-emerald-950/10 hover:bg-emerald-950/25';
                    }

                    if (isDepleted) {
                      rowBgClass += ' opacity-50 bg-slate-950/40';
                    }

                    return (
                      <tr
                        key={batch.id}
                        className={`transition-colors divide-x divide-slate-800/40 ${rowBgClass}`}
                      >
                        {/* 1. Product Code */}
                        <td className="py-2.5 px-3 font-bold text-slate-300">
                          {batch.itemId}
                        </td>

                        {/* 2. Product Name */}
                        <td className="py-2.5 px-3 font-sans font-medium text-white">
                          <div className="truncate max-w-[200px]" title={batch.itemName}>
                            {batch.itemName}
                          </div>
                        </td>

                        {/* 3. Batch No */}
                        <td className="py-2.5 px-3 font-bold text-purple-300">
                          {batch.batchNumber || batch.id}
                        </td>

                        {/* 4. Expiry Date */}
                        <td className="py-2.5 px-2 text-center">
                          {batch.expiryDate ? (
                            <div>
                              <span
                                className={`${
                                  batch.daysToExpiry !== null && batch.daysToExpiry <= 0
                                    ? 'text-rose-400 font-bold'
                                    : batch.daysToExpiry !== null && batch.daysToExpiry <= 30
                                    ? 'text-amber-400 font-bold'
                                    : 'text-slate-300'
                                }`}
                              >
                                {batch.expiryDate}
                              </span>
                              {batch.daysToExpiry !== null && (
                                <div className="text-[10px] text-slate-500 font-sans">
                                  {batch.daysToExpiry < 0 ? `(${Math.abs(batch.daysToExpiry)}d ago)` : `(in ${batch.daysToExpiry}d)`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600 font-sans">No Expiry</span>
                          )}
                        </td>

                        {/* 5. Received Date */}
                        <td className="py-2.5 px-2 text-center text-slate-300">
                          {batch.receivedDate}
                        </td>

                        {/* 6. Age in Days */}
                        <td className="py-2.5 px-2 text-right">
                          <span
                            className={`font-bold ${
                              batch.ageInDays > 90
                                ? 'text-rose-400'
                                : batch.ageInDays > 45
                                ? 'text-amber-300'
                                : 'text-slate-300'
                            }`}
                          >
                            {batch.ageInDays}d
                          </span>
                        </td>

                        {/* 7. Qty On Hand */}
                        <td className="py-2.5 px-3 text-right font-extrabold text-emerald-400 bg-slate-950/40 text-sm">
                          {batch.qtyOnHand}
                        </td>

                        {/* 8. Avg Daily Sales */}
                        <td className="py-2.5 px-2 text-right text-slate-300">
                          {batch.avgDailySales.toFixed(2)}
                        </td>

                        {/* 9. Days Covered */}
                        <td className="py-2.5 px-3 text-right font-black bg-purple-950/20">
                          <span
                            className={`text-sm ${
                              batch.daysCovered >= 999
                                ? 'text-rose-400'
                                : batch.daysCovered > 120
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {batch.daysCovered === 999 ? '999+' : `${batch.daysCovered}d`}
                          </span>
                        </td>

                        {/* 10. Last Cost */}
                        <td className="py-2.5 px-2 text-right text-slate-300">
                          ${batch.lastCost.toFixed(2)}
                        </td>

                        {/* 11. Value Stuck */}
                        <td className="py-2.5 px-2 text-right font-bold text-white">
                          <span className={batch.flag === 'DEAD STOCK' ? 'text-rose-400' : ''}>
                            ${batch.valueStuck.toFixed(2)}
                          </span>
                        </td>

                        {/* 12. Last Sale Date */}
                        <td className="py-2.5 px-2 text-center text-slate-300 text-[11px]">
                          {batch.lastSaleDate || <span className="text-slate-600 font-sans">No Sales</span>}
                        </td>

                        {/* 13. Qty Sold Last 90 Days */}
                        <td className="py-2.5 px-2 text-right text-slate-300 font-bold">
                          {batch.qtySoldLast90Days}
                        </td>

                        {/* 14. Flag */}
                        <td className="py-2.5 px-3 text-center">
                          {renderFlagBadge(batch.flag)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Negative Balances Tracker */}
      {activeSubTab === 'negative_balances' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-rose-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Negative Stock Sales &amp; Auto-Clearing Tracker (Core Rule 2)
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              Automatically cleared by the next received goods batch (FIFO)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 text-slate-300 font-semibold border-b border-slate-800 divide-x divide-slate-800/60">
                  <th className="py-3 px-3 min-w-[120px]">Entry ID</th>
                  <th className="py-3 px-3 min-w-[180px]">Product</th>
                  <th className="py-3 px-2 min-w-[95px] text-right text-rose-400">Negative Qty</th>
                  <th className="py-3 px-2 min-w-[95px] text-right text-emerald-400">Cleared Qty</th>
                  <th className="py-3 px-2 min-w-[95px] text-right text-amber-300">Remaining</th>
                  <th className="py-3 px-2 min-w-[85px] text-right">Sale Cost</th>
                  <th className="py-3 px-2 min-w-[85px] text-right">New GRN Cost</th>
                  <th className="py-3 px-2 min-w-[100px] text-right font-bold text-amber-400">Potential Loss</th>
                  <th className="py-3 px-2 min-w-[100px] text-center">Sale Date</th>
                  <th className="py-3 px-3 min-w-[120px]">Sold By</th>
                  <th className="py-3 px-2 min-w-[90px] text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredNegativeBalances.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400 font-sans">
                      <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                      <p className="font-semibold text-white">No negative balance sales recorded.</p>
                      <p className="text-xs text-slate-500 mt-1">All sales were fulfilled from positive batches on hand.</p>
                    </td>
                  </tr>
                ) : (
                  filteredNegativeBalances.map((neg) => {
                    const remaining = neg.negativeQty - neg.clearedQty;
                    const isOpen = neg.status === 'OPEN';

                    return (
                      <tr
                        key={neg.id}
                        className={`hover:bg-slate-800/60 transition-colors divide-x divide-slate-800/40 ${
                          isOpen ? 'bg-rose-950/10' : 'bg-slate-900/80 opacity-70'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-slate-300">
                          {neg.id}
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-semibold text-white">{neg.itemName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{neg.itemId}</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-rose-400">
                          -{neg.negativeQty}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-emerald-400">
                          {neg.clearedQty}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-amber-300">
                          {remaining}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-400">
                          ${(neg.saleCost || 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-300">
                          {neg.newCostAtClearing ? `$${neg.newCostAtClearing.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-amber-400">
                          {neg.potentialLoss && neg.potentialLoss > 0 ? `$${neg.potentialLoss.toFixed(2)}` : '$0.00'}
                        </td>
                        <td className="py-2.5 px-2 text-center text-slate-300">
                          {neg.saleDate}
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-medium text-slate-300">{neg.soldByName || neg.soldBy}</div>
                          {neg.saleInvoiceId && (
                            <div className="text-[10px] text-slate-500 font-mono">{neg.saleInvoiceId}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center font-sans">
                          {isOpen ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/30">
                              OPEN ({remaining} un)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                              CLEARED
                            </span>
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
      )}

      {/* SUB-TAB 3: Fraud / Loss & Audit Log */}
      {activeSubTab === 'fraud_loss_audit' && (
        <div className="space-y-6">
          {/* Potential Loss Overview Alert */}
          <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-5 shadow-xl">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Core Rule 3: Fraud &amp; Loss Detection Protocol</span>
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Active Monitoring
                  </span>
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  When stock is sold in a negative state and later fulfilled by a Goods Receiving shipment with a higher purchase cost, the price difference is logged as a <strong>Realized Stock Loss</strong>. All master price and cost changes require reasons and are tracked with previous values, new values, user roles, and percentage variances.
                </p>
              </div>
            </div>
          </div>

          {/* Audit Log Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Audit Trail: Price / Cost Changes &amp; Negative Authorizations
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                {auditLogs.length} audit entries recorded
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-300 font-semibold border-b border-slate-800 divide-x divide-slate-800/60">
                    <th className="py-3 px-3 min-w-[120px]">Audit TXN</th>
                    <th className="py-3 px-3 min-w-[180px]">Product</th>
                    <th className="py-3 px-2 min-w-[110px] text-center">Event Type</th>
                    <th className="py-3 px-2 min-w-[85px] text-right">Old Value</th>
                    <th className="py-3 px-2 min-w-[85px] text-right">New Value</th>
                    <th className="py-3 px-2 min-w-[85px] text-center">% Variance</th>
                    <th className="py-3 px-3 min-w-[200px]">Reason / Authorization Note</th>
                    <th className="py-3 px-3 min-w-[120px]">Staff Officer</th>
                    <th className="py-3 px-2 min-w-[100px] text-center">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-sans">
                        <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                        <p className="font-semibold text-white">Audit trail clean.</p>
                        <p className="text-xs text-slate-500 mt-1">No anomalous price changes or negative sale incidents detected.</p>
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => {
                      const isPriceChange = log.txnType === 'PRICE_CHANGE' || log.movementType === 'PRICE_CHANGE';
                      const isCostChange = log.txnType === 'COST_CHANGE' || log.movementType === 'COST_CHANGE';
                      const isNeg = Boolean(log.isNegativeSale);

                      return (
                        <tr
                          key={log.txnId}
                          className="hover:bg-slate-800/60 transition-colors divide-x divide-slate-800/40 bg-slate-900/80"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-300">
                            {log.txnId}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <div className="font-semibold text-white">{log.itemName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{log.itemId}</div>
                          </td>
                          <td className="py-2.5 px-2 text-center font-sans">
                            {isPriceChange ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-500/30">
                                Price Change
                              </span>
                            ) : isCostChange ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-500/30">
                                Cost Change
                              </span>
                            ) : isNeg ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/30">
                                Negative Sale
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                                {log.txnType}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right text-slate-400">
                            {log.oldValue !== undefined ? `$${log.oldValue.toFixed(2)}` : '-'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold text-white">
                            {log.newValue !== undefined ? `$${log.newValue.toFixed(2)}` : '-'}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {log.percentChange !== undefined ? (
                              <span
                                className={`text-[11px] font-bold ${
                                  log.percentChange > 0
                                    ? 'text-emerald-400'
                                    : log.percentChange < 0
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {log.percentChange > 0 ? `+${log.percentChange}%` : `${log.percentChange}%`}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 italic text-xs font-sans">
                            {log.reason || log.promptShown || 'Standard adjustment'}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <div className="font-medium text-slate-200">{log.staffName || log.staffId}</div>
                            {log.userRole && (
                              <div className="text-[10px] text-slate-500 font-mono">{log.userRole}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-400 text-[11px]">
                            {log.date}
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
    </div>
  );
};

