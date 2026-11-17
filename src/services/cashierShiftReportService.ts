// ============================================================================
// CASHIER SHIFT & VARIANCE AUDIT REPORT SERVICE
// Builds a unified, print-ready report (58mm / 80mm Bluetooth ESC/POS & A4/PDF)
// using the exact Form 4 balancing math while filtering to active cash items
// and excluding non-cash Shop Use / Internal Consumption.
// ============================================================================

import {
  getAdminSaleForStaffAndDate,
  getAllDirectGrvs,
  getBranches,
  getCashCountForStaffAndDate,
  getCashLiftsForStaffAndDate,
  getCashLogsForStaffAndDate,
  getCompanies,
  getCreditSalesForStaffAndDate,
  getCurrentBranch,
  getCurrentCompany,
  getCustomerChangesForStaffAndDate,
  getDirectGrvPaymentsForStaff,
  getExpensesForStaffAndDate,
  getSalesForStaffAndDate,
  getAllSalesForStaffAndDate,
  getActiveCurrencies,
  deduplicateCashLogs,
  sortChronologicallyAsc,
  isCashLogWithdrawal,
  calculateSalespersonCashBalancing,
} from '../db/roomDatabase';
import { getAllMovements, getShiftId, matchesShift } from '../db/cashLedger';
import { getPrinterConfig } from './bluetoothPrinter';
import { toDateStringSafe } from '../utils/dateUtils';
import { Form4BalancingResult, Salesperson } from '../types';

export type ShiftReportPaperFormat = '58mm' | '80mm' | 'A4';
export type ShiftReportDetailMode = 'compact' | 'full';

export interface ShiftReportFloatItem {
  id: string;
  time: string;
  description: string;
  reference?: string;
  amount: number;
}

export interface ShiftReportForm2Item {
  id: string;
  time: string;
  line: string;
  category: string;
  description: string;
  reference?: string;
  currency: string;
  inAmount: number;
  outAmount: number;
}

export interface ShiftReportForm3ChangeItem {
  id: string;
  time: string;
  customerName: string;
  notes?: string;
  inAmount: number;
  outAmount: number;
  status: string;
}

export interface ShiftReportForm3CreditItem {
  id: string;
  time: string;
  customerName: string;
  itemDescription: string;
  amount: number;
  inAmount: number;
  outAmount: number;
  status: string;
}

export interface ShiftReportMultiCurrencySummary {
  currency: string;
  goodsTotalUsd: number;
  cashOutUsd: number;
  nativeExpected: number;
  nativeVerified: number;
  txCount: number;
  verifiedCount: number;
  pendingCount: number;
  flaggedCount: number;
}

export interface ShiftReportMultiCurrencyTx {
  id: string;
  time: string;
  currency: string;
  source: 'POS_SALE' | 'FORM2_LOG';
  customerOrDesc: string;
  goodsUsd: number;
  cashOutUsd: number;
  nativeAmount: number;
  exchangeRate?: number;
  verificationStatus: 'VERIFIED' | 'PENDING' | 'FLAGGED' | 'LOG_ONLY';
  popReference?: string;
  disputeResolution?: string;
}

export interface ShiftReportCashLiftItem {
  id: string;
  time: string;
  supervisorName: string;
  amount: number;
  reason?: string;
  overageAmount?: number;
}

export interface ShiftReportExpenseItem {
  id: string;
  time: string;
  category: string;
  description: string;
  amount: number;
  status: string;
  receiptRef?: string;
  vendorOrCustomer?: string;
  source: 'EXPENSE_DB' | 'FORM2_LOG';
}

export interface ShiftReportDirectGrvItem {
  id: string;
  grvNumber: string;
  supplierName: string;
  amount: number;
  status: string;
}

export interface ShiftReportDenominationLine {
  label: string;
  count: number;
  value: number;
}

export interface CashierShiftReportData {
  companyId: string;
  storeName: string;
  branchName: string;
  storeAddress?: string;
  storePhone?: string;
  taxNumber?: string;
  date: string;
  shiftId: string;
  generatedAt: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  status: 'Balanced' | 'Over' | 'Shortage' | 'No Activity' | 'Pending Form 1';

  // Core Balancing Equation (Exact Form 4 Parity)
  float: number;
  cashSales: number;
  systemCashSales: number;
  mobileShortfallCharged: number;
  creditPayments: number; // Credit repayments + customer change left behind
  creditRepaymentsIn: number;
  changeLeftBehindIn: number;
  expenses: number; // Cash expenses only (Shop Use excluded)
  directProcurements: number;
  cashLift: number;
  customerChangePaidOut: number;
  creditCashOut: number;
  creditExtended: number;
  refunds: number;
  deductions: number;
  multiCurrencyCashOutTotal: number;
  currencyWithdrawalsMap: Record<string, number>;
  currencySalesMap: Record<string, number>;
  expectedCash: number;
  submittedForm1Cash: number | null;
  variance: number;

