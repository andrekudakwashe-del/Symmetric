import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, SaleInvoice, Product } from '../../types';
import {
  getSales,
  getProducts,
  getInventoryItems,
  subscribeToDatabase,
} from '../../db/roomDatabase';
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
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Award,
  BarChart3,
  Percent,
  CheckCircle2,
} from 'lucide-react';

interface SalesReportProps {
  currentUser?: Salesperson | null;
  onNavigateToPOS?: () => void;
  onNavigateToInventory?: () => void;
  onClose?: () => void;
}

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'this_month' | 'all';

interface ProductSalesStat {
  id: string;
  name: string;
  sku: string;
  category: string;
  unitsSold: number;
  totalRevenue: number;
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
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>('30days');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'revenue' | 'profit' | 'quantity' | 'margin'>('revenue');

  // Real-time synchronization with Room Database
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setSales(getSales());
      setProducts(getProducts());
    });
    return () => unsub();
  }, []);

  // Filter sales by date range
  const filteredSales = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    return sales.filter((s) => {
      if (s.status === 'Refunded') return false;
      const saleTime = new Date(s.timestamp || s.date).getTime();

      switch (dateFilter) {
        case 'today':
          return saleTime >= todayStart;
        case 'yesterday':
          return saleTime >= yesterdayStart && saleTime < todayStart;
        case '7days':
          return saleTime >= now.getTime() - 7 * 86400000;
        case '30days':
          return saleTime >= now.getTime() - 30 * 86400000;
        case 'this_month': {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          return saleTime >= monthStart;
        }
        case 'all':
        default:
          return true;
      }
    });
  }, [sales, dateFilter]);

  // Aggregate Product Performance & Stock Status
  const { productStats, totalRevenue, totalCost, totalGrossProfit, overallMargin, totalUnitsSold, categories } = useMemo(() => {
    const costMap = new Map<string, number>();
    const stockMap = new Map<string, { stock: number; reorder: number; sku: string; category: string }>();

    products.forEach((p) => {
      costMap.set(p.id, p.costPrice || 0);
      if (p.name) {
        costMap.set(p.name.toLowerCase().trim(), p.costPrice || 0);
      }
      stockMap.set(p.id, {
        stock: p.stockQuantity ?? p.totalUnits ?? 0,
        reorder: p.reorderLevelUnits ?? 5,
        sku: p.sku || p.id,
        category: p.category || 'General',
      });
    });

    const statMap = new Map<string, ProductSalesStat>();
    const categorySet = new Set<string>();

    filteredSales.forEach((sale) => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((item) => {
          const key = item.id || item.name || 'Unknown';
          const itemNameKey = item.name ? item.name.toLowerCase().trim() : '';
          const matchedCost = costMap.get(item.id) ?? (itemNameKey ? costMap.get(itemNameKey) : undefined) ?? (item.unitPrice * 0.7);
          const stockInfo = stockMap.get(item.id);
          const itemCat = item.category || stockInfo?.category || 'General';
          categorySet.add(itemCat);

          const existing = statMap.get(key);
          const itemQty = Number(item.quantity) || 0;
          const itemRevenue = Number(item.total) || (itemQty * item.unitPrice);
          const itemCost = itemQty * matchedCost;
          const itemProfit = itemRevenue - itemCost;

          if (existing) {
            existing.unitsSold += itemQty;
            existing.totalRevenue += itemRevenue;
            existing.totalCost += itemCost;
            existing.grossProfit += itemProfit;
            existing.profitMarginPercent = existing.totalRevenue > 0
              ? (existing.grossProfit / existing.totalRevenue) * 100
              : 0;
          } else {
            const currentStock = stockInfo?.stock ?? 0;
            const reorder = stockInfo?.reorder ?? 5;
            let status: 'Out of Stock' | 'Low Stock' | 'In Stock' = 'In Stock';
            if (currentStock <= 0) status = 'Out of Stock';
            else if (currentStock <= reorder) status = 'Low Stock';

            statMap.set(key, {
              id: item.id || key,
              name: item.name,
              sku: item.sku || stockInfo?.sku || key,
              category: itemCat,
              unitsSold: itemQty,
              totalRevenue: itemRevenue,
              totalCost: itemCost,
              grossProfit: itemProfit,
              profitMarginPercent: itemRevenue > 0 ? (itemProfit / itemRevenue) * 100 : 0,
              currentStock,
              stockStatus: status,
            });
          }
        });
      }
    });

    const statsList = Array.from(statMap.values());
    const rev = statsList.reduce((acc, p) => acc + p.totalRevenue, 0);
    const cost = statsList.reduce((acc, p) => acc + p.totalCost, 0);
    const profit = rev - cost;
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    const qty = statsList.reduce((acc, p) => acc + p.unitsSold, 0);

    return {
      productStats: statsList,
      totalRevenue: rev,
      totalCost: cost,
      totalGrossProfit: profit,
      overallMargin: margin,
      totalUnitsSold: qty,
      categories: Array.from(categorySet),
    };
  }, [filteredSales, products]);

  // Filtered & Sorted Table Items
  const displayedProducts = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    let result = productStats.filter((p) => {
      const matchesSearch =
        !q ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q));
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });

    result.sort((a, b) => {
      if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'profit') return b.grossProfit - a.grossProfit;
      if (sortBy === 'quantity') return b.unitsSold - a.unitsSold;
      if (sortBy === 'margin') return b.profitMarginPercent - a.profitMarginPercent;
      return 0;
    });

    return result;
  }, [productStats, searchQuery, selectedCategory, sortBy]);

  // Top Stocks & Low Stock Alerts
  const topRevenueProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
  }, [productStats]);

  const topProfitProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.grossProfit - a.grossProfit)[0];
  }, [productStats]);

  const topSellingProduct = useMemo(() => {
    if (productStats.length === 0) return null;
    return [...productStats].sort((a, b) => b.unitsSold - a.unitsSold)[0];
  }, [productStats]);

  const lowStockCount = useMemo(() => {
    return products.filter((p) => (p.stockQuantity ?? 0) <= (p.reorderLevelUnits ?? 5)).length;
  }, [products]);

  // CSV Export for Sales & Profit Analysis
  const handleExportCSV = () => {
    const headers = [
      'Product Name',
      'SKU',
      'Category',
      'Units Sold',
      'Total Revenue ($)',
      'Est Cost ($)',
      'Gross Profit ($)',
      'Profit Margin (%)',
      'Current Stock',
      'Stock Status',
    ];

    const rows = displayedProducts.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.sku}"`,
      `"${p.category}"`,
      p.unitsSold,
      p.totalRevenue.toFixed(2),
      p.totalCost.toFixed(2),
      p.grossProfit.toFixed(2),
      p.profitMarginPercent.toFixed(1),
      p.currentStock,
      p.stockStatus,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SAIMETRIC_Sales_Profit_Report_${dateFilter}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5 pb-24 animate-fadeIn max-w-7xl mx-auto">
      {/* Top Header & Range Selection */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Sales, Profit & Top Stocks Report
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time financial performance, product profitability, and inventory velocity.
          </p>
        </div>

        {/* Date Filter Pills */}
        <div className="flex items-center flex-wrap gap-1.5 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: '7 Days' },
              { id: '30days', label: '30 Days' },
              { id: 'this_month', label: 'This Month' },
              { id: 'all', label: 'All Time' },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              onClick={() => setDateFilter(filter.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                dateFilter === filter.id
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards: Revenue, Profit, Margin & Units */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Sales Revenue */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Sales</span>
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black text-white font-mono">
              ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {filteredSales.length} Completed Invoices
            </p>
          </div>
        </div>

        {/* Total Gross Profit */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Gross Profit</span>
            <span className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
              ${totalGrossProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Est Cost: ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Profit Margin */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Profit Margin</span>
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Percent className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
              {overallMargin.toFixed(1)}%
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Net Markup Spread
            </p>
          </div>
        </div>

        {/* Units Sold & Stock Count */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Units Sold</span>
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Boxes className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3">
            <h3 className="text-xl sm:text-2xl font-black text-white font-mono">
              {totalUnitsSold.toLocaleString()}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 flex items-center space-x-1">
              {lowStockCount > 0 ? (
                <span className="text-rose-400 font-bold">⚠️ {lowStockCount} Low/Out of Stock</span>
              ) : (
                <span className="text-emerald-400">All Stock Healthy</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Highlights: Top Stocks Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Top Seller by Volume */}
        <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900 border border-indigo-500/30 rounded-3xl p-4 shadow-md flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Award className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-300">Top Moving Stock (Volume)</div>
            <div className="text-sm font-black text-white truncate">{topSellingProduct ? topSellingProduct.name : 'No sales yet'}</div>
            <div className="text-xs text-slate-400 font-mono">
              {topSellingProduct ? `${topSellingProduct.unitsSold} units sold` : '—'}
            </div>
          </div>
        </div>

        {/* Highest Revenue Generator */}
        <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-500/30 rounded-3xl p-4 shadow-md flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <DollarSign className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-300">Top Revenue Leader</div>
            <div className="text-sm font-black text-white truncate">{topRevenueProduct ? topRevenueProduct.name : 'No sales yet'}</div>
            <div className="text-xs text-emerald-400 font-mono font-bold">
              {topRevenueProduct ? `$${topRevenueProduct.totalRevenue.toFixed(2)} generated` : '—'}
            </div>
          </div>
        </div>

        {/* Highest Profit Generator */}
        <div className="bg-gradient-to-br from-purple-950/60 to-slate-900 border border-purple-500/30 rounded-3xl p-4 shadow-md flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-purple-300">Most Profitable Product</div>
            <div className="text-sm font-black text-white truncate">{topProfitProduct ? topProfitProduct.name : 'No sales yet'}</div>
            <div className="text-xs text-purple-300 font-mono font-bold">
              {topProfitProduct ? `$${topProfitProduct.grossProfit.toFixed(2)} profit (${topProfitProduct.profitMarginPercent.toFixed(0)}% margin)` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Product Breakdown Table with Search & Filtering */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-white flex items-center space-x-2">
              <Package className="w-5 h-5 text-indigo-400" />
              <span>Product Sales & Profit Ledger</span>
            </h2>
            <p className="text-xs text-slate-400">
              Showing {displayedProducts.length} items sold during this period
            </p>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <button
              onClick={handleExportCSV}
              className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 active:scale-95 shadow-sm"
              title="Download full CSV spreadsheet"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => window.print()}
              className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 active:scale-95 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Controls: Search, Category & Sort */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search product or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 pl-9 pr-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
            />
          </div>

          {/* Category Filter */}
          <div className="relative">
            <Filter className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full py-2 pl-9 pr-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-indigo-500"
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
              className="w-full py-2 pl-9 pr-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-indigo-500"
            >
              <option value="revenue">Sort by Revenue ($)</option>
              <option value="profit">Sort by Profit ($)</option>
              <option value="quantity">Sort by Units Sold</option>
              <option value="margin">Sort by Margin (%)</option>
            </select>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-3">Product / SKU</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Units Sold</th>
                <th className="py-3 px-3 text-right">Revenue ($)</th>
                <th className="py-3 px-3 text-right">Est. Cost ($)</th>
                <th className="py-3 px-3 text-right">Profit ($)</th>
                <th className="py-3 px-3 text-right">Margin (%)</th>
                <th className="py-3 px-3 text-center">Current Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {displayedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="font-bold text-slate-400">No product sales found for this period</p>
                    <p className="text-[11px] text-slate-500 mt-1">Try selecting a different date range or category.</p>
                  </td>
                </tr>
              ) : (
                displayedProducts.map((prod) => (
                  <tr key={prod.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-white">{prod.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{prod.sku}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{prod.category}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                      {prod.unitsSold}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                      ${prod.totalRevenue.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                      ${prod.totalCost.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                      +${prod.grossProfit.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        prod.profitMarginPercent >= 30
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : prod.profitMarginPercent >= 15
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {prod.profitMarginPercent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        prod.stockStatus === 'Out of Stock'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : prod.stockStatus === 'Low Stock'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {prod.currentStock} units ({prod.stockStatus})
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
