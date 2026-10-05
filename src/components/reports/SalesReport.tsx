import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, SaleInvoice, Product, InventoryItem } from '../../types';
import {
  getSales,
  getProducts,
  getInventoryItems,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import { useScrollDirection } from '../../hooks/useScrollDirection';
import {
  TrendingUp,
  DollarSign,
  Package,
  Boxes,
  Calendar,
  Search,
  Filter,
  ArrowUpDown,
  Download,
  Printer,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Award,
  BarChart3,
  Percent,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface SalesReportProps {
  currentUser?: Salesperson | null;
  onNavigateToPOS?: () => void;
  onNavigateToInventory?: () => void;
  onClose?: () => void;
}

type DateRangeFilter =
  | 'today'
  | 'yesterday'
  | 'nextday'
  | 'this_month'
  | 'last_month'
  | '7days'
  | '30days'
  | 'custom'
  | 'all';

type CostBasisMode = 'dual' | 'average' | 'latest';

interface ProductSalesStat {
  id: string;
  name: string;
  sku: string;
  category: string;
  unitsSold: number;
  totalRevenue: number;

  // Line 1: Average Cost Basis (AVCO)
  totalCostAvg: number;
  grossProfitAvg: number;
  profitMarginPercentAvg: number;

  // Line 2: Latest Purchase Price Basis
  totalCostLatest: number;
  grossProfitLatest: number;
  profitMarginPercentLatest: number;

  // Backward-compat aliases
  totalCost: number;
  grossProfit: number;
  profitMarginPercent: number;

  currentStock: number;
  stockStatus: 'Out of Stock' | 'Low Stock' | 'In Stock';
}

export const SalesReport: React.FC<SalesReportProps> = ({
  currentUser,
  onNavigateToPOS,
  onNavigateToInventory,
  onClose,
}) => {
  const [sales, setSales] = useState<SaleInvoice[]>(() => getSales());
  const [products, setProducts] = useState<Product[]>(() => getProducts());
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => getInventoryItems());

  // Default date MUST BE TODAY
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>('today');
  const [costBasisMode, setCostBasisMode] = useState<CostBasisMode>('dual');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'revenue' | 'profit_avg' | 'profit_latest' | 'quantity' | 'margin_avg'>('profit_avg');

  // Custom date selection state
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [activeDateCursor, setActiveDateCursor] = useState<string>(todayStr);
  const [customStartDate, setCustomStartDate] = useState<string>(todayStr);
  const [customEndDate, setCustomEndDate] = useState<string>(todayStr);

  // Smart scroll: hide controls on scroll down, slide down and freeze on scroll up
  const { isVisible: isSearchVisible, isAtTop, forceReveal } = useScrollDirection({ threshold: 12 });

  // Real-time synchronization with Room Database
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setSales(getSales());
      setProducts(getProducts());
      setInventoryItems(getInventoryItems());
    });
    return () => unsub();
  }, []);

  // Filter sales by date range
  const filteredSales = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const tomorrowStart = todayStart + 86400000;

    return sales.filter((s) => {
      if (s.status === 'Refunded') return false;
      const saleDateStr = s.date || (s.timestamp ? new Date(s.timestamp).toISOString().split('T')[0] : '');
      const saleTime = new Date(s.timestamp || (s.date + 'T12:00:00')).getTime();

      switch (dateFilter) {
        case 'today':
          return saleDateStr === todayStr || (saleTime >= todayStart && saleTime < tomorrowStart);

        case 'yesterday': {
          const yDate = new Date();
          yDate.setDate(yDate.getDate() - 1);
          const yStr = yDate.toISOString().split('T')[0];
          return saleDateStr === yStr || (saleTime >= yesterdayStart && saleTime < todayStart);
        }

        case 'nextday': {
          const nDate = new Date();
          nDate.setDate(nDate.getDate() + 1);
          const nStr = nDate.toISOString().split('T')[0];
          return saleDateStr === nStr || (saleTime >= tomorrowStart && saleTime < tomorrowStart + 86400000);
        }

        case 'this_month': {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          return saleTime >= monthStart;
        }

        case 'last_month': {
          const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
          const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          return saleTime >= prevMonthStart && saleTime < thisMonthStart;
        }

        case '7days':
          return saleTime >= now.getTime() - 7 * 86400000;

        case '30days':
          return saleTime >= now.getTime() - 30 * 86400000;

        case 'custom': {
          const s = customStartDate || '1970-01-01';
          const e = customEndDate || '2099-12-31';
          return saleDateStr >= s && saleDateStr <= e;
        }

        case 'all':
        default:
          return true;
      }
    });
  }, [sales, dateFilter, todayStr, customStartDate, customEndDate]);

  // Handle Day Stepping (Previous Day / Next Day)
  const handleStepDay = (delta: -1 | 1) => {
    const cur = new Date(activeDateCursor + 'T12:00:00');
    cur.setDate(cur.getDate() + delta);
    const newStr = cur.toISOString().split('T')[0];
    setActiveDateCursor(newStr);
    setCustomStartDate(newStr);
    setCustomEndDate(newStr);
    setDateFilter('custom');
  };

  // Aggregate Product Performance with Dual Costing (AVCO vs Latest Price)
  const {
    productStats,
    totalRevenue,
    totalCostAvg,
    totalGrossProfitAvg,
    overallMarginAvg,
    totalCostLatest,
    totalGrossProfitLatest,
    overallMarginLatest,
    totalUnitsSold,
    categories,
  } = useMemo(() => {
    const avgCostMap = new Map<string, number>();
    const latestCostMap = new Map<string, number>();
    const stockMap = new Map<string, { stock: number; reorder: number; sku: string; category: string }>();

    // 1. Build lookup maps from live inventory items
    inventoryItems.forEach((inv) => {
      const idKey = (inv.itemId || '').trim().toUpperCase();
      const nameKey = (inv.itemName || '').trim().toLowerCase();
      const avgCost = inv.averageCostPerUnit !== undefined && inv.averageCostPerUnit > 0
        ? inv.averageCostPerUnit
        : (inv.costPerUnit || 0);
      const latestCost = inv.latestCostPerUnit !== undefined && inv.latestCostPerUnit > 0
        ? inv.latestCostPerUnit
        : (inv.costPerUnit || 0);

      if (idKey) {
        avgCostMap.set(idKey, avgCost);
        latestCostMap.set(idKey, latestCost);
      }
      if (nameKey) {
        avgCostMap.set(nameKey, avgCost);
        latestCostMap.set(nameKey, latestCost);
      }
      stockMap.set(idKey, {
        stock: inv.totalUnits ?? 0,
        reorder: inv.reorderLevelUnits ?? 5,
        sku: inv.sku || inv.itemId,
        category: inv.category || 'General',
      });
    });

    // Also index products
    products.forEach((p) => {
      const pId = (p.id || '').trim().toUpperCase();
      const pName = (p.name || '').trim().toLowerCase();
      const cost = p.costPrice || p.costPerUnit || 0;
      if (pId && !avgCostMap.has(pId)) {
        avgCostMap.set(pId, p.averageCostPerUnit ?? cost);
        latestCostMap.set(pId, p.latestCostPerUnit ?? cost);
      }
      if (pName && !avgCostMap.has(pName)) {
        avgCostMap.set(pName, p.averageCostPerUnit ?? cost);
        latestCostMap.set(pName, p.latestCostPerUnit ?? cost);
      }
    });

    const statMap = new Map<string, ProductSalesStat>();
    const categorySet = new Set<string>();

    filteredSales.forEach((sale) => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((item) => {
          const key = (item.id || item.name || 'Unknown').trim();
          const idUpper = (item.id || '').trim().toUpperCase();
          const nameLower = (item.name || '').trim().toLowerCase();

          // Cost Resolution: Check sale snapshot first -> inventory map -> fallback unitPrice * 0.7
          const matchedAvgCost =
            item.costPerUnitAverage !== undefined && item.costPerUnitAverage >= 0
              ? item.costPerUnitAverage
              : avgCostMap.get(idUpper) ?? (nameLower ? avgCostMap.get(nameLower) : undefined) ?? (item.unitPrice * 0.7);

          const matchedLatestCost =
            item.costPerUnitLatest !== undefined && item.costPerUnitLatest >= 0
              ? item.costPerUnitLatest
              : latestCostMap.get(idUpper) ?? (nameLower ? latestCostMap.get(nameLower) : undefined) ?? (item.unitPrice * 0.7);

          const stockInfo = stockMap.get(idUpper);
          const itemCat = item.category || stockInfo?.category || 'General';
          categorySet.add(itemCat);

          const itemQty = Number(item.quantity) || 0;
          const itemRevenue = Number(item.total) || (itemQty * item.unitPrice);

          const itemCostAvg = itemQty * matchedAvgCost;
          const itemProfitAvg = itemRevenue - itemCostAvg;

          const itemCostLatest = itemQty * matchedLatestCost;
          const itemProfitLatest = itemRevenue - itemCostLatest;

          const existing = statMap.get(key);
          if (existing) {
            existing.unitsSold += itemQty;
            existing.totalRevenue += itemRevenue;

            existing.totalCostAvg += itemCostAvg;
            existing.grossProfitAvg += itemProfitAvg;
            existing.profitMarginPercentAvg = existing.totalRevenue > 0
              ? (existing.grossProfitAvg / existing.totalRevenue) * 100
              : 0;

            existing.totalCostLatest += itemCostLatest;
            existing.grossProfitLatest += itemProfitLatest;
            existing.profitMarginPercentLatest = existing.totalRevenue > 0
              ? (existing.grossProfitLatest / existing.totalRevenue) * 100
              : 0;

            existing.totalCost = existing.totalCostAvg;
            existing.grossProfit = existing.grossProfitAvg;
            existing.profitMarginPercent = existing.profitMarginPercentAvg;
          } else {
            const currentStock = stockInfo?.stock ?? 0;
            const reorder = stockInfo?.reorder ?? 5;
            let stockStatus: 'Out of Stock' | 'Low Stock' | 'In Stock' = 'In Stock';
            if (currentStock <= 0) stockStatus = 'Out of Stock';
            else if (currentStock <= reorder) stockStatus = 'Low Stock';

            const profitMarginAvg = itemRevenue > 0 ? (itemProfitAvg / itemRevenue) * 100 : 0;
            const profitMarginLatest = itemRevenue > 0 ? (itemProfitLatest / itemRevenue) * 100 : 0;

            statMap.set(key, {
              id: item.id || key,
              name: item.name || 'Unknown Item',
              sku: stockInfo?.sku || item.sku || (item.id ? String(item.id).substring(0, 8) : 'N/A'),
              category: itemCat,
              unitsSold: itemQty,
              totalRevenue: itemRevenue,

              totalCostAvg: itemCostAvg,
              grossProfitAvg: itemProfitAvg,
              profitMarginPercentAvg: profitMarginAvg,

              totalCostLatest: itemCostLatest,
              grossProfitLatest: itemProfitLatest,
              profitMarginPercentLatest: profitMarginLatest,

              totalCost: itemCostAvg,
              grossProfit: itemProfitAvg,
              profitMarginPercent: profitMarginAvg,

              currentStock,
              stockStatus,
            });
          }
        });
      }
    });

    const stats = Array.from(statMap.values());

    let rev = 0;
    let costAvg = 0;
    let profitAvg = 0;
    let costLatest = 0;
    let profitLatest = 0;
    let units = 0;

    stats.forEach((s) => {
      rev += s.totalRevenue;
      costAvg += s.totalCostAvg;
      profitAvg += s.grossProfitAvg;
      costLatest += s.totalCostLatest;
      profitLatest += s.grossProfitLatest;
      units += s.unitsSold;
    });

    const marginAvg = rev > 0 ? (profitAvg / rev) * 100 : 0;
    const marginLatest = rev > 0 ? (profitLatest / rev) * 100 : 0;

    return {
      productStats: stats,
      totalRevenue: rev,
      totalCostAvg: costAvg,
      totalGrossProfitAvg: profitAvg,
      overallMarginAvg: marginAvg,
      totalCostLatest: costLatest,
      totalGrossProfitLatest: profitLatest,
      overallMarginLatest: marginLatest,
      totalUnitsSold: units,
      categories: Array.from(categorySet).sort(),
    };
  }, [filteredSales, inventoryItems, products]);

  // Filtered & Sorted Product Stats
  const displayedProducts = useMemo(() => {
    let list = productStats;

    if (selectedCategory !== 'all') {
      list = list.filter((p) => p.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'revenue':
          return b.totalRevenue - a.totalRevenue;
        case 'profit_avg':
          return b.grossProfitAvg - a.grossProfitAvg;
        case 'profit_latest':
          return b.grossProfitLatest - a.grossProfitLatest;
        case 'quantity':
          return b.unitsSold - a.unitsSold;
        case 'margin_avg':
          return b.profitMarginPercentAvg - a.profitMarginPercentAvg;
        default:
          return b.grossProfitAvg - a.grossProfitAvg;
      }
    });
  }, [productStats, selectedCategory, searchQuery, sortBy]);

  // Top products
  const topRevenueProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
  }, [productStats]);

  const topProfitProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.grossProfitAvg - a.grossProfitAvg)[0];
  }, [productStats]);

  const fastestProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.unitsSold - a.unitsSold)[0];
  }, [productStats]);

  const handleExportCSV = () => {
    const headers = [
      'Product Name',
      'SKU',
      'Category',
      'Units Sold',
      'Revenue ($)',
      'Avg Cost Basis ($)',
      'Gross Profit Avg ($)',
      'Margin Avg (%)',
      'Latest Cost Basis ($)',
      'Gross Profit Latest ($)',
      'Margin Latest (%)',
      'Stock on Hand',
      'Stock Status',
    ];

    const rows = displayedProducts.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      p.sku,
      p.category,
      p.unitsSold,
      p.totalRevenue.toFixed(2),
      p.totalCostAvg.toFixed(2),
      p.grossProfitAvg.toFixed(2),
      p.profitMarginPercentAvg.toFixed(1),
      p.totalCostLatest.toFixed(2),
      p.grossProfitLatest.toFixed(2),
      p.profitMarginPercentLatest.toFixed(1),
      p.currentStock,
      p.stockStatus,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sales_profit_report_${dateFilter}_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div id="sales-profit-report-screen" className="max-w-7xl mx-auto space-y-4 pb-28 select-none animate-fadeIn">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/70 to-slate-900 border border-indigo-500/30 rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-emerald-500 flex items-center justify-center text-white shadow-lg shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  Sales, Profit &amp; Top Stocks Report
                </h1>
                <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/30">
                  Real-time Analytics
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-xl">
                Comprehensive sales velocity, revenue and gross profit metrics comparing Weighted Average Cost (AVCO) against Latest Replacement Price.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {onNavigateToPOS && (
              <button
                type="button"
                onClick={onNavigateToPOS}
                className="px-4 py-2 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white rounded-2xl text-xs font-bold shadow hover:brightness-110 active:scale-95 transition"
              >
                + POS Register
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-2xl border border-slate-700 transition"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Date Filter & Day-by-Day Stepper Controls */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          {/* Day Stepper + Quick Presets */}
          <div className="flex items-center flex-wrap gap-1.5">
            {/* Previous Day Stepper */}
            <button
              type="button"
              id="btn-report-prev-day"
              onClick={() => handleStepDay(-1)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition flex items-center gap-1 active:scale-95"
              title="Step to Previous Day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev Day</span>
            </button>

            {/* Presets */}
            <button
              type="button"
              id="btn-filter-today"
              onClick={() => {
                setDateFilter('today');
                setActiveDateCursor(todayStr);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === 'today'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Today (Default)
            </button>

            <button
              type="button"
              id="btn-filter-yesterday"
              onClick={() => {
                setDateFilter('yesterday');
                const y = new Date();
                y.setDate(y.getDate() - 1);
                setActiveDateCursor(y.toISOString().split('T')[0]);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === 'yesterday'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Yesterday
            </button>

            {/* Next Day Stepper */}
            <button
              type="button"
              id="btn-report-next-day"
              onClick={() => handleStepDay(1)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition flex items-center gap-1 active:scale-95"
              title="Step to Next Day"
            >
              <span>Next Day</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              id="btn-filter-last-month"
              onClick={() => setDateFilter('last_month')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === 'last_month'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Last Month
            </button>

            <button
              type="button"
              id="btn-filter-this-month"
              onClick={() => setDateFilter('this_month')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === 'this_month'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              This Month
            </button>

            <button
              type="button"
              id="btn-filter-all"
              onClick={() => setDateFilter('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === 'all'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Select Between Dates Picker */}
          <div className="flex items-center gap-2 bg-slate-950/90 border border-slate-800 p-1.5 rounded-2xl">
            <Calendar className="w-3.5 h-3.5 text-indigo-400 ml-1.5 shrink-0" />
            <span className="text-[10px] text-slate-400 font-bold uppercase hidden sm:inline">Between Dates:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => {
                setCustomStartDate(e.target.value);
                setDateFilter('custom');
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
            />
            <span className="text-slate-500 text-xs">to</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => {
                setCustomEndDate(e.target.value);
                setDateFilter('custom');
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards: Revenue, Dual Profit (Avg Cost vs Latest Price), and Units / Ticket */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Sales Revenue */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Sales Revenue</span>
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black text-white font-mono">
              ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {filteredSales.length} Invoices • {totalUnitsSold} Units Sold
            </p>
          </div>
        </div>

        {/* LINE 1: Profit based on Weighted Average Cost (AVCO) */}
        <div className="bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-900 border-2 border-indigo-500/50 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">Gross Profit (Avg Cost)</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/30 text-indigo-200">
                Line 1 • AVCO
              </span>
            </div>
            <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                ${totalGrossProfitAvg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <span className="text-xs font-mono font-bold text-indigo-300">
                ({overallMarginAvg.toFixed(1)}% margin)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Weighted blended acquisition cost: ${totalCostAvg.toFixed(2)}
            </p>
          </div>
        </div>

        {/* LINE 2: Profit based on Latest Price / Replacement Cost */}
        <div className="bg-gradient-to-br from-slate-900 to-purple-950/50 border border-purple-500/40 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">Profit (Latest Price)</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-500/25 text-purple-200">
                Line 2 • Replacement
              </span>
            </div>
            <span className="p-2 rounded-xl bg-purple-500/20 text-purple-300">
              <Percent className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
                ${totalGrossProfitLatest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <span className="text-xs font-mono font-bold text-purple-300">
                ({overallMarginLatest.toFixed(1)}% margin)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              If replaced at last purchase cost: ${totalCostLatest.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Units & Average Basket Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Average Basket / Units</span>
            <span className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <BarChart3 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black font-mono text-cyan-300">
              ${filteredSales.length > 0 ? (totalRevenue / filteredSales.length).toFixed(2) : '0.00'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Avg ticket • {totalUnitsSold} total units fulfilled
            </p>
          </div>
        </div>
      </div>

      {/* Highlights Banner: Fastest Line & Top Profit Line */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {topRevenueProduct && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-400 shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Top Revenue Leader</span>
                <span className="text-[11px] font-mono font-bold text-amber-300">
                  ${topRevenueProduct.totalRevenue.toFixed(2)}
                </span>
              </div>
              <h4 className="text-sm font-bold text-white truncate mt-0.5">
                {topRevenueProduct.name}
              </h4>
              <p className="text-[11px] text-slate-400">
                {topRevenueProduct.unitsSold} units sold • {topRevenueProduct.category}
              </p>
            </div>
          </div>
        )}

        {fastestProduct && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Fastest Moving Line</span>
                <span className="text-[11px] font-mono font-bold text-emerald-300">
                  {fastestProduct.unitsSold} Units
                </span>
              </div>
              <h4 className="text-sm font-bold text-white truncate mt-0.5">
                {fastestProduct.name}
              </h4>
              <p className="text-[11px] text-slate-400">
                ${fastestProduct.totalRevenue.toFixed(2)} revenue • Velocity leader
              </p>
            </div>
          </div>
        )}

        {topProfitProduct && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400 shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Top Profit Contributor</span>
                <span className="text-[11px] font-mono font-bold text-purple-300">
                  +${topProfitProduct.grossProfitAvg.toFixed(2)}
                </span>
              </div>
              <h4 className="text-sm font-bold text-white truncate mt-0.5">
                {topProfitProduct.name}
              </h4>
              <p className="text-[11px] text-slate-400">
                {topProfitProduct.profitMarginPercentAvg.toFixed(1)}% margin • {topProfitProduct.unitsSold} sold
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main Table Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        {/* Table Top Controls & Mode Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Product Performance Breakdown</h3>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs font-mono font-bold">
              {displayedProducts.length} Items
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* Cost Basis Mode Selector */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => setCostBasisMode('dual')}
                className={`px-3 py-1 rounded-lg transition ${costBasisMode === 'dual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Dual 2-Line View
              </button>
              <button
                type="button"
                onClick={() => setCostBasisMode('average')}
                className={`px-3 py-1 rounded-lg transition ${costBasisMode === 'average' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Avg Cost Only
              </button>
              <button
                type="button"
                onClick={() => setCostBasisMode('latest')}
                className={`px-3 py-1 rounded-lg transition ${costBasisMode === 'latest' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Latest Price Only
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 border border-slate-700"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5 text-slate-400" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Sticky Scroll Controls Bar */}
        <div
          className={`sticky top-0 z-20 transition-all duration-300 transform ${
            isSearchVisible
              ? 'translate-y-0 opacity-100'
              : '-translate-y-4 opacity-0 pointer-events-none'
          } bg-slate-900/95 backdrop-blur-md py-2.5 px-3 rounded-2xl border border-slate-800 shadow-xl`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search product or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full py-2 pl-9 pr-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 shadow-inner"
              />
            </div>

            {/* Category Filter */}
            <div className="relative">
              <Filter className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full py-2 pl-9 pr-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Sort Selector */}
            <div className="relative">
              <ArrowUpDown className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full py-2 pl-9 pr-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="profit_avg">Sort by Profit (Avg Cost Basis)</option>
                <option value="profit_latest">Sort by Profit (Latest Price Basis)</option>
                <option value="revenue">Sort by Revenue ($)</option>
                <option value="margin_avg">Sort by Margin (%)</option>
                <option value="quantity">Sort by Units Sold</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Table with Dual Costing Lines */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-3">Product / SKU</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Units Sold</th>
                <th className="py-3 px-3 text-right">Revenue ($)</th>

                {costBasisMode === 'dual' ? (
                  <>
                    <th className="py-3 px-3 text-right">
                      <span className="text-indigo-400">Line 1: Avg Cost Profit</span>
                      <div className="text-[9px] text-slate-500 normal-case font-normal font-sans">AVCO blended margin</div>
                    </th>
                    <th className="py-3 px-3 text-right">
                      <span className="text-purple-400">Line 2: Latest Price Profit</span>
                      <div className="text-[9px] text-slate-500 normal-case font-normal font-sans">Last purchase margin</div>
                    </th>
                  </>
                ) : costBasisMode === 'average' ? (
                  <>
                    <th className="py-3 px-3 text-right">Total Avg Cost ($)</th>
                    <th className="py-3 px-3 text-right">Gross Profit (Avg)</th>
                    <th className="py-3 px-3 text-right">Margin (%)</th>
                  </>
                ) : (
                  <>
                    <th className="py-3 px-3 text-right">Total Latest Cost ($)</th>
                    <th className="py-3 px-3 text-right">Gross Profit (Latest)</th>
                    <th className="py-3 px-3 text-right">Margin (%)</th>
                  </>
                )}

                <th className="py-3 px-3 text-center">Stock on Hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {displayedProducts.length === 0 ? (
                <tr>
                  <td colSpan={costBasisMode === 'dual' ? 7 : 7} className="py-12 text-center text-slate-500">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="font-bold text-slate-400">No product sales found for this period</p>
                    <p className="text-[11px] text-slate-500 mt-1">Try selecting a different date range or category.</p>
                  </td>
                </tr>
              ) : (
                displayedProducts.map((prod, prodIdx) => (
                  <tr key={`${prod.id}-${prodIdx}`} className="hover:bg-slate-800/40 transition">
                    {/* Name & SKU */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-white">{prod.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{prod.sku}</div>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3 text-slate-400">{prod.category}</td>

                    {/* Units Sold */}
                    <td className="py-3 px-3 text-right font-mono font-bold text-white">
                      {prod.unitsSold}
                    </td>

                    {/* Revenue */}
                    <td className="py-3 px-3 text-right font-mono font-bold text-white">
                      ${prod.totalRevenue.toFixed(2)}
                    </td>

                    {/* DUAL 2-LINE VIEW */}
                    {costBasisMode === 'dual' ? (
                      <>
                        {/* Line 1: Average Cost Profit & Margin */}
                        <td className="py-3 px-3 text-right font-mono">
                          <div className="font-bold text-emerald-400 flex items-center justify-end gap-1.5">
                            <span>+${prod.grossProfitAvg.toFixed(2)}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-sans">
                              {prod.profitMarginPercentAvg.toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Cost: ${prod.totalCostAvg.toFixed(2)}
                          </div>
                        </td>

                        {/* Line 2: Latest Price Profit & Margin */}
                        <td className="py-3 px-3 text-right font-mono">
                          <div className="font-bold text-amber-300 flex items-center justify-end gap-1.5">
                            <span>+${prod.grossProfitLatest.toFixed(2)}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-sans">
                              {prod.profitMarginPercentLatest.toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Cost: ${prod.totalCostLatest.toFixed(2)}
                          </div>
                        </td>
                      </>
                    ) : costBasisMode === 'average' ? (
                      <>
                        <td className="py-3 px-3 text-right font-mono text-slate-400">
                          ${prod.totalCostAvg.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">
                          +${prod.grossProfitAvg.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            prod.profitMarginPercentAvg >= 30
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : prod.profitMarginPercentAvg >= 15
                              ? 'bg-amber-500/10 text-amber-300'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {prod.profitMarginPercentAvg.toFixed(1)}%
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-3 text-right font-mono text-slate-400">
                          ${prod.totalCostLatest.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-amber-300">
                          +${prod.grossProfitLatest.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            prod.profitMarginPercentLatest >= 30
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : prod.profitMarginPercentLatest >= 15
                              ? 'bg-amber-500/10 text-amber-300'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {prod.profitMarginPercentLatest.toFixed(1)}%
                          </span>
                        </td>
                      </>
                    )}

                    {/* Stock on Hand */}
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                        prod.stockStatus === 'Out of Stock'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : prod.stockStatus === 'Low Stock'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {prod.currentStock} units
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