  // Supplementary Form 1-4 Totals
  form2Net: number;
  form3Net: number;
  sumForm2And3Net: number;
  totalSales: number;
  totalNonCashSales: number;
  isOverridden: boolean;
  form1Notes?: string;
  form1Denominations: ShiftReportDenominationLine[];

  // Diagnostic Hints ("Why you may not be balancing")
  varianceDiagnosis: string[];

  // Active Itemized Lists
  floatEntries: ShiftReportFloatItem[];
  cashSalesSummary: {
    count: number;
    total: number;
    flaggedMobileShortageCount: number;
    flaggedMobileShortageTotal: number;
  };
  form2Entries: ShiftReportForm2Item[];
  form3ChangeEntries: ShiftReportForm3ChangeItem[];
  form3CreditEntries: ShiftReportForm3CreditItem[];
  multiCurrencySummary: ShiftReportMultiCurrencySummary[];
  multiCurrencyTransactions: ShiftReportMultiCurrencyTx[];
  activeCashLifts: ShiftReportCashLiftItem[];
  activeExpenses: ShiftReportExpenseItem[];
  excludedShopUseCount: number;
  excludedShopUseAmount: number;
  activeDirectGrvs: ShiftReportDirectGrvItem[];
}

const formatTimeShort = (isoOrDate?: string): string => {
  if (!isoOrDate) return '--:--';
  const d = new Date(isoOrDate);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return String(isoOrDate).slice(11, 16) || '--:--';
};

