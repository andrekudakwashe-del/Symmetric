import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bluetooth,
  Calculator,
  CheckCircle2,
  Coins,
  FileText,
  History,
  Printer,
  ShoppingBag,
  Smartphone,
  X,
} from 'lucide-react';
import {
  CashierShiftReportData,
  ShiftReportDetailMode,
  ShiftReportPaperFormat,
} from '../../services/cashierShiftReportService';
import {
  bluetoothPrinter,
  getPrinterConfig,
  isBluetoothPermissionsBlocked,
  isRunningInIframe,
} from '../../services/bluetoothPrinter';
import { getActiveCurrencies } from '../../db/roomDatabase';
import { Form4BalancingResult, Salesperson } from '../../types';

export interface ShiftAuditDataPayload {
  staff: Salesperson | { id: string; name: string; role?: string };
  row?: Form4BalancingResult;
  form2Logs: any[];
  form3Changes: any[];
  form3Credits: any[];
  form1Count?: any;
  staffSales: any[];
  adminSale?: any;
  staffMovements: any[];
}

interface CashierShiftReportModalProps {
  report: CashierShiftReportData;
  auditData: ShiftAuditDataPayload;
  date: string;
  onClose: () => void;
}

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtSigned = (n: number) =>
  Math.abs(n) < 0.01 ? '$0.00' : n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `+$${n.toFixed(2)}`;

