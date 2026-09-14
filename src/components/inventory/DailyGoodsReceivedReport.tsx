import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Building2,
  DollarSign,
  Boxes,
  Package,
  Receipt,
  Printer,
  Download,
  Filter,
  Search,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react';
import {
  getBranches,
  getDailyGoodsReceivedReport,
  getSupplierInvoiceVouchers,
  subscribeRoomDatabase,
  DailyGRNReportSummary,
} from '../../db/roomDatabase';
import { Branch, SupplierInvoiceVoucher } from '../../types';

interface DailyGoodsReceivedReportProps {
  onViewVoucher?: (voucher: SupplierInvoiceVoucher) => void;
  onGoToGRN?: () => void;
}

export const DailyGoodsReceivedReport: React.FC<DailyGoodsReceivedReportProps> = ({
  onViewVoucher,
  onGoToGRN,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [branches, setBranches] = useState<Branch[]>(() => getBranches());
  const [reportData, setReportData] = useState<DailyGRNReportSummary>(() =>
    getDailyGoodsReceivedReport(new Date().toISOString().split('T')[0], 'ALL')
  );
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');

  const refreshReport = () => {
    setBranches(getBranches());
    setReportData(getDailyGoodsReceivedReport(selectedDate, selectedBranchId));
  };

  useEffect(() => {
    setReportData(getDailyGoodsReceivedReport(selectedDate, selectedBranchId));
  }, [selectedDate, selectedBranchId]);

  useEffect(() => {
    const unsub = subscribeRoomDatabase(refreshReport);
    return unsub;
  }, [selectedDate, selectedBranchId]);

  // Filter itemized lines
  const filteredLines = reportData.itemizedLines.filter((line) => {
    const q = (itemSearchQuery || '').trim().toLowerCase();
    const matchesSearch =
      !q ||
      (line.itemName && line.itemName.toLowerCase().includes(q)) ||
      (line.itemId && line.itemId.toLowerCase().includes(q)) ||
      (line.supplier && line.supplier.toLowerCase().includes(q)) ||
      (line.invoiceNo && line.invoiceNo.toLowerCase().includes(q)) ||
      (line.purchaseOrderNo && line.purchaseOrderNo.toLowerCase().includes(q));
    return matchesSearch;
  });

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Branch',
      'GRN ID',
      'Supplier Invoice #',
      'Purchase Order #',
      'Supplier',
      'Item Code',
      'Item Name',
      'Category',
      'Receive As',
      'Units/Case',
      'Cases Received',
      'Singles Received',
      'Last Cost ($)',
      'Cost/Case ($)',
      'Cost/Unit ($)',
      'Selling Price ($)',
      'Margin (%)',
      'Line Total ($)',
      'Rule A Triggered',
    ];

    const rows = reportData.itemizedLines.map((l) => [
      l.date,
      `"${l.branchName}"`,
      l.grnId,
      l.invoiceNo,
      l.purchaseOrderNo || '',
      `"${l.supplier}"`,
      l.itemId,
      `"${l.itemName}"`,
      l.category,
      l.receiveAs,
      l.unitsPerCase,
      l.receivedCases,
      l.receivedSingles,
      l.lastCost !== undefined ? l.lastCost.toFixed(2) : l.costPerCase.toFixed(2),
      l.costPerCase.toFixed(2),
      l.costPerUnit.toFixed(2),
      l.sellingPrice !== undefined ? l.sellingPrice.toFixed(2) : '',
      l.marginPercent !== undefined ? l.marginPercent.toFixed(1) + '%' : '',
      l.lineTotal.toFixed(2),
      l.autoBrokenRuleA ? 'YES' : 'NO',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `GRN_Daily_Report_${selectedDate}_${selectedBranchId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Control Bar: Date & Branch Selection */}
      <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none"
            />
          </div>

          {/* Quick Date Buttons */}
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
              selectedDate === new Date().toISOString().split('T')[0]
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split('T')[0]);
            }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            Yesterday
          </button>

          {/* Branch Selector */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2">
            <Building2 className="w-4 h-4 text-slate-400" />
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none"
            >
              <option value="ALL" className="bg-slate-850 text-white">
                All Branches / Outlets
              </option>
              {branches.map((b, bIdx) => (
                <option key={`${b.branchId || bIdx}-${bIdx}`} value={b.branchId} className="bg-slate-850 text-white">
                  {b.name} ({b.city})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            Export CSV
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <Printer className="w-4 h-4 text-blue-400" />
            Print Report
          </button>
        </div>
      </div>

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Metric 1: Total Valuation */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Total Received Value
          </span>
          <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">
            ${reportData.totalValuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            {reportData.branchName}
          </span>
        </div>

        {/* Metric 2: Total Cases */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Cases Received
          </span>
          <span className="text-xl font-black font-mono text-blue-400 mt-1 block">
            {reportData.totalCases.toLocaleString()} cs
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Full outer cartons</span>
        </div>

        {/* Metric 3: Total Singles */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Singles Received
          </span>
          <span className="text-xl font-black font-mono text-amber-400 mt-1 block">
            {reportData.totalSingles.toLocaleString()} un
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Loose units</span>
        </div>

        {/* Metric 4: Total Units */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Total Inward Units
          </span>
          <span className="text-xl font-black font-mono text-white mt-1 block">
            {reportData.totalUnits.toLocaleString()}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Sum of all singles</span>
        </div>

        {/* Metric 5: Invoices Processed */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Invoices / GRNs
          </span>
          <span className="text-xl font-black font-mono text-purple-300 mt-1 block">
            {reportData.totalInvoices}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Supplier vouchers</span>
        </div>

        {/* Metric 6: Rule A Auto-breaks */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
            Rule A Triggers
          </span>
          <span className="text-xl font-black font-mono text-amber-300 mt-1 block flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            {reportData.ruleACount}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Auto-broken to shelf</span>
        </div>
      </div>

      {/* Supplier Spend Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Supplier Breakdown */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              <h3 className="font-bold text-white text-sm">
                Supplier Valuation Breakdown ({reportData.supplierBreakdown.length} Suppliers)
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">Date: {reportData.date}</span>
          </div>

          {reportData.supplierBreakdown.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No goods received recorded for this date and branch filter.
            </div>
          ) : (
            <div className="space-y-3">
              {reportData.supplierBreakdown.map((supp) => (
                <div key={supp.supplier} className="space-y-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{supp.supplier}</span>
                      <span className="text-slate-500 font-mono">
                        ({supp.invoiceCount} voucher{supp.invoiceCount === 1 ? '' : 's'})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-emerald-400">
                        ${supp.totalAmount.toFixed(2)}
                      </span>
                      <span className="text-slate-500 font-mono ml-2 text-[11px]">
                        ({supp.percentageOfTotal.toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full"
                      style={{ width: `${Math.max(2, supp.percentageOfTotal)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5">
                    <span>Cases: {supp.cases} cs</span>
                    <span>Singles: {supp.singles} un</span>
                    <span>Total Inward Units: {supp.totalUnits}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Col: Category Breakdown */}
        <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-white text-sm">Category Summary</h3>
          </div>

          {reportData.categoryBreakdown.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No categories recorded.
            </div>
          ) : (
            <div className="space-y-2.5">
              {reportData.categoryBreakdown.map((cat) => (
                <div
                  key={cat.category}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-white block">{cat.category}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {cat.cases} cs • {cat.singles} un
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-slate-200">
                      ${cat.totalAmount.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      {cat.totalUnits} units
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Itemized Goods Received Table */}
      <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white text-sm">Itemized Inward Stock Ledger</h3>
            <p className="text-xs text-slate-400">
              Showing {filteredLines.length} received items on {selectedDate} ({reportData.branchName})
            </p>
          </div>

          {/* Table Search */}
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              placeholder="Search product, code, supplier..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {filteredLines.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs bg-slate-900/50 rounded-xl border border-slate-800">
            No received goods found matching your date or search criteria.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700/80">
            <table className="w-full min-w-[1280px] text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800 text-slate-300 font-bold border-b border-slate-700">
                  <th className="py-2.5 px-3 min-w-[200px]">Product Name / Code</th>
                  <th className="py-2.5 px-3 min-w-[180px]">Supplier & Invoice</th>
                  <th className="py-2.5 px-2 text-center min-w-[90px]">Receive As</th>
                  <th className="py-2.5 px-2 text-center min-w-[80px]">Ratio (Qty/Cs)</th>
                  <th className="py-2.5 px-2 text-center min-w-[70px]">Cases</th>
                  <th className="py-2.5 px-2 text-center min-w-[70px]">Singles</th>
                  <th className="py-2.5 px-2 text-right min-w-[85px]">Last Cost</th>
                  <th className="py-2.5 px-2 text-right min-w-[95px]">Price / Case</th>
                  <th className="py-2.5 px-3 text-right font-extrabold text-emerald-400 min-w-[100px]">
                    Line Total ($)
                  </th>
                  <th className="py-2.5 px-2 text-right min-w-[85px]">Unit Cost</th>
                  <th className="py-2.5 px-2 text-right min-w-[95px]">Selling Price</th>
                  <th className="py-2.5 px-2 text-center min-w-[75px]">Margin</th>
                  <th className="py-2.5 px-2 text-center min-w-[75px]">Rule A</th>
                  {onViewVoucher && (
                    <th className="py-2.5 px-2 text-center min-w-[70px]">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900">
                {filteredLines.map((line, idx) => (
                  <tr key={`${line.grnId}-${line.itemId}-${idx}`} className="hover:bg-slate-850/60 transition-colors">
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-white block">{line.itemName}</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {line.itemId} • {line.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-slate-200 block">{line.supplier}</span>
                      <span className="text-[10px] font-mono text-blue-400">
                        Inv: {line.invoiceNo} {line.purchaseOrderNo ? `(PO: ${line.purchaseOrderNo})` : ''}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                        {line.receiveAs}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono text-slate-300">
                      {line.unitsPerCase} un/cs
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono font-bold text-white">
                      {line.receivedCases}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono text-slate-300">
                      {line.receivedSingles}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-400">
                      ${(line.lastCost !== undefined ? line.lastCost : line.costPerCase).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-300 font-medium">
                      ${line.costPerCase.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 bg-emerald-950/20">
                      ${line.lineTotal.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-300">
                      ${line.costPerUnit.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-200 font-semibold">
                      {line.sellingPrice !== undefined && line.sellingPrice > 0
                        ? `$${line.sellingPrice.toFixed(2)}`
                        : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono font-semibold text-slate-300">
                      {line.marginPercent !== undefined ? `${line.marginPercent.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {line.autoBrokenRuleA ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-500/40">
                          Rule A
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[10px]">-</span>
                      )}
                    </td>
                    {onViewVoucher && (
                      <td className="py-2.5 px-2 text-center">
                        <button
                          onClick={() => {
                            const foundVoucher = reportData.vouchers.find((v) => v.voucherId === line.grnId);
                            if (foundVoucher) {
                              onViewVoucher(foundVoucher);
                            }
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors"
                          title="View Official Voucher"
                        >
                          View
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