const isShopUseRecord = (item: {
  category?: string;
  line?: string;
  description?: string;
  paymentMethod?: string;
  notes?: string;
}): boolean => {
  const pm = (item.paymentMethod || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const line = (item.line || '').toLowerCase();
  const desc = (item.description || '').toLowerCase();
  const notes = (item.notes || '').toLowerCase();

  return (
    pm.includes('non-cash') ||
    pm.includes('shop use') ||
    pm.includes('internal consumption') ||
    cat.includes('shop use') ||
    cat.includes('internal consumption') ||
    line.includes('shop use') ||
    line.includes('internal consumption') ||
    desc.includes('shop use /') ||
    desc.includes('shop use') ||
    desc.includes('internal consumption') ||
    desc.includes('owner drawing') ||
    notes.includes('non-cash inventory meal/supplies')
  );
};

const isVoidedOrInactive = (item: any): boolean => {
  if (!item) return true;
  if (item.isDeleted || item.voided || item.isVoided || item.cancelled) return true;
  const status = String(item.status || '').toLowerCase();
  return status === 'voided' || status === 'cancelled' || status === 'rejected' || status === 'deleted';
};

const isCashExpenseLog = (l: any): boolean => {
  if ((l.out || 0) <= 0) return false;
  if (isShopUseRecord(l)) return false;
  const line = (l.line || '').toLowerCase();
  const cat = (l.category || '').toLowerCase();
  const group = (l.categoryGroup || '').toLowerCase();
  const desc = (l.description || '').toLowerCase();
  return (
    line === 'expenses' ||
    cat === 'expenses' ||
    line === 'daily store expenses' ||
    cat === 'daily store expenses' ||
    group === 'daily store expenses' ||
    line.includes('expense') ||
    line.includes('petty') ||
    cat.includes('expense') ||
    cat.includes('petty') ||
    desc.includes('expense') ||
    desc.includes('petty') ||
    line === 'bread' ||
    line === 'airtime' ||
    line === 'home use' ||
    line === 'daily utilities & home' ||
    cat === 'daily utilities & home' ||
    group === 'daily utilities & home' ||
    desc.includes('bread') ||
    desc.includes('airtime') ||
    desc.includes('home use') ||
    desc.includes('utilities')
  );
};

const isMultiCurrencySale = (s: any, activeCodes: string[]): boolean => {
  const pm = (s.paymentMethod || '').toLowerCase();
  const curr = (s.currency || '').toLowerCase();
  if (pm === 'cash' || (!pm && (!curr || curr === 'usd'))) return false;
  if (pm === 'credit') return false;
  if (pm.includes('eco') || curr.includes('eco') || pm.includes('zig') || curr.includes('zig')) return true;
  return activeCodes.some((code) => {
    const lc = code.toLowerCase();
    return lc !== 'usd' && (pm === lc || curr === lc || pm.includes(lc));
  });
};

export const buildCashierShiftReportData = (params: {
  staff: Salesperson | { id: string; name: string; role?: string };
  date: string;
  branchId?: string;
  row?: Form4BalancingResult;
}): CashierShiftReportData => {
  const { staff, date, branchId } = params;
  const row =
    params.row ||
    calculateSalespersonCashBalancing(staff.id, staff.name, date, undefined, branchId);

  const comp = getCurrentCompany() || getCompanies()[0];
  const branch =
    getBranches().find((b) => b.id === branchId || b.branch_id === branchId) ||
    getCurrentBranch();
  const printerCfg = getPrinterConfig(comp?.company_id);

  const storeName = comp?.company_name || printerCfg.storeName || 'SAIMETRIC POS';
  const branchName =
    branch?.name || (branch as any)?.branch_name || printerCfg.branchName || 'Main Branch';
  const storeAddress =
    branch?.location || (branch as any)?.address || printerCfg.storeAddress || '';
  const storePhone = branch?.phone || comp?.phone || printerCfg.storePhone || '';
  const taxNumber =
    (comp as any)?.tax_number || (comp as any)?.taxNumber || printerCfg.taxNumber || '';

  const shiftId = getShiftId(staff.id, date, branchId);

  // Raw data collections scoped to this cashier & date (sorted chronologically ascending)
  const rawForm2Logs = getCashLogsForStaffAndDate(staff.id, date).filter(
    (l) => !isVoidedOrInactive(l)
  );
  const dedupedForm2Logs = sortChronologicallyAsc(deduplicateCashLogs(rawForm2Logs));
  const form3Changes = sortChronologicallyAsc(
    getCustomerChangesForStaffAndDate(staff.id, date, staff.name).filter(
      (c) => !isVoidedOrInactive(c)
    )
  );
  const form3Credits = sortChronologicallyAsc(
    getCreditSalesForStaffAndDate(staff.id, date, staff.name).filter(
      (c) => !isVoidedOrInactive(c)
    )
  );
  const form1Count = getCashCountForStaffAndDate(staff.id, date);
  const allSalesSorted = getAllSalesForStaffAndDate(staff.id, date, staff.name, true).filter(
    (s) => !s?.isDeleted
  );
  const rawSales = sortChronologicallyAsc(
    getSalesForStaffAndDate(staff.id, date, staff.name).filter(
      (s) => !isVoidedOrInactive(s)
    )
  );
  const adminSale = getAdminSaleForStaffAndDate(staff.id, date);
  const cashLifts = sortChronologicallyAsc(
    getCashLiftsForStaffAndDate(staff.id, date).filter(
      (l) => !isVoidedOrInactive(l)
    )
  );
  const allStaffExpenses = sortChronologicallyAsc(getExpensesForStaffAndDate(staff.id, date));
  const directGrvPayments = getDirectGrvPaymentsForStaff(staff.id, date, false, staff.name);
  const allDirectGrvs = getAllDirectGrvs();
  const activeCurrencies = getActiveCurrencies();
  const activeCurrencyCodes = activeCurrencies.map((c) => c.code);

  // 1. Float Entries
  const floatLogs = dedupedForm2Logs.filter(
    (l) =>
      (l.in || 0) > 0 &&
      (l.line === 'Float' ||
        l.line === 'float' ||
        l.category === 'Float' ||
        (l as any).categoryGroup === 'Float & Closeout' ||
        l.description?.toLowerCase().startsWith('float'))
  );
  const floatEntries: ShiftReportFloatItem[] = floatLogs.map((l) => ({
    id: l.id,
    time: formatTimeShort(l.timestamp),
    description: l.description || l.line || 'Opening Float',
    reference: l.reference,
    amount: Number(l.in || 0),
  }));
  if (floatEntries.length === 0 && (row.float || 0) > 0) {
    floatEntries.push({
      id: 'FLOAT-CALC',
      time: '--:--',
      description: 'Issued Shift Float',
      amount: Number(row.float || 0),
    });
  }

  // 2. Form 2 Entries (exclude Shop Use non-cash entries if any exist)
  const form2Entries: ShiftReportForm2Item[] = dedupedForm2Logs
    .filter((l) => !isShopUseRecord(l))
    .map((l) => ({
      id: l.id,
      time: formatTimeShort(l.timestamp),
      line: l.line || l.category || 'Entry',
      category: l.category || l.line || 'General',
      description: l.description || l.line || '',
      reference: l.reference,
      currency: l.currency || 'USD',
      inAmount: Number(l.in || 0),
      outAmount: Number(l.out || 0),
    }));

  // 3. Form 3 Change & Credit
  const form3ChangeEntries: ShiftReportForm3ChangeItem[] = form3Changes.map((c) => ({
    id: c.id,
    time: formatTimeShort(c.timestamp),
    customerName: c.customerName || 'Walk-in Customer',
    notes: c.notes,
    inAmount: Number(c.in || 0),
    outAmount: Number(c.out || 0),
    status: c.status || 'Active',
  }));

  const form3CreditEntries: ShiftReportForm3CreditItem[] = form3Credits.map((c) => ({
    id: c.id,
    time: formatTimeShort(c.timestamp),
    customerName: c.customerName || 'Customer',
    itemDescription: c.itemDescription || c.notes || 'Credit Transaction',
    amount: Number(c.amount || 0),
    inAmount: Number(c.in || 0),
    outAmount: Number(c.out || c.amount || 0),
    status: c.status || 'Active',
  }));

  // 4. Cash Sales Summary + Flagged Mobile Shortages Charged to Cashier
  const cashSalesList = rawSales.filter(
    (s) => s.paymentMethod === 'Cash' || (!s.paymentMethod && (!s.currency || s.currency === 'USD'))
  );
  const systemCashSales = cashSalesList.reduce(
    (sum, s) => sum + Math.max(0, (s.total || 0) - (s.customerCreditUsed || 0)),
    0
  );
  const flaggedMobileSales = rawSales.filter(
    (s) =>
      s.mobileVerificationStatus === 'FLAGGED' &&
      s.mobileDisputeResolution === 'CHARGED_TO_CASHIER_SHORTAGE'
  );
  const mobileShortfallCharged =
    Math.round(
      rawSales.reduce((sum, s) => {
        if (s.mobileVerificationStatus === 'FLAGGED' && s.mobileDisputeResolution === 'CHARGED_TO_CASHIER_SHORTAGE') {
          return sum + (Number(s.total) || 0);
        }
        if (
          s.mobileVerificationStatus === 'VERIFIED' &&
          s.mobileDisputeResolution === 'CHARGED_TO_CASHIER_SHORTAGE' &&
          (Number(s.mobileShortfallUsd) || 0) > 0.009
        ) {
          const shortfall = Number(s.mobileShortfallUsd) || 0;
          const wdr = Number(s.cashWithdrawalAmount) || 0;
          const wdrRed = Math.min(shortfall, wdr);
          return sum + Math.max(0, shortfall - wdrRed);
        }
        return sum;
      }, 0) * 100
    ) / 100;

  // 5. Active Multi-Currency Transactions & Per-Currency Summaries
  const multiCurrencyTransactions: ShiftReportMultiCurrencyTx[] = [];
  const summaryMap = new Map<string, ShiftReportMultiCurrencySummary>();

  const canonicalizeCurrLabel = (curr: string): string => {
    const clean = String(curr || '').trim();
    const low = clean.toLowerCase();
    if (low.includes('eco')) return 'EcoCash';
    if (low.includes('zig')) return 'ZiG';
    return clean || 'MultiCurr';
  };

  const ensureCurrSummary = (curr: string): ShiftReportMultiCurrencySummary => {
    const canon = canonicalizeCurrLabel(curr);
    const key = canon.toUpperCase();
    const existing = summaryMap.get(key);
    if (existing) return existing;
    const created: ShiftReportMultiCurrencySummary = {
      currency: canon,
      goodsTotalUsd: 0,
      cashOutUsd: 0,
      nativeExpected: 0,
      nativeVerified: 0,
      txCount: 0,
      verifiedCount: 0,
      pendingCount: 0,
      flaggedCount: 0,
    };
    summaryMap.set(key, created);
    return created;
  };

  // 5a. POS Multi-Currency Sales (use allSalesSorted so Refunded/Voided goods are excluded without leaking Form 2 duplicates)
  const recordedSaleIds = new Set<string>();
  allSalesSorted
    .filter((s) => isMultiCurrencySale(s, activeCurrencyCodes))
    .forEach((s) => {
      const saleIdLower = String(s.id || '').toLowerCase();
      if (saleIdLower) recordedSaleIds.add(saleIdLower);

      const isReversed = s.status === 'Refunded' || s.status === 'Voided';
      const cashOutUsd = Number(s.cashWithdrawalAmount || 0);
      // Skip purely reversed sales that had no physical USD cash handed out
      if (isReversed && (cashOutUsd <= 0 || s.status === 'Voided')) {
        return;
      }

      const rawLabel =
        s.currency && s.currency !== 'USD' ? s.currency : s.paymentMethod || 'Mobile';
      const currLabel = canonicalizeCurrLabel(rawLabel);
      const goodsUsd = isReversed ? 0 : Number(s.total || 0);
      const rate = Number(s.exchangeRate || 1);
      const nativeAmount = isReversed
        ? cashOutUsd * rate
        : Number(
            s.totalChargedInCurrency ??
              (s.totalInCurrency !== undefined
                ? Number(s.totalInCurrency) + Number(s.cashWithdrawalInCurrency || 0)
                : (goodsUsd + cashOutUsd) * rate)
          );

      const verStatus: ShiftReportMultiCurrencyTx['verificationStatus'] =
        s.mobileVerificationStatus === 'VERIFIED'
          ? 'VERIFIED'
          : s.mobileVerificationStatus === 'FLAGGED'
          ? 'FLAGGED'
          : 'PENDING';

      multiCurrencyTransactions.push({
        id: s.id,
        time: formatTimeShort(s.timestamp),
        currency: currLabel,
        source: 'POS_SALE',
        customerOrDesc: isReversed
          ? `${s.customerName || 'Walk-in Customer'} (${s.status} - Cash-Out Retained)`
          : s.customerName || 'Walk-in Customer',
        goodsUsd,
        cashOutUsd,
        nativeAmount,
        exchangeRate: rate,
        verificationStatus: verStatus,
        popReference: s.mobilePopReference,
        disputeResolution: s.mobileDisputeResolution,
      });

      const sumObj = ensureCurrSummary(currLabel);
      sumObj.txCount += 1;
      if (verStatus === 'VERIFIED') {
        sumObj.verifiedCount += 1;
        sumObj.nativeVerified += Number(s.mobileVerifiedAmount ?? nativeAmount);
      } else if (verStatus === 'FLAGGED') {
        sumObj.flaggedCount += 1;
      } else {
        sumObj.pendingCount += 1;
      }
      if (
        !(
          s.mobileVerificationStatus === 'FLAGGED' &&
          s.mobileDisputeResolution === 'CHARGED_TO_CASHIER_SHORTAGE'
        )
      ) {
        sumObj.goodsTotalUsd += goodsUsd;
        sumObj.cashOutUsd += cashOutUsd;
      }
      sumObj.nativeExpected += nativeAmount;
    });

  // 5b. Standalone Form 2 Multi-Currency Logs (not already matched to a POS sale)
  dedupedForm2Logs.forEach((l) => {
    if ((l as any).isRefunded || (l as any).isVoided) return;
    const curr = (l.currency || '').trim();
    const lineLower = (l.line || '').toLowerCase();
    const descLower = (l.description || '').toLowerCase();
    const isMcLog =
      (curr && curr.toUpperCase() !== 'USD') ||
      lineLower.includes('ecocash') ||
      lineLower.includes('zig') ||
      descLower.includes('ecocash') ||
      descLower.includes('zig') ||
      activeCurrencyCodes.some((c) => {
        const lc = c.toLowerCase();
        return lc !== 'usd' && (lineLower.includes(lc) || descLower.includes(lc));
      });

    if (!isMcLog || isShopUseRecord(l)) return;

    const refLower = String(l.reference || '').toLowerCase();
    const alreadyFromSale =
      (refLower && recordedSaleIds.has(refLower)) ||
      Array.from(recordedSaleIds).some((sid) => sid && descLower.includes(sid));
    if (alreadyFromSale) return;

    const resolvedCurr =
      curr && curr.toUpperCase() !== 'USD'
        ? curr
        : lineLower.includes('eco') || descLower.includes('eco')
        ? 'EcoCash'
        : lineLower.includes('zig') || descLower.includes('zig')
        ? 'ZiG'
        : activeCurrencyCodes.find(
            (c) =>
              c.toLowerCase() !== 'usd' &&
              (lineLower.includes(c.toLowerCase()) || descLower.includes(c.toLowerCase()))
          ) || 'MultiCurr';

    const outAmt = Number(l.out || 0);
    const inAmt = Number(l.in || 0);
    const isWdr = isCashLogWithdrawal(l);
    const cashOutUsd = isWdr ? outAmt : 0;
    const goodsUsd = isWdr ? 0 : (inAmt > 0 ? inAmt : outAmt);
    multiCurrencyTransactions.push({
      id: l.id,
      time: formatTimeShort(l.timestamp),
      currency: resolvedCurr,
      source: 'FORM2_LOG',
      customerOrDesc: l.description || l.line || 'Multi-Currency Cash Log',
      goodsUsd,
      cashOutUsd,
      nativeAmount: Number((l as any).nativeAmount || cashOutUsd || goodsUsd),
      verificationStatus: 'LOG_ONLY',
      popReference: l.reference,
    });

    const sumObj = ensureCurrSummary(resolvedCurr);
    sumObj.txCount += 1;
    sumObj.goodsTotalUsd += goodsUsd;
    sumObj.cashOutUsd += cashOutUsd;
  });

  // Ensure summary reflects authoritative Form 4 totals for each active currency
  Object.entries(row.currencyWithdrawals || {}).forEach(([code, wdr]) => {
    const wdrNum = Number(wdr || 0);
    const goodsNum = Number((row.currencySales && row.currencySales[code]) || 0);
    if (wdrNum > 0 || goodsNum > 0) {
      const sObj = ensureCurrSummary(code);
      sObj.cashOutUsd = Math.max(sObj.cashOutUsd, wdrNum);
      sObj.goodsTotalUsd = Math.max(sObj.goodsTotalUsd, goodsNum);
    }
  });

  // 6. Active Supervisor Cash Lifts
  const activeCashLifts: ShiftReportCashLiftItem[] = cashLifts.map((l) => ({
    id: l.id,
    time: formatTimeShort(l.timestamp),
    supervisorName: l.supervisorName || 'Supervisor',
    amount: Number(l.totalAmount ?? l.amount ?? 0),
    reason: l.reason || l.notes,
    overageAmount: l.overageAmount,
  }));

  // 7. Active Cash Expenses ONLY (Explicitly EXCLUDE Shop Use / Internal Consumption / Non-Cash / Rejected / Deleted)
  let excludedShopUseCount = 0;
  let excludedShopUseAmount = 0;
  const activeExpenses: ShiftReportExpenseItem[] = [];

  allStaffExpenses.forEach((e) => {
    if (e.isDeleted || e.status === 'rejected') return;
    if (isShopUseRecord(e)) {
      excludedShopUseCount += 1;
      excludedShopUseAmount += Number(e.amount || 0);
      return;
    }
    const pm = (e.paymentMethod || '').toLowerCase();
    if (pm && pm !== 'cash') return;
    // Exclude Direct GRV auto-created voucher expenses (shown in Direct GRVs / Direct Procurements)
    if (
      e.category === 'Direct Supplier Delivery Payout' ||
      e.description?.toLowerCase().includes('direct delivery voucher')
    ) {
      return;
    }
    activeExpenses.push({
      id: e.id,
      time: formatTimeShort(e.timestamp),
      category: e.category || 'Expense',
      description: e.description || e.category || 'Cash Expense',
      amount: Number(e.amount || 0),
      status: e.status || 'pending',
      receiptRef: e.receiptRef,
      vendorOrCustomer: e.vendorOrCustomer,
      source: 'EXPENSE_DB',
    });
  });

  // Also include Form 2 utility/expense cash-out logs not already linked to an Expense DB entry
  dedupedForm2Logs
    .filter((l) => isCashExpenseLog(l))
    .forEach((l) => {
      const alreadyMatched = activeExpenses.some(
        (e) =>
          (l.reference && l.reference === e.id) ||
          (e.description && l.description?.toLowerCase().includes(e.description.toLowerCase()))
      );
      if (!alreadyMatched) {
        activeExpenses.push({
          id: l.id,
          time: formatTimeShort(l.timestamp),
          category: l.line || l.category || 'Form 2 Expense',
          description: l.description || l.line || 'Cash Expense',
          amount: Number(l.out || 0),
          status: 'logged',
          receiptRef: l.reference,
          source: 'FORM2_LOG',
        });
      }
    });

  // 8. Active Direct GRV Cash Payouts
  const activeDirectGrvs: ShiftReportDirectGrvItem[] = directGrvPayments
    .filter(({ grv }) => !isVoidedOrInactive(grv))
    .map(({ grv, payment }) => ({
      id: grv.id,
      grvNumber: grv.grvNumber || grv.id,
      supplierName: grv.supplierName || 'Direct Supplier',
      amount: Number(payment.amount || 0),
      status: grv.status || 'Active',
    }));

  // Also check if any Direct GRVs exist via fallback
  if (activeDirectGrvs.length === 0 && (row.directProcurements || 0) > 0) {
    allDirectGrvs
      .filter(
        (g) =>
          !isVoidedOrInactive(g) &&
          toDateStringSafe(g.date || g.createdAt) === date &&
          g.staffId === staff.id
      )
      .forEach((g) => {
        const cashPaid = Number(g.cashPaidFromTill || 0);
        if (cashPaid > 0) {
          activeDirectGrvs.push({
            id: g.id,
            grvNumber: g.grvNumber || g.id,
            supplierName: g.supplierName || 'Direct Supplier',
            amount: cashPaid,
            status: g.status || 'Active',
          });
        }
      });
  }

  // 9. Form 1 Denominations
  const form1Denominations: ShiftReportDenominationLine[] = [];
  if (form1Count?.denominations && typeof form1Count.denominations === 'object') {
    Object.entries(form1Count.denominations)
      .map(([denom, qty]) => ({
        label: `$${denom}`,
        denomNum: parseFloat(denom),
        count: Number(qty || 0),
        value: Number(denom) * Number(qty || 0),
      }))
      .filter((d) => d.count > 0 && !Number.isNaN(d.denomNum))
      .sort((a, b) => b.denomNum - a.denomNum)
      .forEach((d) =>
        form1Denominations.push({
          label: d.label,
          count: d.count,
          value: Math.round(d.value * 100) / 100,
        })
      );
  }

  // 10. Status & Variance Calculation
  const submittedForm1Cash =
    form1Count && typeof form1Count.finalCashOutTotal === 'number'
      ? Number(form1Count.finalCashOutTotal)
      : row.actualCashCount !== null && row.actualCashCount !== undefined
      ? Number(row.actualCashCount)
      : null;

  const expectedCash = Number(row.expectedCash || 0);
  const variance = Number(row.variance || 0);
  const reportStatus: CashierShiftReportData['status'] =
    submittedForm1Cash === null && row.status !== 'No Activity'
      ? 'Pending Form 1'
      : row.status || 'Balanced';

  // 11. "Why You May Not Be Balancing" Automated Variance Diagnosis
  const varianceDiagnosis: string[] = [];
  const multiCurrencyCashOutTotal = Number(
    row.totalMultiCurrencyWithdrawals ??
      ((row.ecocashWithdrawal || 0) + (row.zigWithdrawal || 0))
  );

  if (submittedForm1Cash === null) {
    varianceDiagnosis.push(
      `Form 1 physical cash count has NOT been submitted yet (Expected Cash in drawer: $${expectedCash.toFixed(2)}).`
    );
  } else if (Math.abs(variance) < 0.01) {
    varianceDiagnosis.push(
      'Drawer is BALANCED: Form 1 submitted cash matches expected till balance.'
    );
  } else if (variance < 0) {
    varianceDiagnosis.push(
      `Till is SHORT by $${Math.abs(variance).toFixed(2)} (Submitted $${submittedForm1Cash.toFixed(2)} vs Expected $${expectedCash.toFixed(2)}).`
    );
  } else {
    varianceDiagnosis.push(
      `Till is OVER by +$${variance.toFixed(2)} (Submitted $${submittedForm1Cash.toFixed(2)} vs Expected $${expectedCash.toFixed(2)}).`
    );
  }

  if (Math.abs(variance) >= 0.01 || submittedForm1Cash === null) {
    if (mobileShortfallCharged > 0.009) {
      varianceDiagnosis.push(
        `Flagged/unconfirmed mobile money claims of $${mobileShortfallCharged.toFixed(2)} (${flaggedMobileSales.length} txn) were charged back to Cash Sales.`
      );
    }
    const pendingMc = Array.from(summaryMap.values()).reduce((s, c) => s + c.pendingCount, 0);
    if (pendingMc > 0) {
      varianceDiagnosis.push(
        `${pendingMc} mobile money transaction(s) are still awaiting supervisor POP verification.`
      );
    }
    const pendingExp = activeExpenses.filter((e) => e.status === 'pending');
    if (pendingExp.length > 0) {
      const pendTotal = pendingExp.reduce((s, e) => s + e.amount, 0);
      varianceDiagnosis.push(
        `${pendingExp.length} cash expense(s) ($${pendTotal.toFixed(2)}) are still Pending Supervisor Approval.`
      );
    }
    if ((row.customerChange || 0) > 0 || form3ChangeEntries.length > 0) {
      const changeIn = form3ChangeEntries.reduce((s, c) => s + c.inAmount, 0);
      const changeOut = form3ChangeEntries.reduce((s, c) => s + c.outAmount, 0);
      varianceDiagnosis.push(
        `Form 3 Customer Change impact: +$${changeIn.toFixed(2)} left in till, -$${changeOut.toFixed(2)} paid out.`
      );
    }
    if (multiCurrencyCashOutTotal > 0) {
      varianceDiagnosis.push(
        `Multi-currency cash handed out to customers reduced expected cash by -$${multiCurrencyCashOutTotal.toFixed(2)}.`
      );
    }
    if ((row.cashLift || 0) > 0) {
      varianceDiagnosis.push(
        `Supervisor Cash Lifts (${activeCashLifts.length}) reduced expected drawer cash by -$${Number(row.cashLift).toFixed(2)}.`
      );
    }
    if (excludedShopUseCount > 0) {
      varianceDiagnosis.push(
        `${excludedShopUseCount} Shop Use / non-cash entry ($${excludedShopUseAmount.toFixed(2)}) excluded from cash balancing.`
      );
    }
    if ((row.refunds || 0) > 0) {
      varianceDiagnosis.push(
        `Form 2 Cash Refunds / Returns reduced expected drawer cash by -$${Number(row.refunds).toFixed(2)}.`
      );
    }
  }

  const creditCashOut = Number(row.creditCashOut || 0);
  const creditExtended = Number(row.creditExtended || 0);

  if (Math.abs(variance) >= 0.01 || submittedForm1Cash === null) {
    if (creditCashOut > 0) {
      varianceDiagnosis.push(
        `Form 3 Cash Credit loans handed out from till reduced expected drawer cash by -$${creditCashOut.toFixed(2)}.`
      );
    }
    if (creditExtended > 0) {
      varianceDiagnosis.push(
        `Goods sold on Credit ($${creditExtended.toFixed(2)}) excluded from expected physical cash.`
      );
    }
  }

  // Also include raw movements count sanity note if Form 2 + 3 net vs Sales+Float differs
  const allMovements = getAllMovements().filter((m) => matchesShift(m, shiftId, branchId));
  void allMovements;
  void adminSale;

  const creditRepaymentsIn = Math.max(
    Number(row.creditPayments || 0),
    form3Credits.reduce((s, c) => s + Number(c.in || 0), 0)
  );
  const changeLeftBehindIn = Math.max(
    Number(row.changeReceived ?? row.changeIn ?? 0),
    form3Changes
      .filter((c) => c.affectsDrawer !== false)
      .reduce((s, c) => s + Number(c.in || 0), 0)
  );

  return {
    companyId: comp?.company_id || 'COMP-001',
    storeName,
    branchName,
    storeAddress,
    storePhone,
    taxNumber,
    date,
    shiftId,
    generatedAt: new Date().toLocaleString(),
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role || 'Cashier',
    status: reportStatus,

    float: Number(row.float || 0),
    cashSales: Number(row.cashSales || 0),
    systemCashSales,
    mobileShortfallCharged,
    creditPayments: Number(row.creditPayments || 0),
    creditRepaymentsIn,
    changeLeftBehindIn,
    expenses: Number(row.expenses || 0),
    directProcurements: Number(row.directProcurements || 0),
    cashLift: Number(row.cashLift || 0),
    customerChangePaidOut: Number(row.customerChange || 0),
    creditCashOut,
    creditExtended,
    refunds: Number(row.refunds || 0),
    deductions: Number(row.deductions || 0),
    multiCurrencyCashOutTotal,
    currencyWithdrawalsMap: row.currencyWithdrawals || {},
    currencySalesMap: row.currencySales || {},
    expectedCash,
    submittedForm1Cash,
    variance,

    form2Net: Number(row.form2Net || 0),
    form3Net: Number(row.form3Net || 0),
    sumForm2And3Net: Number(row.sumForm2And3Net || 0),
    totalSales: Number(row.totalSales ?? row.sales ?? 0),
    totalNonCashSales: Number(row.totalNonCashSales || 0),
    isOverridden: Boolean(row.isOverridden),
    form1Notes: form1Count?.notes,
    form1Denominations,

    varianceDiagnosis,

    floatEntries,
    cashSalesSummary: {
      count: cashSalesList.length,
      total: systemCashSales,
      flaggedMobileShortageCount: flaggedMobileSales.length,
      flaggedMobileShortageTotal: mobileShortfallCharged,
    },
    form2Entries,
    form3ChangeEntries,
    form3CreditEntries,
    multiCurrencySummary: Array.from(summaryMap.values()),
    multiCurrencyTransactions,
    activeCashLifts,
    activeExpenses,
    excludedShopUseCount,
    excludedShopUseAmount,
    activeDirectGrvs,
  };
};