export const CashierShiftReportModal: React.FC<CashierShiftReportModalProps> = ({
  report,
  auditData,
  date,
  onClose,
}) => {
  const defaultCfgWidth = getPrinterConfig(report.companyId).paperWidth || '58mm';
  const [activeTab, setActiveTab] = useState<'report' | 'movements'>('report');
  const [detailMode, setDetailMode] = useState<ShiftReportDetailMode>('compact');
  const [paperFormat, setPaperFormat] = useState<ShiftReportPaperFormat>(defaultCfgWidth);
  const [btStatus, setBtStatus] = useState(() => bluetoothPrinter.getStatus());
  const [isBtPrinting, setIsBtPrinting] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const inIframe = isRunningInIframe();

  useEffect(() => {
    const unsub = bluetoothPrinter.subscribe((s) => setBtStatus(s));
    return () => {
      unsub();
    };
  }, []);

  const handleBluetoothPrint = async () => {
    setPrintFeedback(null);
    if (paperFormat === 'A4') {
      setPrintFeedback({
        type: 'info',
        message: 'Bluetooth thermal printers use 58mm or 80mm. Printing 58mm roll format or switch to Print / Save PDF for A4.',
      });
    }
    const targetWidth = paperFormat === '80mm' ? '80mm' : '58mm';
    try {
      setIsBtPrinting(true);
      if (!btStatus.connected) {
        const reconnected = await bluetoothPrinter.attemptSilentReconnect();
        if (!reconnected) {
          if (isBluetoothPermissionsBlocked()) {
            setPrintFeedback({
              type: 'info',
              message:
                'Web Bluetooth is blocked inside this embedded preview. Use "Print / Save PDF (Other Printers)" or open the app in its own browser tab for direct Bluetooth printing.',
            });
            return;
          }
          await bluetoothPrinter.connect();
        }
      }
      const res = await bluetoothPrinter.printCashierReport(report, detailMode, targetWidth);
      setPrintFeedback({ type: 'success', message: res.message });
    } catch (err: any) {
      if (isBluetoothPermissionsBlocked(err)) {
        setPrintFeedback({
          type: 'info',
          message:
            'Bluetooth access is restricted in this iframe. Use "Print / Save PDF (Other Printers)" to print on 58mm, 80mm, or A4.',
        });
      } else {
        setPrintFeedback({
          type: 'error',
          message: err?.message || 'Could not print to Bluetooth printer. Try Print / Save PDF.',
        });
      }
    } finally {
      setIsBtPrinting(false);
    }
  };

  const handleSystemPrint = () => {
    setPrintFeedback(null);
    const widthVal = paperFormat === '80mm' ? '80mm' : paperFormat === '58mm' ? '58mm' : '100%';
    document.documentElement.style.setProperty('--shift-report-width', widthVal);
    document.body.setAttribute('data-shift-paper', paperFormat);
    document.body.classList.add('printing-shift-report');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-shift-report');
      document.body.removeAttribute('data-shift-paper');
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      // Fallback cleanup in case browser does not fire afterprint inside iframe
      setTimeout(cleanup, 1200);
    }, 60);
  };

  const isBalanced = Math.abs(report.variance) < 0.01 && report.submittedForm1Cash !== null;
  const isShort = report.variance < -0.009;
  const isA4 = paperFormat === 'A4';
  const isNarrow58 = paperFormat === '58mm';

  return (
    <div className="shift-report-print-root fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[93vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
        {/* Modal Header (Hidden on Print) */}
        <div className="print:hidden p-4 sm:p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white font-bold text-base shadow-md">
              {report.staffName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white">
                  Cashier Shift Report: {report.staffName}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    isBalanced
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : isShort
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}
                >
                  {report.status}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Date: <strong className="text-slate-200">{report.date}</strong> • Staff #{report.staffId} • Shift {report.shiftId.slice(-12)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Sub-Tabs: Printable Report vs Raw Canonical Movements */}
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1.5 transition ${
                  activeTab === 'report'
                    ? 'bg-[#6A4DFF] text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Shift Report</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('movements')}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1.5 transition ${
                  activeTab === 'movements'
                    ? 'bg-slate-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Raw Ledger ({auditData.staffMovements.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* TAB 1: PRINTABLE CASHIER SHIFT REPORT (58mm / 80mm / A4)               */}
        {/* ===================================================================== */}
        {activeTab === 'report' && (
          <>
            {/* Print Controls Bar */}
            <div className="print:hidden px-4 py-3 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Detail Level Toggle */}
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDetailMode('compact')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      detailMode === 'compact'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Compact Summary
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailMode('full')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      detailMode === 'full'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Full Itemized
                  </button>
                </div>

                {/* Paper Format Selector */}
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-0.5 text-[11px]">
                  {(['58mm', '80mm', 'A4'] as ShiftReportPaperFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setPaperFormat(fmt)}
                      className={`px-2.5 py-1 rounded-lg font-bold transition ${
                        paperFormat === fmt
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {fmt === 'A4' ? 'A4 / PDF' : `${fmt} Roll`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleBluetoothPrint}
                  disabled={isBtPrinting}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow"
                  title={
                    inIframe
                      ? 'Direct Bluetooth is blocked inside iframe preview — open in standalone tab or use Print / Save PDF'
                      : 'Send ESC/POS slip directly to Bluetooth 58mm/80mm printer'
                  }
                >
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span>
                    {isBtPrinting
                      ? 'Printing...'
                      : btStatus.connected
                      ? `BT Print (${paperFormat === '80mm' ? '80mm' : '58mm'})`
                      : `Bluetooth (${paperFormat === '80mm' ? '80mm' : '58mm'})`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSystemPrint}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / Save PDF ({paperFormat})</span>
                </button>
              </div>
            </div>

            {printFeedback && (
              <div
                className={`print:hidden px-4 py-2 text-xs font-semibold flex items-center justify-between border-b ${
                  printFeedback.type === 'success'
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50'
                    : printFeedback.type === 'error'
                    ? 'bg-rose-950/70 text-rose-300 border-rose-700/50'
                    : 'bg-amber-950/70 text-amber-200 border-amber-700/50'
                }`}
              >
                <span>{printFeedback.message}</span>
                <button
                  type="button"
                  onClick={() => setPrintFeedback(null)}
                  className="ml-3 opacity-80 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Paper Canvas Container */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-950/60 flex justify-center items-start">
              <div
                id="cashier-shift-report-print"
                className={`bg-white text-slate-900 shadow-xl border border-slate-200 rounded-xl font-mono-num leading-snug transition-all ${
                  isA4
                    ? 'w-full max-w-[820px] p-6 text-xs'
                    : paperFormat === '80mm'
                    ? 'w-full max-w-[360px] p-4 text-[11px]'
                    : 'w-full max-w-[275px] p-3 text-[10px]'
                }`}
              >
                {/* 1. Store & Report Header */}
                <div className="text-center border-b-2 border-dashed border-slate-400 pb-2.5 mb-2.5">
                  <div className="font-sans font-black uppercase tracking-wider text-sm text-slate-900">
                    {report.storeName}
                  </div>
                  {report.branchName && (
                    <div className="font-sans font-bold text-[11px] text-slate-700">
                      {report.branchName}
                    </div>
                  )}
                  {report.storePhone && (
                    <div className="text-[10px] text-slate-500">Tel: {report.storePhone}</div>
                  )}
                  <div className="mt-1.5 pt-1.5 border-t border-dashed border-slate-300 font-sans font-black uppercase text-xs tracking-wide text-slate-900">
                    CASHIER SHIFT & VARIANCE REPORT
                  </div>
                  <div className="text-[10px] font-bold text-slate-600 uppercase">
                    {detailMode === 'compact' ? 'Compact Summary Slip' : 'Full Itemized Audit'} •{' '}
                    {paperFormat}
                  </div>
                </div>

                {/* 2. Shift Metadata */}
                <div
                  className={`border-b border-dashed border-slate-300 pb-2 mb-2.5 ${
                    isA4 ? 'grid grid-cols-2 gap-x-6 gap-y-1' : 'space-y-0.5'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="text-slate-600">Cashier:</span>
                    <span className="font-bold text-slate-900">{report.staffName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Staff ID:</span>
                    <span className="font-bold">#{report.staffId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Business Date:</span>
                    <span className="font-bold">{report.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Shift Ref:</span>
                    <span className="font-semibold">{report.shiftId.slice(-14)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Status:</span>
                    <span className="font-black uppercase">{report.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Printed:</span>
                    <span>{report.generatedAt}</span>
                  </div>
                </div>

                {/* 3. Balancing Proof ("Why You Balanced / Didn't Balance") */}
                <div className="border-b-2 border-dashed border-slate-400 pb-2.5 mb-2.5">
                  <div className="font-sans font-black uppercase text-[11px] tracking-wider text-slate-900 mb-1.5">
                    1. CASH BALANCING PROOF
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between">
                      <span>+ Opening / Issued Float</span>
                      <span className="font-bold">{fmtMoney(report.float)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>+ Cash Sales ({report.cashSalesSummary.count} inv)</span>
                      <span className="font-bold">{fmtMoney(report.cashSales)}</span>
                    </div>
                    {report.mobileShortfallCharged > 0.009 && (
                      <div className="flex justify-between text-[9px] text-rose-700 pl-2">
                        <span>└ Incl. Flagged Mobile Shortfall</span>
                        <span>{fmtMoney(report.mobileShortfallCharged)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>+ Credit Repay & Chg Left (F3)</span>
                      <span className="font-bold">{fmtMoney(report.creditPayments)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>- Cash Expenses (Excl. Shop Use)</span>
                      <span className="font-bold">-{fmtMoney(report.expenses)}</span>
                    </div>
                    {report.directProcurements > 0 && (
                      <div className="flex justify-between">
                        <span>- Direct GRV Cash Payouts</span>
                        <span className="font-bold">-{fmtMoney(report.directProcurements)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>- Supervisor Cash Lifts ({report.activeCashLifts.length})</span>
                      <span className="font-bold">-{fmtMoney(report.cashLift)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>- Customer Change Paid Out (F3)</span>
                      <span className="font-bold">-{fmtMoney(report.customerChangePaidOut)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>- Multi-Currency Cash Handed Out</span>
                      <span className="font-bold">
                        -{fmtMoney(report.multiCurrencyCashOutTotal)}
                      </span>
                    </div>
                    {report.deductions > 0 && (
                      <div className="flex justify-between">
                        <span>- Misc Form 2 Deductions</span>
                        <span className="font-bold">-{fmtMoney(report.deductions)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-1.5 pt-1.5 border-t border-slate-300 space-y-1">
                    <div className="flex justify-between font-bold text-slate-900">
                      <span>= EXPECTED CASH IN TILL</span>
                      <span>{fmtMoney(report.expectedCash)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900">
                      <span>SUBMITTED CASH (FORM 1)</span>
                      <span>
                        {report.submittedForm1Cash !== null
                          ? fmtMoney(report.submittedForm1Cash)
                          : 'NOT SUBMITTED'}
                      </span>
                    </div>
                    <div
                      className={`flex justify-between items-center pt-1.5 border-t-2 border-slate-900 font-black ${
                        isNarrow58 ? 'text-xs' : 'text-sm'
                      }`}
                    >
                      <span>
                        {Math.abs(report.variance) < 0.01 && report.submittedForm1Cash !== null
                          ? 'VARIANCE (BALANCED)'
                          : report.variance < 0
                          ? 'VARIANCE (SHORTAGE)'
                          : 'VARIANCE (OVERAGE)'}
                      </span>
                      <span>{fmtSigned(report.variance)}</span>
                    </div>
                  </div>
                </div>

                {/* 4. Automated Variance Diagnosis */}
                <div className="border-b border-dashed border-slate-300 pb-2 mb-2.5 bg-slate-50 p-2 rounded">
                  <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-800 mb-1">
                    2. WHY VARIANCE / AUDIT NOTES
                  </div>
                  <ul className="space-y-1 text-[10px] text-slate-800 list-disc pl-3.5">
                    {report.varianceDiagnosis.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>

                {/* Main Grid Wrapper: Single column on 58mm/80mm, 2-column on A4 */}
                <div className={isA4 ? 'grid grid-cols-2 gap-4' : 'space-y-2.5'}>
                  {/* 5. Form 1 Denomination Breakdown */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      3. FORM 1 SUBMITTED CASH
                    </div>
                    {report.submittedForm1Cash === null ? (
                      <div className="text-slate-500 italic">No Form 1 count submitted yet.</div>
                    ) : report.form1Denominations.length === 0 ? (
                      <div className="flex justify-between font-bold">
                        <span>Total Submitted:</span>
                        <span>{fmtMoney(report.submittedForm1Cash)}</span>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {report.form1Denominations.map((d) => (
                          <div key={d.label} className="flex justify-between">
                            <span>
                              {d.count} x {d.label}
                            </span>
                            <span>{fmtMoney(d.value)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold border-t border-slate-300 pt-0.5">
                          <span>Form 1 Total</span>
                          <span>{fmtMoney(report.submittedForm1Cash)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 6. Float & Sales Breakdown */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      4. FLOAT & SALES SUMMARY
                    </div>
                    <div className="space-y-0.5">
                      {report.floatEntries.length === 0 ? (
                        <div className="flex justify-between">
                          <span>Opening Float</span>
                          <span>$0.00</span>
                        </div>
                      ) : (
                        report.floatEntries.map((f, i) => (
                          <div key={`${f.id}-${i}`} className="flex justify-between">
                            <span className="truncate pr-1">
                              Float ({f.time}) {f.reference ? `#${f.reference}` : ''}
                            </span>
                            <span className="font-bold">{fmtMoney(f.amount)}</span>
                          </div>
                        ))
                      )}
                      <div className="flex justify-between">
                        <span>Cash Sales ({report.cashSalesSummary.count})</span>
                        <span>{fmtMoney(report.cashSalesSummary.total)}</span>
                      </div>
                      {report.totalNonCashSales > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>Non-Cash (Eco/ZiG/Credit)</span>
                          <span>{fmtMoney(report.totalNonCashSales)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold border-t border-slate-300 pt-0.5">
                        <span>Total Shift Sales</span>
                        <span>{fmtMoney(report.totalSales)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 7. Active Multi-Currency Transactions */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      5. ACTIVE MULTI-CURRENCY ({report.multiCurrencyTransactions.length})
                    </div>
                    {report.multiCurrencySummary.length === 0 &&
                    report.multiCurrencyTransactions.length === 0 ? (
                      <div className="text-slate-500 italic">No active multi-currency txns.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {report.multiCurrencySummary.map((mc) => (
                          <div key={mc.currency} className="bg-slate-50 p-1.5 rounded border border-slate-200">
                            <div className="flex justify-between font-bold">
                              <span>
                                {mc.currency} ({mc.txCount} tx)
                              </span>
                              <span>Goods {fmtMoney(mc.goodsTotalUsd)}</span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span>Cash Handed Out (USD):</span>
                              <span className="font-bold">-{fmtMoney(mc.cashOutUsd)}</span>
                            </div>
                            {mc.nativeExpected > 0 && (
                              <div className="flex justify-between text-[10px] text-slate-600">
                                <span>Native Collected:</span>
                                <span>
                                  {mc.nativeExpected.toFixed(2)} {mc.currency}
                                </span>
                              </div>
                            )}
                            <div className="text-[9px] text-slate-600">
                              POP: {mc.verifiedCount} Verified • {mc.pendingCount} Pending •{' '}
                              {mc.flaggedCount} Flagged
                            </div>
                          </div>
                        ))}

                        {detailMode === 'full' && report.multiCurrencyTransactions.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {report.multiCurrencyTransactions.map((tx, idx) => (
                              <div
                                key={`${tx.id}-${idx}`}
                                className="border-t border-dotted border-slate-300 pt-1 text-[10px]"
                              >
                                <div className="flex justify-between font-semibold">
                                  <span className="truncate pr-1">
                                    {tx.time} {tx.currency} • {tx.customerOrDesc}
                                  </span>
                                  <span>[{tx.verificationStatus}]</span>
                                </div>
                                <div className="flex justify-between text-slate-600">
                                  <span>
                                    Gds {fmtMoney(tx.goodsUsd)} | Out -{fmtMoney(tx.cashOutUsd)}
                                  </span>
                                  <span>
                                    {tx.nativeAmount.toFixed(2)} {tx.currency}
                                  </span>
                                </div>
                                {tx.popReference && (
                                  <div className="text-[9px] text-slate-500">
                                    POP Ref: {tx.popReference}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 8. Active Supervisor Cash Lifts */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      6. ACTIVE SUPERVISOR CASH LIFTS ({report.activeCashLifts.length})
                    </div>
                    {report.activeCashLifts.length === 0 ? (
                      <div className="text-slate-500 italic">No supervisor cash lifts.</div>
                    ) : (
                      <div className="space-y-1">
                        {report.activeCashLifts.map((l) => (
                          <div key={l.id} className="flex justify-between items-start">
                            <div className="pr-2">
                              <div className="font-semibold">
                                {l.time} • {l.supervisorName}
                              </div>
                              <div className="text-[9px] text-slate-500">
                                {l.id}
                                {l.reason ? ` • ${l.reason}` : ''}
                              </div>
                            </div>
                            <span className="font-bold whitespace-nowrap">
                              -{fmtMoney(l.amount)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold border-t border-slate-300 pt-0.5">
                          <span>Total Lifts</span>
                          <span>-{fmtMoney(report.cashLift)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 9. Active Cash Expenses (Strictly Excluding Shop Use) */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      7. CASH EXPENSES ({report.activeExpenses.length}) — NO SHOP USE
                    </div>
                    {report.activeExpenses.length === 0 && report.activeDirectGrvs.length === 0 ? (
                      <div className="text-slate-500 italic">No cash expenses recorded.</div>
                    ) : (
                      <div className="space-y-1">
                        {report.activeExpenses.map((e, i) => (
                          <div key={`${e.id}-${i}`} className="flex justify-between items-start">
                            <div className="pr-2 min-w-0">
                              <div className="font-semibold truncate">
                                {e.time} • {e.description}
                              </div>
                              <div className="text-[9px] text-slate-500 uppercase">
                                {e.category} • [{e.status}]
                              </div>
                            </div>
                            <span className="font-bold whitespace-nowrap">
                              -{fmtMoney(e.amount)}
                            </span>
                          </div>
                        ))}
                        {report.activeDirectGrvs.map((g, i) => (
                          <div key={`${g.id}-${i}`} className="flex justify-between items-start">
                            <div className="pr-2">
                              <div className="font-semibold">
                                Direct GRV {g.grvNumber} • {g.supplierName}
                              </div>
                              <div className="text-[9px] text-slate-500 uppercase">
                                Till Payout • [{g.status}]
                              </div>
                            </div>
                            <span className="font-bold whitespace-nowrap">
                              -{fmtMoney(g.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {report.excludedShopUseCount > 0 && (
                      <div className="mt-1 text-[9px] text-slate-500 italic">
                        * Excluded {report.excludedShopUseCount} non-cash Shop Use item(s) ($
                        {report.excludedShopUseAmount.toFixed(2)}).
                      </div>
                    )}
                  </div>

                  {/* 10. Form 2 & Form 3 Summary + Optional Full Itemized Lines */}
                  <div className="border-b border-dashed border-slate-300 pb-2">
                    <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                      8. FORM 2 & FORM 3 ACTIVITY
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between">
                        <span>Form 2 Entries ({report.form2Entries.length})</span>
                        <span className="font-bold">Net {fmtMoney(report.form2Net)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Form 3 Change ({report.form3ChangeEntries.length})</span>
                        <span className="font-bold">
                          +{fmtMoney(report.changeLeftBehindIn)} / -
                          {fmtMoney(report.customerChangePaidOut)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Form 3 Credit ({report.form3CreditEntries.length})</span>
                        <span className="font-bold">
                          Repay +{fmtMoney(report.creditRepaymentsIn)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold border-t border-slate-300 pt-0.5">
                        <span>Sum Form 2 & 3 Net</span>
                        <span>{fmtMoney(report.sumForm2And3Net)}</span>
                      </div>
                    </div>

                    {detailMode === 'full' && (
                      <div className="mt-2 space-y-2 border-t border-dotted border-slate-300 pt-1.5">
                        {report.form2Entries.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-[9px] uppercase text-slate-700 mb-0.5">
                              All Form 2 Cash Log Entries
                            </div>
                            <div className="space-y-0.5 text-[10px]">
                              {report.form2Entries.map((f2, idx) => (
                                <div key={`${f2.id}-${idx}`} className="flex justify-between gap-1">
                                  <span className="truncate">
                                    {f2.time} {f2.line}: {f2.description}
                                  </span>
                                  <span className="font-bold whitespace-nowrap">
                                    {f2.inAmount > 0
                                      ? `+${fmtMoney(f2.inAmount)}`
                                      : f2.outAmount > 0
                                      ? `-${fmtMoney(f2.outAmount)}`
                                      : '$0.00'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {report.form3ChangeEntries.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-[9px] uppercase text-slate-700 mb-0.5">
                              All Form 3 Change Entries
                            </div>
                            <div className="space-y-0.5 text-[10px]">
                              {report.form3ChangeEntries.map((c, idx) => (
                                <div key={`${c.id}-${idx}`} className="flex justify-between gap-1">
                                  <span className="truncate">
                                    {c.time} {c.customerName}
                                    {c.notes ? ` (${c.notes})` : ''}
                                  </span>
                                  <span className="font-bold whitespace-nowrap">
                                    {c.inAmount > 0
                                      ? `+${fmtMoney(c.inAmount)} In`
                                      : `-${fmtMoney(c.outAmount)} Out`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {report.form3CreditEntries.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-[9px] uppercase text-slate-700 mb-0.5">
                              All Form 3 Credit Entries
                            </div>
                            <div className="space-y-0.5 text-[10px]">
                              {report.form3CreditEntries.map((cr, idx) => (
                                <div key={`${cr.id}-${idx}`} className="flex justify-between gap-1">
                                  <span className="truncate">
                                    {cr.time} {cr.customerName}: {cr.itemDescription}
                                  </span>
                                  <span className="font-bold whitespace-nowrap">
                                    {cr.inAmount > 0
                                      ? `+${fmtMoney(cr.inAmount)} Paid`
                                      : `${fmtMoney(cr.outAmount || cr.amount)} Cr`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 11. Physical Sign-Off & Signature Block */}
                <div className="mt-3 pt-2 border-t-2 border-dashed border-slate-400">
                  <div className="font-sans font-black uppercase text-[10px] tracking-wider text-slate-900 mb-1">
                    9. SHIFT ACKNOWLEDGMENT & SIGN-OFF
                  </div>
                  <p className="text-[10px] text-slate-700 mb-3">
                    I confirm that I have reviewed this shift report, transaction breakdown, and
                    final cash variance ({fmtSigned(report.variance)}).
                  </p>

                  <div className={isA4 ? 'grid grid-cols-2 gap-8 mt-4' : 'space-y-4 mt-3'}>
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-slate-800">
                        Cashier: {report.staffName}
                      </div>
                      <div className="border-b border-slate-700 h-5" />
                      <div className="flex justify-between text-[9px] text-slate-500">
                        <span>Cashier Signature</span>
                        <span>Date / Time</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-slate-800">
                        Supervisor / Auditor:
                      </div>
                      <div className="border-b border-slate-700 h-5" />
                      <div className="flex justify-between text-[9px] text-slate-500">
                        <span>Supervisor Signature</span>
                        <span>Date / Time</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center text-[9px] text-slate-400 mt-4 pt-2 border-t border-dashed border-slate-300">
                    *** END OF CASHIER SHIFT REPORT ***
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: RAW LEDGER MOVEMENTS (SUPERVISOR DIAGNOSTIC VIEW)              */}
        {/* ===================================================================== */}
        {activeTab === 'movements' && (
          <div className="print:hidden p-4 sm:p-5 space-y-4 overflow-y-auto text-xs flex-1">
            {/* Summary Stats Pill */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 rounded-2xl bg-slate-950 border border-slate-800 text-center">
              <div>
                <span className="text-[10px] text-slate-400 block">Form 2 Net</span>
                <span className="text-sm font-bold font-mono-num text-white">
                  ${(auditData.row?.form2Net ?? 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Form 3 Net</span>
                <span className="text-sm font-bold font-mono-num text-white">
                  ${(auditData.row?.form3Net ?? 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-purple-300 block font-bold">Sum 2 & 3 Net</span>
                <span className="text-sm font-black font-mono-num text-[#FF8A00]">
                  ${(auditData.row?.sumForm2And3Net ?? 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-emerald-300 block font-bold">Sales</span>
                <span className="text-sm font-bold font-mono-num text-emerald-400">
                  ${(auditData.row?.sales ?? 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-indigo-300 block font-bold">Should Have</span>
                <span className="text-sm font-black font-mono-num text-indigo-300">
                  ${(auditData.row?.shouldHave ?? 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-bold">Variance</span>
                <span
                  className={`text-sm font-black font-mono-num ${
                    Math.abs(auditData.row?.variance || 0) < 0.01
                      ? 'text-emerald-400'
                      : (auditData.row?.variance || 0) < 0
                      ? 'text-rose-400'
                      : 'text-orange-400'
                  }`}
                >
                  {Math.abs(auditData.row?.variance || 0) < 0.01
                    ? '$0.00'
                    : (auditData.row?.variance || 0) < 0
                    ? `-$${Math.abs(auditData.row?.variance || 0).toFixed(2)}`
                    : `+$${(auditData.row?.variance || 0).toFixed(2)}`}
                </span>
              </div>
            </div>

            {/* Form 4 Cash Balancing Breakdown */}
            {auditData.row && (
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-indigo-500/30 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center space-x-2">
                    <Calculator className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-xs uppercase tracking-wider text-indigo-200">
                      Form 4 Cash Balancing Breakdown
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Expected Cash in Till</span>
                    <span className="text-sm font-mono-num font-black text-indigo-300">
                      ${(auditData.row.expectedCash ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px]">
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">+ Float</span>
                    <span className="font-mono-num font-bold text-emerald-400">
                      +${(auditData.row.float ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">+ Cash Sales</span>
                    <span className="font-mono-num font-bold text-emerald-400">
                      +${(auditData.row.cashSales ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">+ Credit Payments</span>
                    <span className="font-mono-num font-bold text-emerald-400">
                      +${(auditData.row.creditPayments ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">- Expenses</span>
                    <span className="font-mono-num font-bold text-rose-400">
                      -${(auditData.row.expenses ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">- Direct Procurements</span>
                    <span className="font-mono-num font-bold text-rose-400">
                      -${(auditData.row.directProcurements ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">- Cash Lift</span>
                    <span className="font-mono-num font-bold text-rose-400">
                      -${(auditData.row.cashLift ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">- Customer Change</span>
                    <span className="font-mono-num font-bold text-rose-400">
                      -${(auditData.row.customerChange ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">- Deductions</span>
                    <span className="font-mono-num font-bold text-rose-400">
                      -${(auditData.row.deductions ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {(auditData.row.activeCurrencies || getActiveCurrencies()).map((c: any) => {
                    const wVal =
                      (auditData.row?.currencyWithdrawals &&
                        auditData.row.currencyWithdrawals[c.currency]) ??
                      (c.currency === 'EcoCash'
                        ? auditData.row?.ecocashWithdrawal
                        : c.currency === 'ZiG'
                        ? auditData.row?.zigWithdrawal
                        : 0) ??
                      0;
                    return (
                      <div
                        key={c.currency}
                        className="p-2 rounded-xl bg-purple-950/30 border border-purple-800/40"
                      >
                        <span className="text-purple-300 block text-[10px] font-semibold">
                          - {c.name} Cash-Out
                        </span>
                        <span className="font-mono-num font-bold text-rose-400">
                          -${(Number(wVal) || 0).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 gap-2">
                  <div className="flex items-center space-x-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                    <span>Non-Cash Sales (Reporting Only — Not in Expected Physical Cash):</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-num">
                    {(auditData.row.activeCurrencies || getActiveCurrencies()).map((c: any) => {
                      const sVal =
                        (auditData.row?.currencySales &&
                          auditData.row.currencySales[c.currency]) ??
                        (c.currency === 'EcoCash'
                          ? auditData.row?.ecocashSales
                          : c.currency === 'ZiG'
                          ? auditData.row?.zigSales
                          : 0) ??
                        0;
                      return (
                        <span key={c.currency}>
                          {c.name}: ${Number(sVal).toFixed(2)}
                        </span>
                      );
                    })}
                    <span className="text-slate-200 font-bold">
                      Total Non-Cash: ${(auditData.row.totalNonCashSales ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {auditData.form1Count && (
              <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <Coins className="w-4 h-4 text-emerald-400" />
                  <span>Form 1 (Physical Cash Count Counted):</span>
                </div>
                <span className="font-mono-num font-black text-emerald-300 text-sm">
                  ${(auditData.form1Count.finalCashOutTotal ?? 0).toFixed(2)}
                </span>
              </div>
            )}

            {/* Canonical Cash Movements */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <History className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Canonical Cash Movements ({auditData.staffMovements.length})</span>
                </span>
                <span className="text-indigo-300 font-mono-num font-bold">
                  Expected: ${(auditData.row?.expectedCash ?? 0).toFixed(2)}
                </span>
              </h4>

              {auditData.staffMovements.length === 0 ? (
                <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                  No canonical ledger movements recorded for this staff on {date}.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {auditData.staffMovements.map((mov, movIdx) => {
                    const isIn = mov.direction === 'in';
                    const isOut = mov.direction === 'out';
                    const timeStr = new Date(mov.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={`${mov.id}-${movIdx}`}
                        className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px] gap-2"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                isIn
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : isOut
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              }`}
                            >
                              {mov.direction}
                            </span>
                            <span className="font-bold text-white uppercase tracking-tight text-[10px]">
                              {String(mov.type || '').replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono-num">
                              {timeStr}
                            </span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                              {mov.sourceModule}
                            </span>
                          </div>
                          <p className="text-slate-400 truncate text-[10px]">
                            {mov.notes || mov.sourceRef || 'No details'}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono-num font-black text-xs block ${
                              isIn
                                ? 'text-emerald-400'
                                : isOut
                                ? 'text-rose-400'
                                : 'text-indigo-300'
                            }`}
                          >
                            {isIn ? '+' : isOut ? '-' : ''}${(mov.amount ?? 0).toFixed(2)}
                          </span>
                          <span className="text-[9px] text-slate-500 block">
                            {mov.affectsDrawer ? 'Drawer' : 'Non-Drawer'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Form 2 Raw Logs */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                <span>Form 2: Cash Log Movements ({auditData.form2Logs.length})</span>
                <span className="text-purple-300 font-mono-num font-bold">
                  Net: ${(auditData.row?.form2Net ?? 0).toFixed(2)}
                </span>
              </h4>
              {auditData.form2Logs.length === 0 ? (
                <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                  No Form 2 cash log movements for this date.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {auditData.form2Logs.map((log, logIdx) => (
                    <div
                      key={`${log.id}-${logIdx}`}
                      className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-bold text-white">{log.line}</span>
                        <span className="text-slate-400 ml-1.5">({log.description})</span>
                      </div>
                      <div className="text-right font-mono-num font-bold">
                        {log.in > 0 && <span className="text-emerald-400">+${(log.in ?? 0).toFixed(2)}</span>}
                        {log.out > 0 && <span className="text-rose-400">-${(log.out ?? 0).toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form 3 Raw Entries */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                <span>Form 3: Customer Change Records ({auditData.form3Changes.length})</span>
                <span className="text-slate-400 font-mono-num">
                  Net: $
                  {(
                    (auditData.row?.changeReceived ?? auditData.row?.changeIn ?? 0) -
                    (auditData.row?.changePaid ?? auditData.row?.customerChange ?? 0)
                  ).toFixed(2)}
                </span>
              </h4>
              {auditData.form3Changes.length === 0 ? (
                <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                  No Form 3 customer change entries for this date.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {auditData.form3Changes.map((chg, chgIdx) => (
                    <div
                      key={`${chg.id}-${chgIdx}`}
                      className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-bold text-white">{chg.customerName}</span>
                        {chg.notes && <span className="text-slate-400 ml-1.5">"{chg.notes}"</span>}
                      </div>
                      <div className="text-right font-mono-num font-bold">
                        {chg.in > 0 && <span className="text-emerald-400">+${chg.in.toFixed(2)} In </span>}
                        {chg.out > 0 && <span className="text-rose-400">-${chg.out.toFixed(2)} Out</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {auditData.form3Credits.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Form 3: Credit Sales ({auditData.form3Credits.length})
                </h4>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {auditData.form3Credits.map((cr, crIdx) => (
                    <div
                      key={`${cr.id}-${crIdx}`}
                      className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-bold text-white">{cr.customerName}</span>
                        <span className="text-slate-400 ml-1.5">({cr.itemDescription})</span>
                      </div>
                      <div className="text-right font-mono-num font-bold text-amber-300">
                        ${(cr.amount ?? 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recorded Sales */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Recorded Sales ({auditData.staffSales.length + (auditData.adminSale ? 1 : 0)})
                  </span>
                </span>
                <span className="text-emerald-400 font-mono-num font-bold">
                  Total: $
                  {(
                    auditData.staffSales.reduce((sum, s) => sum + (s.total || 0), 0) +
                    (auditData.adminSale && auditData.staffSales.length === 0
                      ? auditData.adminSale.salesAmount || 0
                      : 0)
                  ).toFixed(2)}
                </span>
              </h4>
              {auditData.staffSales.length === 0 && !auditData.adminSale ? (
                <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                  No sales invoices recorded for this salesperson on this date.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {auditData.staffSales.map((sale, saleIdx) => (
                    <div
                      key={`${sale.id}-${saleIdx}`}
                      className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white font-mono-num">
                            {sale.id || 'POS-INV'}
                          </span>
                          <span className="text-slate-400">
                            • {sale.customerName || 'Walk-in Customer'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-semibold">
                            {sale.paymentMethod || sale.currency || 'Cash'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-sm">
                          {sale.itemsSummary ||
                            (sale.items && sale.items.length > 0
                              ? sale.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')
                              : 'General Store Sale Items')}
                        </div>
                      </div>
                      <div className="text-right font-mono-num font-bold text-emerald-400 text-xs">
                        ${(sale.total ?? 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="print:hidden p-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
            {isBalanced ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Balanced — ready for cashier sign-off.</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Review variance notes and print for cashier sign-off.</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
          >
            Close Shift Report
          </button>
        </div>
      </div>
    </div>
  );
};
