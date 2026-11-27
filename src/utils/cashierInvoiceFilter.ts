import { SaleInvoice, Salesperson } from '../types';

export type CashierInvoiceFilterMode =
  | 'recent_5'
  | 'exact_match'
  | 'targeted_search'
  | 'query_too_short'
  | 'query_too_broad'
  | 'no_match';

export interface CashierInvoiceFilterResult {
  mode: CashierInvoiceFilterMode;
  invoices: SaleInvoice[];
  hint?: string;
}

const MAX_RECENT_CASHIER_INVOICES = 5;
const MAX_TARGETED_SEARCH_RESULTS = 5;
const MIN_SEARCH_QUERY_LEN = 3;

const GENERIC_BLOCKED_QUERIES = new Set([
  'walk',
  'walk-in',
  'walk in',
  'walkin',
  'walk-in customer',
  'walk in customer',
  'customer',
  'cash',
  'cash customer',
  'cash sale',
  'paid',
  'settled',
  'usd',
  'zig',
  'zar',
  'ecocash',
  'card',
  'credit',
  'bank',
  'inv',
  'inv-',
  'rec',
  'rec-',
  'pos',
  'pos-',
  'sale',
  'sales',
  'receipt',
  'invoice',
  'today',
  '2024',
  '2025',
  '2026',
  '2027',
  '2028',
]);

const GENERIC_WALKIN_NAMES = new Set([
  '',
  'walk-in',
  'walk in',
  'walkin',
  'walk-in customer',
  'walk in customer',
  'walk-in (unregistered)',
  'walk-in customer (unregistered)',
  'cash customer',
  'cash',
  'guest',
  'anonymous',
]);

const getSaleSortTimestamp = (sale: SaleInvoice): number => {
  const ts = sale.timestamp ? new Date(sale.timestamp).getTime() : NaN;
  if (Number.isFinite(ts) && ts > 0) return ts;
  const d = sale.date ? new Date(sale.date).getTime() : NaN;
  if (Number.isFinite(d) && d > 0) return d;
  return 0;
};

export const isCashierOwnInvoice = (
  sale: SaleInvoice,
  currentUser?: Salesperson | null
): boolean => {
  if (!currentUser) return false;
  const userId = String(currentUser.id || '').trim().toLowerCase();
  const userName = String(currentUser.name || '').trim().toLowerCase();
  const saleStaffId = String(sale.staffId || '').trim().toLowerCase();
  const saleStaffName = String(sale.staffName || '').trim().toLowerCase();

  if (userId && saleStaffId && saleStaffId === userId) return true;
  if (userName && saleStaffName && saleStaffName === userName) return true;
  return false;
};

const isNamedCustomer = (name?: string): boolean => {
  const norm = String(name || '').trim().toLowerCase();
  return norm.length > 0 && !GENERIC_WALKIN_NAMES.has(norm);
};

/**
 * Blind-Till Cashier Invoice Visibility Filter.
 *
 * Prevents till operators from summing their full shift receipts to self-balance
 * their cash drawer:
 *  - Default view (empty search): shows ONLY the cashier's last 5 invoices.
 *  - Older invoice lookup (search active):
 *      * Blocks 1–2 char or generic catch-all queries ("walk-in", "cash", "2026",
 *        or the cashier's own name) that could dump a shift's cash sales.
 *      * Exact receipt #, receipt suffix, or payment reference match returns ONLY
 *        the referenced invoice(s) (never mixed with the recent 5).
 *      * Specific named-customer or phone lookup returns only matching named
 *        customer receipts (capped safely to prevent ledger dumping).
 */
export const filterCashierVisibleInvoices = (
  allBranchSales: SaleInvoice[],
  currentUser: Salesperson | null | undefined,
  rawQuery: string
): CashierInvoiceFilterResult => {
  const sortedSales = [...allBranchSales]
    .filter((s) => !(s as any).isDeleted)
    .sort((a, b) => getSaleSortTimestamp(b) - getSaleSortTimestamp(a));

  const trimmed = (rawQuery || '').trim();
  if (!trimmed) {
    const ownInvoices = sortedSales.filter((s) => isCashierOwnInvoice(s, currentUser));
    return {
      mode: 'recent_5',
      invoices: ownInvoices.slice(0, MAX_RECENT_CASHIER_INVOICES),
    };
  }

  const normalized = trimmed.replace(/^#/, '').trim().toLowerCase();
  if (normalized.length < MIN_SEARCH_QUERY_LEN) {
    return {
      mode: 'query_too_short',
      invoices: [],
      hint: 'Enter at least 3 characters (receipt #, customer name, phone, or payment ref) to find an older invoice.',
    };
  }

  const cashierNameNorm = String(currentUser?.name || '').trim().toLowerCase();
  const cashierFirstName = cashierNameNorm.split(/\s+/)[0] || '';
  const isCashierOwnNameQuery =
    (cashierNameNorm.length >= 3 && normalized === cashierNameNorm) ||
    (cashierFirstName.length >= 3 && normalized === cashierFirstName);

  if (GENERIC_BLOCKED_QUERIES.has(normalized) || isCashierOwnNameQuery) {
    return {
      mode: 'query_too_broad',
      invoices: [],
      hint: 'Search is too broad. Enter a specific receipt number, registered customer name, phone number, or payment reference.',
    };
  }

  // 1. Exact receipt ID or payment/POP reference match -> ONLY that referenced invoice
  const exactIdMatches = sortedSales.filter((s) => {
    const idNorm = String(s.id || '').trim().toLowerCase();
    const popNorm = String(s.proofOfPaymentRef || '').trim().toLowerCase();
    const payRefNorm = String(s.paymentReference || '').trim().toLowerCase();
    return (
      idNorm === normalized ||
      (popNorm.length > 0 && popNorm === normalized) ||
      (payRefNorm.length > 0 && payRefNorm === normalized)
    );
  });

  if (exactIdMatches.length > 0) {
    return {
      mode: 'exact_match',
      invoices: exactIdMatches,
    };
  }

  // 2. Receipt number suffix or substring match (e.g., typing "0042" for "INV-HQ-0042")
  const idMatches = sortedSales.filter((s) => {
    const idNorm = String(s.id || '').trim().toLowerCase();
    const popNorm = String(s.proofOfPaymentRef || '').trim().toLowerCase();
    const payRefNorm = String(s.paymentReference || '').trim().toLowerCase();
    return (
      idNorm.endsWith(normalized) ||
      idNorm.includes(normalized) ||
      (popNorm.length > 0 && popNorm.includes(normalized)) ||
      (payRefNorm.length > 0 && payRefNorm.includes(normalized))
    );
  });

  if (idMatches.length === 1) {
    return {
      mode: 'exact_match',
      invoices: idMatches,
    };
  }
  if (idMatches.length > 1) {
    // Prefer exact suffix matches if narrower
    const suffixOnly = idMatches.filter((s) =>
      String(s.id || '').trim().toLowerCase().endsWith(normalized)
    );
    const narrowed = suffixOnly.length > 0 ? suffixOnly : idMatches;
    return {
      mode: narrowed.length === 1 ? 'exact_match' : 'targeted_search',
      invoices: narrowed.slice(0, MAX_TARGETED_SEARCH_RESULTS),
      hint:
        narrowed.length > MAX_TARGETED_SEARCH_RESULTS
          ? 'Multiple receipts matched — enter the full receipt number to narrow down.'
          : undefined,
    };
  }

  // 3. Registered customer name or phone match (never dumps Walk-in Customer sales)
  const customerMatches = sortedSales.filter((s) => {
    const custName = String(s.customerName || '').trim();
    const custPhone = String((s as any).customerPhone || '').trim().toLowerCase();
    const matchesNamedCustomer =
      isNamedCustomer(custName) && custName.toLowerCase().includes(normalized);
    const matchesPhone = custPhone.length > 0 && custPhone.includes(normalized);
    return matchesNamedCustomer || matchesPhone;
  });

  if (customerMatches.length > 0) {
    return {
      mode: customerMatches.length === 1 ? 'exact_match' : 'targeted_search',
      invoices: customerMatches.slice(0, MAX_TARGETED_SEARCH_RESULTS),
      hint:
        customerMatches.length > MAX_TARGETED_SEARCH_RESULTS
          ? `Showing the ${MAX_TARGETED_SEARCH_RESULTS} most recent invoices for this customer — enter the exact receipt # for an older one.`
          : undefined,
    };
  }

  return {
    mode: 'no_match',
    invoices: [],
    hint: `No invoice found matching "${trimmed}". Try the exact receipt number, registered customer name, or payment reference.`,
  };
};
