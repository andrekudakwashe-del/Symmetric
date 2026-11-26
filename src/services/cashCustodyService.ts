import {
  CashAccount,
  CashAccountType,
  CashTransfer,
  CashTransferType,
  CashTransferStatus,
  Salesperson,
  GoodsReceivedEntry,
  CashGovernanceConfig,
  DirectGrv,
} from '../types';
import {
  getCashAccounts,
  getAllCashAccounts,
  getRawStoredCashAccounts,
  setAllCashAccounts,
  saveCashAccount,
  getCashTransfers,
  getAllCashTransfers,
  saveCashTransfer,
  addCashLog,
  addAuditLog,
  getCurrentCompanyId,
  getCurrentBranchId,
  getBranches,
  getAllSalespeople,
  getRawStoredSuppliers,
  isCompanyInTenantScope,
  getCurrencyRate,
  getAllDirectGrvs,
  saveDirectGrv,
  getAllSupplierInvoiceVouchers,
  saveSupplierInvoiceVoucher,
  getStored,
  setStored,
  getCashGovernanceConfig,
  addExpense,
  verifySalespersonPin,
  enqueueSync,
  notifyDirectGrvChanged,
  notifyListeners,
  reconcileCashAccountsFromTransfers,
  isRecordInBranchScope,
  STORAGE_KEYS,
} from '../db/roomDatabase';
import {
  getAllGoodsReceivedNotes,
  getRawStoredGoodsReceivedNotes,
  saveAllGoodsReceivedNotes,
} from '../db/goodsReceivedNotes';
import { adjustWalletBalance } from './walletService';
import { addMovement, getMovements, getShiftId } from '../db/cashLedger';
import { toDateStringSafe } from '../utils/dateUtils';

// Standard default threshold for Owner PIN approval on supplier payments
export const DEFAULT_SUPPLIER_APPROVAL_THRESHOLD = 50.0;

// Hard safety cap ($10,000,000) to prevent math overflow or malformed numeric entries
export const MAX_CUSTODY_TRANSACTION_AMOUNT = 10_000_000;

export const parseSafeCurrencyAmount = (val: unknown): number => {
  if (val === null || val === undefined || val === '') return 0;
  const parsed = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

export const validateCustodyTransactionAmount = (val: unknown, label = 'Transaction amount'): number => {
  const num = parseSafeCurrencyAmount(val);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be greater than $0.00.`);
  }
  if (num > MAX_CUSTODY_TRANSACTION_AMOUNT) {
    throw new Error(
      `${label} ($${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) exceeds the maximum allowed limit of $10,000,000.00.`
    );
  }
  return num;
};

export const isSettledTransferStatus = (status?: string): boolean => {
  const u = String(status || '').toUpperCase().trim();
  return u === 'COMPLETED' || u === 'RECEIVED' || u === 'APPROVED';
};

export const isCompanyLevelTransfer = (type?: CashTransferType | string, branchId?: string): boolean => {
  const t = String(type || '').toUpperCase().trim();
  const b = String(branchId || '').toUpperCase().trim();
  return (
    b === 'HQ' ||
    b === 'ALL' ||
    t === 'HQ_TO_BRANCH' ||
    t === 'BRANCH_TO_HQ' ||
    t === 'BANK_DEPOSIT' ||
    t === 'BANK_WITHDRAWAL' ||
    t === 'ELECTRONIC_SETTLEMENT' ||
    t === 'CAPITAL_INFUSION' ||
    t === 'SUPPLIER_PAYMENT' ||
    t === 'THIRD_PARTY_PAYOUT'
  );
};

export interface GrvLineItemDetail {
  productName: string;
  qty: number;
  unit?: string;
  unitCost: number;
  lineTotal: number;
}

export interface UnpaidGrvRecord {
  id: string;
  grvNumber: string;
  supplierId?: string;
  supplierName: string;
  invoiceNo?: string;
  date: string;
  totalCost: number;
  originalTotalCost?: number;
  tillPaidAmount?: number;
  custodyPaidAmount?: number;
  paymentMethod?: string;
  paymentStatus: 'AWAITING_SAFE_PAYMENT' | 'PAID' | 'UNPAID';
  allocatedSafeId?: string;
  allocatedSafeName?: string;
  receivedByStaffName?: string;
  itemsCount: number;
  items: GrvLineItemDetail[];
  branchId: string;
  branchName: string;
  sourceType?: 'SUPPLIER_VOUCHER' | 'DIRECT_GRV' | 'GRN' | 'LEGACY_GRN';
}

const isCashBranchMatch = (b1?: string, b2?: string): boolean => {
  if (!b1 || !b2) return true;
  if (b1 === b2) return true;
  if ((b1 === '1' || b1 === 'BR-MAIN') && (b2 === '1' || b2 === 'BR-MAIN')) return true;
  try {
    return isRecordInBranchScope(b1, b2, getBranches(), getCurrentCompanyId());
  } catch (_) {
    return false;
  }
};

/**
 * Matches a CashTransfer account reference (from_account_id / to_account_id) to a company-scoped CashAccount,
 * supporting both company-prefixed IDs (ACC-CLERK-COMP12-BR-MAIN) and legacy branch IDs (ACC-CLERK-BR-MAIN).
 */
const isTransferRefMatchingAccount = (
  refId: string | undefined,
  account: CashAccount,
  transferBranchId?: string
): boolean => {
  if (!refId) return false;
  if (refId === account.account_id) return true;

  if (account.account_type === 'CLERK_FLOAT') {
    if (!refId.includes('CLERK') && !refId.includes('FLOAT')) return false;
    return isCashBranchMatch(account.branch_id, transferBranchId || refId.replace(/^ACC-CLERK-/, ''));
  }
  if (account.account_type === 'SAFE') {
    if (!refId.includes('SAFE') || refId.includes('HQ')) return false;
    return isCashBranchMatch(account.branch_id, transferBranchId || refId.replace(/^ACC-BR-SAFE-/, ''));
  }
  if (account.account_type === 'HQ_SAFE') {
    return refId.includes('HQ-SAFE') || refId.includes('ACC-HQ-SAFE');
  }
  return false;
};

/**
 * Initializes default cash accounts for a company / branch if none exist yet.
 * - Commercial Bank initial setup consists of EcoCash Merchant Account & ZiG Bank/Swipe Account (starting at $0.00 / 0 native)
 * - Additional commercial banks (CBZ, Stanbic, CABS, etc.) can be added on demand via createCommercialBankAccount()
 * - Distinct BANK_ACCOUNT records are strictly keyed by account_id and never collapsed into one record.
 */
export const ensureDefaultCashAccounts = (companyId?: string, branchId?: string): CashAccount[] => {
  const currentCompany = companyId || getCurrentCompanyId();
  const currentBranch = branchId || getCurrentBranchId();
  const compPrefix = currentCompany.slice(0, 6);
  const rawAll = getRawStoredCashAccounts();
  const allTransfers = getAllCashTransfers('ALL');

  // Preserve accounts belonging to other companies untouched
  const otherCompanyAccounts = rawAll.filter((acc) => !isCompanyInTenantScope(acc.company_id, currentCompany));
  const companyAccounts = rawAll.filter((acc) => isCompanyInTenantScope(acc.company_id, currentCompany));

  // Detect if a legacy untouched demo bank account (CBZ $12,500 or Stanbic $8,400) has zero transfer history
  const hasTransfersForAccount = (acc: CashAccount): boolean => {
    const id = acc.account_id;
    const nameLower = (acc.account_name || '').toLowerCase();
    return allTransfers.some(
      (t) =>
        t.from_account_id === id ||
        t.to_account_id === id ||
        (t.bank_name && nameLower && nameLower.includes(t.bank_name.toLowerCase().slice(0, 4)))
    );
  };

  // Deduplicate accounts:
  // - BANK_ACCOUNT: strictly keyed by account_id so EcoCash, ZiG, and custom banks never collide!
  // - HQ_SAFE: one per company
  // - SAFE / CLERK_FLOAT / TILL: one per normalized branch
  const grouped = new Map<string, CashAccount[]>();
  let prunedFakeSeed = false;

  for (const acc of companyAccounts) {
    // Automatically clean up legacy untouched fake seed CBZ ($12,500) / Stanbic ($8,400) accounts
    const isLegacyFakeCbz =
      acc.account_type === 'BANK_ACCOUNT' &&
      acc.account_id.startsWith('ACC-BANK-CBZ-') &&
      Math.abs((Number(acc.current_balance) || 0) - 12500) < 0.01 &&
      !hasTransfersForAccount(acc);
    const isLegacyFakeStanbic =
      acc.account_type === 'BANK_ACCOUNT' &&
      acc.account_id.startsWith('ACC-BANK-STANBIC-') &&
      Math.abs((Number(acc.current_balance) || 0) - 8400) < 0.01 &&
      !hasTransfersForAccount(acc);

    if (isLegacyFakeCbz || isLegacyFakeStanbic) {
      prunedFakeSeed = true;
      continue;
    }

    const normBranch =
      acc.branch_id === '1' || acc.branch_id === 'BR-MAIN' || !acc.branch_id
        ? 'BR-MAIN'
        : acc.branch_id;
    const key =
      acc.account_type === 'BANK_ACCOUNT'
        ? `BANK_${acc.account_id}`
        : acc.account_type === 'HQ_SAFE'
        ? 'HQ_SAFE_GLOBAL'
        : `${acc.account_type}_${normBranch}`;

    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(acc);
  }

  const canonicalCompanyAccounts: CashAccount[] = [];
  for (const [, group] of grouped.entries()) {
    if (group.length === 1) {
      const a = { ...group[0] };
      const safeBal = parseSafeCurrencyAmount(a.current_balance);
      if (safeBal !== a.current_balance && safeBal <= MAX_CUSTODY_TRANSACTION_AMOUNT) {
        a.current_balance = safeBal;
      }
      canonicalCompanyAccounts.push(a);
    } else {
      const sorted = [...group].sort((a, b) => {
        const timeA = new Date(a.updated_at || 0).getTime();
        const timeB = new Date(b.updated_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0);
      });
      canonicalCompanyAccounts.push({ ...sorted[0] });
    }
  }

  const nowIso = new Date().toISOString();
  const defaults: Omit<CashAccount, 'created_at' | 'updated_at'>[] = [
    {
      account_id: `ACC-HQ-SAFE-${compPrefix}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      target_branch_id: 'ALL',
      account_type: 'HQ_SAFE',
      account_name: 'HQ Central Vault Safe',
      current_balance: 0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-BR-SAFE-${compPrefix}-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'SAFE',
      account_name: 'Branch Safe',
      current_balance: 0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-CLERK-${compPrefix}-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'CLERK_FLOAT',
      account_name: 'Accounts Clerk Petty Float',
      current_balance: 0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-TILL-1-${compPrefix}-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'TILL',
      account_name: 'Till 1 Register',
      current_balance: 0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-BANK-ECOCASH-${compPrefix}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      target_branch_id: 'ALL',
      account_type: 'BANK_ACCOUNT',
      account_subtype: 'ECOCASH',
      account_name: 'EcoCash Merchant Account',
      current_balance: 0,
      currency: 'USD',
      native_currency: 'EcoCash',
      native_balance: 0,
      status: 'OPEN',
    },
    {
      account_id: `ACC-BANK-ZIG-${compPrefix}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      target_branch_id: 'ALL',
      account_type: 'BANK_ACCOUNT',
      account_subtype: 'ZIG',
      account_name: 'ZiG Bank / Swipe Account',
      current_balance: 0,
      currency: 'USD',
      native_currency: 'ZiG',
      native_balance: 0,
      status: 'OPEN',
    },
  ];

  let hasChanges = prunedFakeSeed || canonicalCompanyAccounts.length !== companyAccounts.length;

  defaults.forEach((def) => {
    const found = canonicalCompanyAccounts.find((a) => {
      if (a.account_id === def.account_id) return true;
      if (def.account_type === 'BANK_ACCOUNT') {
        if (def.account_subtype && a.account_subtype === def.account_subtype) return true;
        if (def.account_subtype === 'ECOCASH' && a.account_name.toLowerCase().includes('ecocash')) return true;
        if (def.account_subtype === 'ZIG' && a.account_name.toLowerCase().includes('zig')) return true;
        return false;
      }
      if (def.account_type === 'HQ_SAFE') {
        return a.account_type === 'HQ_SAFE';
      }
      return a.account_type === def.account_type && isCashBranchMatch(a.branch_id, def.branch_id);
    });

    if (!found) {
      canonicalCompanyAccounts.push({
        ...def,
        created_at: nowIso,
        updated_at: nowIso,
      });
      hasChanges = true;
    } else if (def.account_type === 'BANK_ACCOUNT' && def.account_subtype && !found.account_subtype) {
      found.account_subtype = def.account_subtype;
      found.native_currency = found.native_currency || def.native_currency;
      if (found.native_balance === undefined) found.native_balance = 0;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    setAllCashAccounts([...otherCompanyAccounts, ...canonicalCompanyAccounts]);
  }

  // Deterministic Ledger Reconciliation: ensure SAFE, CLERK_FLOAT, HQ_SAFE, and BANK_ACCOUNT
  // balances always match the authoritative CashTransfer ledger across all devices.
  reconcileCashAccountsFromTransfers({ companyId: currentCompany, silent: true });

  return getCashAccounts(currentBranch);
};

export const getEcocashAccount = (companyId?: string): CashAccount => {
  const currentCompany = companyId || getCurrentCompanyId();
  const compPrefix = currentCompany.slice(0, 6);
  const accounts = getCashAccounts();
  const found = accounts.find(
    (a) =>
      a.account_type === 'BANK_ACCOUNT' &&
      (a.account_subtype === 'ECOCASH' ||
        a.account_id.includes('ECOCASH') ||
        a.account_name.toLowerCase().includes('ecocash'))
  );
  if (found) return found;

  const nowIso = new Date().toISOString();
  return saveCashAccount({
    account_id: `ACC-BANK-ECOCASH-${compPrefix}`,
    company_id: currentCompany,
    branch_id: 'HQ',
    target_branch_id: 'ALL',
    account_type: 'BANK_ACCOUNT',
    account_subtype: 'ECOCASH',
    account_name: 'EcoCash Merchant Account',
    current_balance: 0,
    currency: 'USD',
    native_currency: 'EcoCash',
    native_balance: 0,
    status: 'OPEN',
    created_at: nowIso,
    updated_at: nowIso,
  });
};

export const getZigAccount = (companyId?: string): CashAccount => {
  const currentCompany = companyId || getCurrentCompanyId();
  const compPrefix = currentCompany.slice(0, 6);
  const accounts = getCashAccounts();
  const found = accounts.find(
    (a) =>
      a.account_type === 'BANK_ACCOUNT' &&
      (a.account_subtype === 'ZIG' ||
        a.account_id.includes('ZIG') ||
        a.account_name.toLowerCase().includes('zig'))
  );
  if (found) return found;

  const nowIso = new Date().toISOString();
  return saveCashAccount({
    account_id: `ACC-BANK-ZIG-${compPrefix}`,
    company_id: currentCompany,
    branch_id: 'HQ',
    target_branch_id: 'ALL',
    account_type: 'BANK_ACCOUNT',
    account_subtype: 'ZIG',
    account_name: 'ZiG Bank / Swipe Account',
    current_balance: 0,
    currency: 'USD',
    native_currency: 'ZiG',
    native_balance: 0,
    status: 'OPEN',
    created_at: nowIso,
    updated_at: nowIso,
  });
};

export const createCommercialBankAccount = (params: {
  accountName: string;
  bankAccountNumber?: string;
  currency?: string;
  nativeCurrency?: string;
  initialBalance?: number;
  initialNativeBalance?: number;
  subtype?: 'ECOCASH' | 'ZIG' | 'COMMERCIAL_BANK';
}): CashAccount => {
  const currentCompany = getCurrentCompanyId();
  const compPrefix = currentCompany.slice(0, 6);
  const slug = params.accountName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 14) || 'CUSTOM';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const newAcc: CashAccount = {
    account_id: `ACC-BANK-${slug}-${compPrefix}-${nowMs.toString().slice(-4)}`,
    company_id: currentCompany,
    branch_id: 'HQ',
    target_branch_id: 'ALL',
    account_type: 'BANK_ACCOUNT',
    account_subtype: params.subtype || 'COMMERCIAL_BANK',
    bank_account_number: params.bankAccountNumber?.trim() || undefined,
    account_name: params.accountName.trim(),
    current_balance: parseSafeCurrencyAmount(params.initialBalance || 0),
    currency: params.currency || 'USD',
    native_currency: params.nativeCurrency?.trim() || undefined,
    native_balance: params.nativeCurrency ? parseSafeCurrencyAmount(params.initialNativeBalance || 0) : undefined,
    status: 'OPEN',
    created_at: nowIso,
    updated_at: nowIso,
    updatedAt: nowMs,
    lastUpdated: nowIso,
  };

  return saveCashAccount(newAcc);
};

export interface RecordElectronicSettlementCustodyParams {
  date: string;
  branchId: string;
  branchName?: string;
  ecocashUsd: number;
  ecocashNative?: number;
  ecocashRate?: number;
  ecocashBatchRef?: string;
  zigUsd: number;
  zigNative?: number;
  zigRate?: number;
  zigBatchRef?: string;
  verifiedBy: Salesperson;
  notes?: string;
}

/**
 * Idempotently feeds confirmed Form 4 EcoCash and ZiG settlements directly into Dual Custody
 * (EcoCash Merchant Account & ZiG Bank/Swipe Account) tracking BOTH Base USD and Native Mobile Money.
 * Re-confirming the same date + branch adjusts ONLY the delta so accounts are never double-credited.
 */
export const recordElectronicSettlementToCustody = (
  params: RecordElectronicSettlementCustodyParams
): { ecocashVoucher?: CashTransfer; zigVoucher?: CashTransfer } => {
  const currentCompany = getCurrentCompanyId();
  const branchId = params.branchId || getCurrentBranchId();
  const branchObj = getBranches().find((b) => b.id === branchId || b.branchCode === branchId);
  const branchName = params.branchName || branchObj?.name || branchId;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existingTransfers = getAllCashTransfers('ALL');

  const upsertSettlementChannel = (opts: {
    channel: 'ECOCASH' | 'ZIG';
    account: CashAccount;
    usdAmount: number;
    nativeAmount: number;
    rate: number;
    batchRef?: string;
  }): CashTransfer | undefined => {
    const safeUsd = parseSafeCurrencyAmount(opts.usdAmount);
    const safeNative = parseSafeCurrencyAmount(opts.nativeAmount);
    const transferId = `TRF-${opts.channel === 'ECOCASH' ? 'ECO' : 'ZIG'}-${params.date}-${branchId}`;
    const existing = existingTransfers.find((t) => t.transfer_id === transferId);

    if (safeUsd <= 0 && safeNative <= 0 && !existing) {
      return undefined;
    }

    const prevUsd = existing ? parseSafeCurrencyAmount(existing.amount) : 0;
    const prevNative = existing ? parseSafeCurrencyAmount(existing.native_amount ?? prevUsd) : 0;
    const deltaUsd = Math.round((safeUsd - prevUsd) * 100) / 100;
    const deltaNative = Math.round((safeNative - prevNative) * 100) / 100;

    // Update account balance by exact delta (both base USD and native mobile money)
    if (Math.abs(deltaUsd) > 0.001 || Math.abs(deltaNative) > 0.001) {
      const nextUsdBal = Math.max(0, Math.round((parseSafeCurrencyAmount(opts.account.current_balance) + deltaUsd) * 100) / 100);
      const nextNativeBal = Math.max(
        0,
        Math.round((parseSafeCurrencyAmount(opts.account.native_balance || 0) + deltaNative) * 100) / 100
      );
      saveCashAccount({
        ...opts.account,
        account_subtype: opts.channel,
        native_currency: opts.channel === 'ECOCASH' ? 'EcoCash' : 'ZiG',
        current_balance: nextUsdBal,
        native_balance: nextNativeBal,
        updated_at: nowIso,
        updatedAt: nowMs,
        lastUpdated: nowIso,
      });
    }

    const label = opts.channel === 'ECOCASH' ? 'EcoCash' : 'ZiG';
    const nativeFormatted = safeNative.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const voucher: CashTransfer = {
      transfer_id: transferId,
      company_id: currentCompany,
      branch_id: branchId,
      branch_name: branchName,
      target_branch_id: 'ALL',
      type: 'ELECTRONIC_SETTLEMENT',
      from_account_id: `POS-ELECTRONIC-${branchId}`,
      to_account_id: opts.account.account_id,
      amount: safeUsd,
      currency: 'USD',
      native_currency: label,
      native_amount: safeNative,
      exchange_rate: opts.rate,
      batch_ref: opts.batchRef?.trim() || undefined,
      bank_name: opts.account.account_name,
      status: 'COMPLETED',
      created_by_user_id: params.verifiedBy.id,
      created_by_user_name: params.verifiedBy.name,
      created_at: existing?.created_at || nowIso,
      approved_by_user_id: params.verifiedBy.id,
      approved_by_user_name: params.verifiedBy.name,
      approved_at: nowIso,
      received_by_user_id: params.verifiedBy.id,
      received_by_user_name: params.verifiedBy.name,
      received_at: nowIso,
      recipient_name: `${branchName} · Form 4 EOD`,
      receipt_image_url: opts.batchRef?.trim() || undefined,
      notes: `Form 4 Confirmed ${label} Settlement (${params.date}, ${branchName}): $${safeUsd.toFixed(2)} USD (${label} ${nativeFormatted} @ ${opts.rate}x)${opts.batchRef?.trim() ? ` · Batch Ref: ${opts.batchRef.trim()}` : ''}${params.notes ? ` · ${params.notes}` : ''}`,
      is_owner_override: false,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };

    const saved = saveCashTransfer(voucher);

    addAuditLog({
      action: 'CASH_TRANSFER_APPROVE',
      severity: 'INFO',
      staffId: params.verifiedBy.id,
      staffName: params.verifiedBy.name,
      staffRole: params.verifiedBy.role,
      details: `Form 4 ${label} settlement confirmed into ${opts.account.account_name}: $${safeUsd.toFixed(2)} USD (${label} ${nativeFormatted})${opts.batchRef ? ` [Batch: ${opts.batchRef}]` : ''}`,
      referenceId: transferId,
      amount: safeUsd,
    });

    return saved;
  };

  const ecoRate = params.ecocashRate && params.ecocashRate > 0 ? params.ecocashRate : getCurrencyRate('EcoCash');
  const zigRate = params.zigRate && params.zigRate > 0 ? params.zigRate : getCurrencyRate('ZiG');

  const ecoNative =
    params.ecocashNative !== undefined && Number.isFinite(params.ecocashNative)
      ? params.ecocashNative
      : Math.round(parseSafeCurrencyAmount(params.ecocashUsd) * ecoRate * 100) / 100;
  const zigNative =
    params.zigNative !== undefined && Number.isFinite(params.zigNative)
      ? params.zigNative
      : Math.round(parseSafeCurrencyAmount(params.zigUsd) * zigRate * 100) / 100;

  const ecocashVoucher = upsertSettlementChannel({
    channel: 'ECOCASH',
    account: getEcocashAccount(currentCompany),
    usdAmount: params.ecocashUsd,
    nativeAmount: ecoNative,
    rate: ecoRate,
    batchRef: params.ecocashBatchRef,
  });

  const zigVoucher = upsertSettlementChannel({
    channel: 'ZIG',
    account: getZigAccount(currentCompany),
    usdAmount: params.zigUsd,
    nativeAmount: zigNative,
    rate: zigRate,
    batchRef: params.zigBatchRef,
  });

  return { ecocashVoucher, zigVoucher };
};

/**
 * Account Lookups with robust alias fallback
 */
export const getHqSafeAccount = (companyId?: string): CashAccount => {
  const currentCompany = companyId || getCurrentCompanyId();
  const accounts = getCashAccounts();
  const hq = accounts.find((a) => a.account_type === 'HQ_SAFE');
  if (hq) return hq;

  // Auto-provision if missing
  const nowIso = new Date().toISOString();
  const newHq: CashAccount = {
    account_id: `ACC-HQ-SAFE-${currentCompany.slice(0, 6)}`,
    company_id: currentCompany,
    branch_id: 'HQ',
    target_branch_id: 'ALL',
    account_type: 'HQ_SAFE',
    account_name: 'HQ Central Vault Safe',
    current_balance: 0,
    currency: 'USD',
    status: 'OPEN',
    created_at: nowIso,
    updated_at: nowIso,
  };
  return saveCashAccount(newHq);
};

export const getBranchSafeAccount = (branchId?: string): CashAccount => {
  const targetBranch = branchId || getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const compPrefix = currentCompany.slice(0, 6);
  const accounts = getCashAccounts();
  const safe = accounts.find((a) => a.account_type === 'SAFE' && isCashBranchMatch(a.branch_id, targetBranch));
  if (safe) return safe;

  const newSafe: CashAccount = {
    account_id: `ACC-BR-SAFE-${compPrefix}-${targetBranch}`,
    company_id: currentCompany,
    branch_id: targetBranch,
    account_type: 'SAFE',
    account_name: 'Branch Safe',
    current_balance: 0,
    currency: 'USD',
    status: 'OPEN',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return saveCashAccount(newSafe);
};

export const getClerkFloatAccount = (branchId?: string): CashAccount => {
  const targetBranch = branchId || getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const compPrefix = currentCompany.slice(0, 6);
  const accounts = getCashAccounts();
  const clerk = accounts.find((a) => a.account_type === 'CLERK_FLOAT' && isCashBranchMatch(a.branch_id, targetBranch));
  if (clerk) return clerk;

  const newClerk: CashAccount = {
    account_id: `ACC-CLERK-${compPrefix}-${targetBranch}`,
    company_id: currentCompany,
    branch_id: targetBranch,
    account_type: 'CLERK_FLOAT',
    account_name: 'Accounts Clerk Petty Float',
    current_balance: 0,
    currency: 'USD',
    status: 'OPEN',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return saveCashAccount(newClerk);
};

export const getInTransitTotal = (branchId?: string): number => {
  const transfers = getCashTransfers(branchId);
  return transfers
    .filter((t) => t.status === 'IN_TRANSIT')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
};


export interface CreateTransferPayload {
  type: CashTransferType;
  from_account_id: string;
  to_account_id?: string;
  amount: number;
  initiator: Salesperson;
  linked_grv_id?: string;
  linked_grv_items?: GrvLineItemDetail[];
  recipient_name?: string;
  receipt_image_url?: string;
  bag_seal_number?: string;
  notes?: string;
  witness_user_id?: string;
  is_owner_break_glass?: boolean;
  bank_name?: string;
  bank_account_number?: string;
  native_currency?: string;
  native_amount?: number;
  exchange_rate?: number;
  batch_ref?: string;
  auto_accept?: boolean;
  skip_drawer_movement?: boolean;
}

function findAccountWithFallback(accounts: CashAccount[], accountId?: string, branchId?: string): CashAccount | undefined {
  if (!accountId) return undefined;
  let acc = accounts.find((a) => a.account_id === accountId);
  if (acc) return acc;
  const targetBranch = branchId || getCurrentBranchId();
  if (accountId.includes('SAFE') && !accountId.includes('HQ')) {
    return accounts.find((a) => a.account_type === 'SAFE' && isCashBranchMatch(a.branch_id, targetBranch)) || getBranchSafeAccount(targetBranch);
  }
  if (accountId.includes('CLERK')) {
    return accounts.find((a) => a.account_type === 'CLERK_FLOAT' && isCashBranchMatch(a.branch_id, targetBranch)) || getClerkFloatAccount(targetBranch);
  }
  if (accountId.includes('HQ')) {
    return accounts.find((a) => a.account_type === 'HQ_SAFE') || getHqSafeAccount();
  }
  if (accountId.includes('BANK')) {
    return accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
  }
  return undefined;
}

/**
 * Deducts the source account immediately when cash is dispatched into transit
 */
function deductSourceAccountForTransit(transfer: CashTransfer, actor?: Salesperson) {
  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const accounts = getCashAccounts();
  const fromAcc = findAccountWithFallback(accounts, transfer.from_account_id, transfer.branch_id);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  if (fromAcc) {
    const updatedFrom: CashAccount = {
      ...fromAcc,
      current_balance: Math.max(0, Math.round((parseSafeCurrencyAmount(fromAcc.current_balance) - safeAmount) * 100) / 100),
      updated_at: nowIso,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };
    saveCashAccount(updatedFrom);
  }

  // Record OUT entry in CashLog for real-time safe/custody balancing.
  // Note: Vault transfers (Branch <-> HQ, Bank deposits/withdrawals, Capital injections, Supplier payments, Third-party payouts) must NOT be assigned to a cashier's till shift.
  const isVaultTransfer =
    transfer.type === 'BRANCH_TO_HQ' ||
    transfer.type === 'HQ_TO_BRANCH' ||
    transfer.type === 'BANK_DEPOSIT' ||
    transfer.type === 'BANK_WITHDRAWAL' ||
    transfer.type === 'CAPITAL_INFUSION' ||
    transfer.type === 'SUPPLIER_PAYMENT' ||
    transfer.type === 'THIRD_PARTY_PAYOUT';

  const logStaffId = isVaultTransfer ? 'VAULT_CUSTODY' : (actor?.id || transfer.created_by_user_id);
  const logStaffName = isVaultTransfer ? 'Vault Custody' : (actor?.name || transfer.created_by_user_name);
  const effectiveLogBranch = (isVaultTransfer || transfer.branch_id === 'HQ' || transfer.target_branch_id === 'ALL')
    ? 'ALL'
    : transfer.branch_id;

  const logOut = addCashLog({
    date: nowIso.split('T')[0],
    time: nowIso.slice(11, 19),
    staff_id: logStaffId,
    staffId: logStaffId,
    staff_name: logStaffName,
    staffName: logStaffName,
    type: 'Transfer',
    category: isVaultTransfer ? 'Vault Custody Transfer' : 'Transfer',
    isVaultCustody: isVaultTransfer,
    isNonPosTransfer: isVaultTransfer,
    description: `Custody Transfer Dispatched to IN_TRANSIT: [${transfer.type}] from ${fromAcc?.account_name || 'Safe'} (Ref: ${transfer.transfer_id})${transfer.recipient_name ? ` for ${transfer.recipient_name}` : ''}${transfer.bank_name ? ` (${transfer.bank_name})` : ''}`,
    in: 0,
    out: safeAmount,
    currency: 'USD',
    company_id: transfer.company_id,
    branch_id: transfer.branch_id,
    target_branch_id: effectiveLogBranch,
  } as any);

  transfer.linked_cash_log_ids = [...(transfer.linked_cash_log_ids || []), logOut.id];
  transfer.updatedAt = nowMs;
  transfer.lastUpdated = nowIso;
  saveCashTransfer(transfer);
  reconcileCashAccountsFromTransfers({ companyId: transfer.company_id, syncChanged: true, silent: true });
}

/**
 * Creates a new Cash Transfer Voucher
 */
export const createCashTransferVoucher = (payload: CreateTransferPayload): CashTransfer => {
  const safeAmount = validateCustodyTransactionAmount(payload.amount, 'Transfer amount');
  const companyId = getCurrentCompanyId();
  const branchId = getCurrentBranchId();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const dateStr = nowIso.slice(0, 10).replace(/-/g, '');
  const transferId = `TRF-${dateStr}-${nowMs.toString().slice(-4)}`;

  const isOwner =
    payload.initiator.role === 'OWNER' ||
    payload.initiator.role === 'SUPER_ADMIN' ||
    (payload.initiator.role as string) === 'super_admin';

  const govConfig = getCashGovernanceConfig();
  const isLean = govConfig.governanceMode === 'LEAN';

  let status: CashTransferStatus = 'DRAFT';
  let isOwnerOverride = Boolean(payload.is_owner_break_glass);

  // Workflow state machine with lean mode configuration
  if (payload.type === 'FLOAT_ISSUE') {
    // Allow immediate settlement when supervisor explicitly authorizes a direct Form 2 float top-up/auto-float
    status = payload.auto_accept ? 'COMPLETED' : 'PENDING_ACCEPTANCE';
  } else if (payload.type === 'SUPPLIER_PAYMENT') {
    const threshold = govConfig.defaultSupplierApprovalThreshold || DEFAULT_SUPPLIER_APPROVAL_THRESHOLD;
    if (safeAmount > threshold) {
      if (isOwner || isLean) {
        status = 'COMPLETED';
        isOwnerOverride = isOwner;
      } else {
        status = 'PENDING_APPROVAL'; // Requires Owner PIN in strict mode
      }
    } else {
      status = 'COMPLETED'; // Under threshold, clerk can execute directly
    }
  } else if (payload.type === 'BRANCH_TO_HQ') {
    status = isLean ? 'COMPLETED' : 'IN_TRANSIT'; // In lean mode, executes directly to HQ safe; in strict mode sealed in transit
  } else if (payload.type === 'HQ_TO_BRANCH') {
    status = isLean ? 'COMPLETED' : 'IN_TRANSIT'; // Funds from HQ sent down to branch safe
  } else if (payload.type === 'BANK_DEPOSIT') {
    status = isLean ? 'COMPLETED' : 'IN_TRANSIT'; // Sent to bank, verified against deposit slip
  } else if (payload.type === 'BANK_WITHDRAWAL') {
    status = 'COMPLETED'; // Safe cash replenishment from bank
  } else if (payload.type === 'ELECTRONIC_SETTLEMENT') {
    status = 'COMPLETED';
  } else if (payload.type === 'CAPITAL_INFUSION') {
    status = 'COMPLETED'; // Direct branch opening float / capital injection
  } else if (payload.type === 'THIRD_PARTY_PAYOUT') {
    status = 'IN_TRANSIT'; // Out with runner, closed when receipt returned
  } else if (payload.type === 'TILL_COLLECTION') {
    status = 'COMPLETED';
  }

  // Audit logging
  if (isOwner && (isOwnerOverride || status === 'COMPLETED')) {
    isOwnerOverride = true;
    addAuditLog({
      action: 'CASH_TRANSFER_OVERRIDE',
      severity: 'WARNING',
      staffId: payload.initiator.id,
      staffName: payload.initiator.name,
      staffRole: payload.initiator.role,
      details: 'Owner/Manager authorized cash transaction under break-glass/lean policy.',
      referenceId: transferId,
      amount: safeAmount,
      metadata: { transferType: payload.type, amount: safeAmount, governanceMode: govConfig.governanceMode },
    });
  } else {
    addAuditLog({
      action: 'CASH_TRANSFER_CREATE',
      severity: 'INFO',
      staffId: payload.initiator.id,
      staffName: payload.initiator.name,
      staffRole: payload.initiator.role,
      details: `Created Cash Transfer ${transferId} (${payload.type}) for $${safeAmount.toFixed(2)}${payload.bank_name ? ` [${payload.bank_name}]` : ''}`,
      referenceId: transferId,
      amount: safeAmount,
      metadata: { transferType: payload.type, amount: safeAmount, status },
    });
  }

  // Resolve exact bank account ID for BANK_DEPOSIT / BANK_WITHDRAWAL so statements always link cleanly
  const allAccounts = getCashAccounts();
  let resolvedToAccountId = payload.to_account_id;
  if (payload.type === 'BANK_DEPOSIT' && !resolvedToAccountId && payload.bank_name) {
    const matchedBank =
      allAccounts.find((a) => a.account_type === 'BANK_ACCOUNT' && a.account_name === payload.bank_name) ||
      allAccounts.find(
        (a) =>
          a.account_type === 'BANK_ACCOUNT' &&
          a.account_name.toLowerCase().includes(payload.bank_name!.toLowerCase().slice(0, 4))
      );
    if (matchedBank) resolvedToAccountId = matchedBank.account_id;
  }

  const branchObj = getBranches().find((b) => b.id === branchId || b.branchCode === branchId);
  const companyLevel =
    isCompanyLevelTransfer(payload.type, branchId) ||
    Boolean(payload.from_account_id?.includes('HQ')) ||
    Boolean(resolvedToAccountId?.includes('HQ')) ||
    Boolean(payload.from_account_id?.includes('BANK')) ||
    Boolean(resolvedToAccountId?.includes('BANK'));

  const transfer: CashTransfer = {
    transfer_id: transferId,
    company_id: companyId,
    branch_id: branchId,
    branch_name: branchObj?.name || branchId,
    target_branch_id: companyLevel ? 'ALL' : branchId,
    type: payload.type,
    from_account_id: payload.from_account_id,
    to_account_id: resolvedToAccountId,
    amount: safeAmount,
    currency: 'USD',
    native_currency: payload.native_currency,
    native_amount: payload.native_amount,
    exchange_rate: payload.exchange_rate,
    batch_ref: payload.batch_ref,
    status,
    updatedAt: nowMs,
    lastUpdated: nowIso,
    created_by_user_id: payload.initiator.id,
    created_by_user_name: payload.initiator.name,
    created_at: nowIso,
    linked_grv_id: payload.linked_grv_id,
    linked_grv_items: payload.linked_grv_items,
    recipient_name: payload.recipient_name,
    receipt_image_url: payload.receipt_image_url,
    bag_seal_number: payload.bag_seal_number,
    notes: payload.notes,
    bank_name: payload.bank_name,
    bank_account_number: payload.bank_account_number,
    is_owner_override: isOwnerOverride,
    owner_override_reason: isOwnerOverride ? 'Owner Break-Glass / Lean Policy Action' : undefined,
    approved_by_user_id: (isOwner || isLean || payload.auto_accept) ? payload.initiator.id : undefined,
    approved_by_user_name: (isOwner || isLean || payload.auto_accept) ? payload.initiator.name : undefined,
    approved_at: (isOwner || isLean || payload.auto_accept) ? nowIso : undefined,
    received_by_user_id: payload.auto_accept ? payload.initiator.id : undefined,
    received_by_user_name: payload.auto_accept ? (payload.recipient_name || payload.initiator.name) : undefined,
    received_at: payload.auto_accept ? nowIso : undefined,
  };

  const saved = saveCashTransfer(transfer);

  // If dispatched immediately into transit, deduct source account now so safe does not overstate physical cash
  if (status === 'IN_TRANSIT') {
    deductSourceAccountForTransit(saved, payload.initiator);
  } else if (status === 'COMPLETED') {
    finalizeTransferLedger(saved, payload.initiator, false, payload.skip_drawer_movement);
  }

  return saved;
};

/**
 * Return undelivered / aborted transit cash back to Safe (e.g. supplier's office was closed)
 */
export const returnTransitToSafe = (
  transferId: string,
  staff: Salesperson,
  reason: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);
  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }
  if (transfer.status !== 'IN_TRANSIT') {
    return {
      success: false,
      message: `Only IN_TRANSIT transfers can be returned to safe (current status: ${transfer.status}).`,
    };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Refund source account
  const accounts = getCashAccounts();
  const fromAcc = findAccountWithFallback(accounts, transfer.from_account_id, transfer.branch_id);
  if (fromAcc) {
    const refunded: CashAccount = {
      ...fromAcc,
      current_balance: Math.round((parseSafeCurrencyAmount(fromAcc.current_balance) + safeAmount) * 100) / 100,
      updated_at: nowIso,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };
    saveCashAccount(refunded);
  }

  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'RETURNED',
    updatedAt: nowMs,
    lastUpdated: nowIso,
    returned_reason: reason || 'Trip aborted; returned undelivered cash to safe',
    returned_at: nowIso,
    returned_by_user_id: staff.id,
    returned_by_user_name: staff.name,
    notes: `${transfer.notes ? transfer.notes + ' | ' : ''}Returned to safe: ${reason || 'Supplier premises closed'}`,
  };
  saveCashTransfer(updated);
  reconcileCashAccountsFromTransfers({ companyId: updated.company_id, syncChanged: true, silent: true });

  addAuditLog({
    action: 'CASH_TRANSFER_RETURN' as any,
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `Undelivered cash of $${safeAmount.toFixed(2)} returned to ${fromAcc?.account_name || 'Safe'}. Reason: ${reason}`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  const isCompany = isCompanyLevelTransfer(transfer.type, transfer.branch_id);
  addCashLog({
    date: nowIso.split('T')[0],
    time: nowIso.slice(11, 19),
    staff_id: isCompany ? 'VAULT_CUSTODY' : staff.id,
    staffId: isCompany ? 'VAULT_CUSTODY' : staff.id,
    staff_name: isCompany ? 'Vault Custody' : staff.name,
    staffName: isCompany ? 'Vault Custody' : staff.name,
    type: 'Transfer',
    category: isCompany ? 'Vault Custody Transfer' : 'Transfer',
    isVaultCustody: isCompany,
    isNonPosTransfer: isCompany,
    description: `Transit RETURNED into Safe: $${safeAmount.toFixed(2)} (Ref: ${transfer.transfer_id}). Reason: ${reason}`,
    in: safeAmount,
    out: 0,
    currency: 'USD',
    company_id: transfer.company_id,
    branch_id: transfer.branch_id,
    target_branch_id: isCompany ? 'ALL' : transfer.branch_id,
  } as any);

  return {
    success: true,
    message: `Successfully returned $${safeAmount.toFixed(2)} to ${fromAcc?.account_name || 'Safe'}.`,
    transfer: updated,
  };
};

export const STORAGE_KEYS_RETAINED_FLOATS = 'saimetric_cashier_retained_floats';

export interface CashierRetainedFloatRecord {
  cashierId: string;
  cashierName?: string;
  date: string; // YYYY-MM-DD
  amount: number;
  updatedAt: string;
}

export const getAllRetainedFloats = (): CashierRetainedFloatRecord[] => {
  return getStored<CashierRetainedFloatRecord[]>(STORAGE_KEYS_RETAINED_FLOATS, []);
};

export const saveCashierRetainedFloat = (
  cashierId: string,
  date: string,
  amount: number,
  cashierName?: string
): void => {
  const all = getAllRetainedFloats();
  const existingIndex = all.findIndex((r) => r.cashierId === cashierId && r.date === date);
  const entry: CashierRetainedFloatRecord = {
    cashierId,
    cashierName,
    date,
    amount: Math.round(amount * 100) / 100,
    updatedAt: new Date().toISOString(),
  };

  let updated: CashierRetainedFloatRecord[];
  if (existingIndex >= 0) {
    updated = [...all];
    updated[existingIndex] = entry;
  } else {
    updated = [entry, ...all];
  }
  setStored(STORAGE_KEYS_RETAINED_FLOATS, updated);
};

export const getCashierRetainedFloat = (cashierId: string, targetDate?: string): number | null => {
  const all = getAllRetainedFloats();
  if (targetDate) {
    const match = all.find((r) => r.cashierId === cashierId && r.date === targetDate);
    if (match) return match.amount;
  }
  // If not found for specific date, check most recent entry for that cashier
  const cashierEntries = all.filter((r) => r.cashierId === cashierId);
  if (cashierEntries.length > 0) {
    cashierEntries.sort((a, b) => new Date(b.date || b.updatedAt).getTime() - new Date(a.date || a.updatedAt).getTime());
    return cashierEntries[0].amount;
  }
  return null;
};

/**
 * End-of-Day Till to Safe or Accounts Clerk Handover (turns over counted cash from cashier drawer into Branch Safe or Clerk Float)
 */
export const handoverTillToSafe = (params: {
  cashierId: string;
  cashierName: string;
  totalCountedCash: number;
  retainedFloat?: number;
  supervisor: Salesperson;
  notes?: string;
  destinationTarget?: 'SAFE' | 'CLERK';
}): { success: boolean; message: string; voucher?: CashTransfer } => {
  const currentBranch = getCurrentBranchId();
  const govConfig = getCashGovernanceConfig();
  const retained = Number(params.retainedFloat) || 0;
  const netHandover = Math.max(0, Math.round((params.totalCountedCash - retained) * 100) / 100);

  if (netHandover <= 0) {
    return { success: false, message: 'No surplus cash above retained float to handover.' };
  }

  // Persist the cashier's retained float for overnight cashbox carryover
  if (retained > 0) {
    const todayStr = new Date().toISOString().split('T')[0];
    saveCashierRetainedFloat(params.cashierId, todayStr, retained, params.cashierName);
  }

  const destType = params.destinationTarget || govConfig.floatSourceAccountId || 'SAFE';
  const targetAcc = destType === 'CLERK' ? getClerkFloatAccount(currentBranch) : getBranchSafeAccount(currentBranch);
  const tillAccId = `ACC-TILL-1-${currentBranch}`;

  const voucher = createCashTransferVoucher({
    type: 'TILL_COLLECTION',
    from_account_id: tillAccId,
    to_account_id: targetAcc.account_id,
    amount: netHandover,
    initiator: params.supervisor,
    recipient_name: params.cashierName,
    notes: `EOD Cash Handover: Cashier ${params.cashierName} surrendered $${netHandover.toFixed(2)} (Counted: $${params.totalCountedCash.toFixed(2)}, Retained Float: $${retained.toFixed(2)}) to ${targetAcc.account_name}.${params.notes ? ` ${params.notes}` : ''}`,
  });

  return {
    success: true,
    message: `Turned over $${netHandover.toFixed(2)} from Cashier ${params.cashierName} to ${targetAcc.account_name} ($${retained.toFixed(2)} locked in cashier cashbox). Balance updated!`,
    voucher,
  };
};

/**
 * Owner/Manager Approval for Supplier Payments or Transits
 */
export const approveCashTransfer = (
  transferId: string,
  approver: Salesperson,
  enteredPin: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  if (isSettledTransferStatus(transfer.status) || transfer.status === 'RETURNED' || transfer.status === 'CANCELLED') {
    return { success: false, message: `Voucher ${transfer.transfer_id} is already finalized (${transfer.status}).` };
  }

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && !verifySalespersonPin(approver, enteredPin)) {
    return { success: false, message: 'Invalid PIN entered.' };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  let nextStatus: CashTransferStatus = 'COMPLETED';

  if (transfer.type === 'BRANCH_TO_HQ') {
    nextStatus = 'IN_TRANSIT';
  }

  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: nextStatus,
    updatedAt: nowMs,
    lastUpdated: now,
    target_branch_id: isCompanyLevelTransfer(transfer.type, transfer.branch_id) ? 'ALL' : (transfer.target_branch_id || transfer.branch_id),
    approved_by_user_id: approver.id,
    approved_by_user_name: approver.name,
    approved_at: now,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'CASH_TRANSFER_APPROVE',
    severity: 'INFO',
    staffId: approver.id,
    staffName: approver.name,
    staffRole: approver.role,
    details: `Approved Cash Transfer ${transfer.transfer_id} (${transfer.type}) for $${safeAmount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  if (nextStatus === 'COMPLETED') {
    finalizeTransferLedger(updated, approver, false);
  } else if (nextStatus === 'IN_TRANSIT') {
    deductSourceAccountForTransit(updated, approver);
  }

  return { success: true, message: `Transfer ${transfer.transfer_id} approved.`, transfer: updated };
};

/**
 * Cashier PIN Acceptance for Till Float on POS
 */
export const acceptTillFloat = (
  transferId: string,
  cashier: Salesperson,
  enteredPin: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  if (transfer.type !== 'FLOAT_ISSUE') {
    return { success: false, message: 'Only Float Issue transfers require Cashier acceptance.' };
  }

  if (isSettledTransferStatus(transfer.status)) {
    return { success: false, message: `Till Float ${transfer.transfer_id} is already accepted.` };
  }

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && !verifySalespersonPin(cashier, enteredPin)) {
    return { success: false, message: 'Incorrect Cashier PIN. Physical custody rejected.' };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'COMPLETED',
    updatedAt: nowMs,
    lastUpdated: now,
    received_by_user_id: cashier.id,
    received_by_user_name: cashier.name,
    received_at: now,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'TILL_FLOAT_ACCEPT',
    severity: 'INFO',
    staffId: cashier.id,
    staffName: cashier.name,
    staffRole: cashier.role,
    details: `Cashier ${cashier.name} accepted Till Float ${transfer.transfer_id} for $${safeAmount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  finalizeTransferLedger(updated, cashier, false);

  return { success: true, message: `Till Float of $${safeAmount.toFixed(2)} accepted into register.`, transfer: updated };
};

/**
 * Cashier Rejection of Till Float voucher (returned to Safe / Clerk)
 */
export const rejectTillFloat = (
  transferId: string,
  cashier: Salesperson,
  reason?: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'CANCELLED',
    updatedAt: nowMs,
    lastUpdated: new Date(nowMs).toISOString(),
    notes: `${transfer.notes ? `${transfer.notes}. ` : ''}Rejected by Cashier ${cashier.name}${reason ? `: ${reason}` : ''}`,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'TILL_FLOAT_REJECT',
    severity: 'WARNING',
    staffId: cashier.id,
    staffName: cashier.name,
    staffRole: cashier.role,
    details: `Cashier ${cashier.name} rejected Till Float ${transfer.transfer_id} ($${safeAmount.toFixed(2)})`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  return { success: true, message: `Till Float ${transfer.transfer_id} rejected and returned to custody source.`, transfer: updated };
};

/**
 * Issues till float from Safe or Clerk Float into cashier drawer with full custody ledger & transfer voucher
 */
export const issueTillFloat = (params: {
  cashierId: string;
  cashierName: string;
  amount: number;
  supervisor: Salesperson;
  shiftDate: string;
  sourceAccountId?: string;
  notes?: string;
  autoAccept?: boolean;
  skipDrawerMovement?: boolean;
}): { success: boolean; message: string; voucher: CashTransfer } => {
  const safeAmount = validateCustodyTransactionAmount(params.amount, 'Till float amount');
  const govConfig = getCashGovernanceConfig();
  const branchId = getCurrentBranchId();
  const sourceAccId =
    params.sourceAccountId ||
    (govConfig.floatSourceAccountId === 'CLERK'
      ? getClerkFloatAccount(branchId).account_id
      : getBranchSafeAccount(branchId).account_id);
  const tillAccId = `ACC-TILL-1-${branchId}`;

  const voucher = createCashTransferVoucher({
    type: 'FLOAT_ISSUE',
    from_account_id: sourceAccId,
    to_account_id: tillAccId,
    amount: safeAmount,
    initiator: params.supervisor,
    recipient_name: params.cashierName,
    notes:
      params.notes ||
      `Till Float issued to ${params.cashierName} for shift on ${params.shiftDate}`,
    auto_accept: params.autoAccept,
    skip_drawer_movement: params.skipDrawerMovement,
  });

  return {
    success: true,
    message: `Float of $${safeAmount.toFixed(2)} issued to ${params.cashierName}.`,
    voucher,
  };
};

/**
 * Owner receipt of Branch to HQ safe transfer
 */
export const receiveHqSafeTransfer = (
  transferId: string,
  owner: Salesperson,
  enteredPin: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  if (isSettledTransferStatus(transfer.status)) {
    return { success: false, message: `Transfer ${transfer.transfer_id} has already been received (${transfer.status}).` };
  }

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && !verifySalespersonPin(owner, enteredPin)) {
    return { success: false, message: 'Invalid Owner PIN.' };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const wasInTransit = transfer.status === 'IN_TRANSIT';
  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'RECEIVED',
    updatedAt: nowMs,
    lastUpdated: now,
    target_branch_id: 'ALL',
    received_by_user_id: owner.id,
    received_by_user_name: owner.name,
    received_at: now,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'HQ_SAFE_RECEIVE',
    severity: 'INFO',
    staffId: owner.id,
    staffName: owner.name,
    staffRole: owner.role,
    details: `Owner received Branch transfer ${transfer.transfer_id} into HQ Safe for $${safeAmount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  // Source account was already deducted when dispatched to transit
  finalizeTransferLedger(updated, owner, wasInTransit);

  return { success: true, message: `Cash of $${safeAmount.toFixed(2)} deposited into HQ Safe.`, transfer: updated };
};

/**
 * Branch receipt of HQ to Branch Safe transfer (for salaries / operational funding)
 */
export const receiveBranchSafeTransfer = (
  transferId: string,
  receiver: Salesperson,
  enteredPin: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  if (isSettledTransferStatus(transfer.status)) {
    return { success: false, message: `Transfer ${transfer.transfer_id} has already been received (${transfer.status}).` };
  }

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && !verifySalespersonPin(receiver, enteredPin)) {
    return { success: false, message: 'Invalid Receiver PIN.' };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const wasInTransit = transfer.status === 'IN_TRANSIT';
  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'RECEIVED',
    updatedAt: nowMs,
    lastUpdated: now,
    target_branch_id: 'ALL',
    received_by_user_id: receiver.id,
    received_by_user_name: receiver.name,
    received_at: now,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'BRANCH_SAFE_RECEIVE' as any,
    severity: 'INFO',
    staffId: receiver.id,
    staffName: receiver.name,
    staffRole: receiver.role,
    details: `Received HQ transfer ${transfer.transfer_id} into Branch Safe for $${safeAmount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: safeAmount,
  });

  // Source account was already deducted when dispatched from HQ
  finalizeTransferLedger(updated, receiver, wasInTransit);

  return { success: true, message: `Funds of $${safeAmount.toFixed(2)} received into Branch Safe.`, transfer: updated };
};

/**
 * Completes Third-Party Payout or Bank Deposit once receipt is submitted
 */
export const completeThirdPartyPayout = (
  transferId: string,
  receiptImageUrl?: string,
  notes?: string
): { success: boolean; message: string; transfer?: CashTransfer } => {
  const all = getCashTransfers();
  const transfer = all.find((t) => t.transfer_id === transferId);

  if (!transfer) {
    return { success: false, message: 'Transfer voucher not found.' };
  }

  if (isSettledTransferStatus(transfer.status)) {
    return { success: false, message: `Voucher ${transfer.transfer_id} is already completed.` };
  }

  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  const wasInTransit = transfer.status === 'IN_TRANSIT';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const updated: CashTransfer = {
    ...transfer,
    amount: safeAmount,
    status: 'COMPLETED',
    updatedAt: nowMs,
    lastUpdated: nowIso,
    target_branch_id: isCompanyLevelTransfer(transfer.type, transfer.branch_id) ? 'ALL' : (transfer.target_branch_id || transfer.branch_id),
    receipt_image_url: receiptImageUrl || transfer.receipt_image_url,
    notes: notes || transfer.notes,
  };

  saveCashTransfer(updated);
  finalizeTransferLedger(updated, undefined, wasInTransit);

  return { success: true, message: 'Voucher completed and reconciled.', transfer: updated };
};

/**
 * Double-Entry Fiscal Settlement:
 * 1. Decrements source account balance (if not already deducted during IN_TRANSIT dispatch)
 * 2. Increments destination account balance (if internal account)
 * 3. Writes paired CashLog records (Form 2 ledger)
 */
function finalizeTransferLedger(
  transfer: CashTransfer,
  actor?: Salesperson,
  wasInTransit = false,
  skipDrawerMovement = false
) {
  const safeAmount = parseSafeCurrencyAmount(transfer.amount);
  if (safeAmount <= 0 || safeAmount > MAX_CUSTODY_TRANSACTION_AMOUNT) {
    throw new Error(`Invalid transfer amount during ledger finalization: $${safeAmount}`);
  }

  const accounts = getCashAccounts();
  const fromAcc = findAccountWithFallback(accounts, transfer.from_account_id, transfer.branch_id);
  const toAcc = findAccountWithFallback(accounts, transfer.to_account_id, transfer.branch_id);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Update source account balance ONLY if not already deducted at transit dispatch
  // (and if not a bank withdrawal or capital infusion where source is external)
  if (fromAcc && !wasInTransit && transfer.type !== 'BANK_WITHDRAWAL' && transfer.type !== 'CAPITAL_INFUSION') {
    const updatedFrom: CashAccount = {
      ...fromAcc,
      current_balance: Math.max(0, Math.round((parseSafeCurrencyAmount(fromAcc.current_balance) - safeAmount) * 100) / 100),
      updated_at: nowIso,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };
    saveCashAccount(updatedFrom);
  }

  // 2. Update destination account balance if internal account
  const destinationTarget = toAcc || (transfer.type === 'CAPITAL_INFUSION' || transfer.type === 'BANK_WITHDRAWAL' ? fromAcc : undefined);
  if (destinationTarget && destinationTarget.account_type !== 'BANK_ACCOUNT') {
    const updatedTo: CashAccount = {
      ...destinationTarget,
      current_balance: Math.round((parseSafeCurrencyAmount(destinationTarget.current_balance) + safeAmount) * 100) / 100,
      updated_at: nowIso,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };
    saveCashAccount(updatedTo);
  }

  // 2b. Update Commercial Bank / EcoCash / ZiG Account balances (both Base USD and Native Currency)
  const resolveBankTarget = (): CashAccount | undefined => {
    const byId = accounts.find(
      (a) =>
        a.account_type === 'BANK_ACCOUNT' &&
        (a.account_id === transfer.to_account_id || a.account_id === transfer.from_account_id)
    );
    if (byId) return byId;
    if (transfer.bank_name) {
      const exact = accounts.find(
        (a) => a.account_type === 'BANK_ACCOUNT' && a.account_name.toLowerCase() === transfer.bank_name!.toLowerCase()
      );
      if (exact) return exact;
      const partial = accounts.find(
        (a) =>
          a.account_type === 'BANK_ACCOUNT' &&
          a.account_name.toLowerCase().includes(transfer.bank_name!.slice(0, 4).toLowerCase())
      );
      if (partial) return partial;
    }
    return accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
  };

  if (transfer.type === 'BANK_DEPOSIT') {
    const bankTarget = resolveBankTarget();
    if (bankTarget) {
      if (!transfer.to_account_id) {
        transfer.to_account_id = bankTarget.account_id;
      }
      const nativeDelta = bankTarget.native_currency
        ? (transfer.native_amount !== undefined
            ? parseSafeCurrencyAmount(transfer.native_amount)
            : Math.round(safeAmount * getCurrencyRate(bankTarget.native_currency) * 100) / 100)
        : 0;
      const updatedBank: CashAccount = {
        ...bankTarget,
        current_balance: Math.round((parseSafeCurrencyAmount(bankTarget.current_balance) + safeAmount) * 100) / 100,
        native_balance: bankTarget.native_currency
          ? Math.round((parseSafeCurrencyAmount(bankTarget.native_balance || 0) + nativeDelta) * 100) / 100
          : bankTarget.native_balance,
        updated_at: nowIso,
        updatedAt: nowMs,
        lastUpdated: nowIso,
      };
      saveCashAccount(updatedBank);
    }
    try {
      adjustWalletBalance('wallet_bank_usd', safeAmount);
    } catch (_) {}
  } else if (transfer.type === 'BANK_WITHDRAWAL') {
    const bankTarget = resolveBankTarget();
    if (bankTarget) {
      const nativeDelta = bankTarget.native_currency
        ? (transfer.native_amount !== undefined
            ? parseSafeCurrencyAmount(transfer.native_amount)
            : Math.round(safeAmount * getCurrencyRate(bankTarget.native_currency) * 100) / 100)
        : 0;
      const updatedBank: CashAccount = {
        ...bankTarget,
        current_balance: Math.max(0, Math.round((parseSafeCurrencyAmount(bankTarget.current_balance) - safeAmount) * 100) / 100),
        native_balance: bankTarget.native_currency
          ? Math.max(0, Math.round((parseSafeCurrencyAmount(bankTarget.native_balance || 0) - nativeDelta) * 100) / 100)
          : bankTarget.native_balance,
        updated_at: nowIso,
        updatedAt: nowMs,
        lastUpdated: nowIso,
      };
      saveCashAccount(updatedBank);
    }
    try {
      adjustWalletBalance('wallet_bank_usd', -safeAmount);
    } catch (_) {}
  }

  const linkedCashLogIds: string[] = transfer.linked_cash_log_ids || [];

  // 3. Paired Double-Entry in CashLog (Fiscal Ledger)
  const isVaultTransfer =
    transfer.type === 'BRANCH_TO_HQ' ||
    transfer.type === 'HQ_TO_BRANCH' ||
    transfer.type === 'BANK_DEPOSIT' ||
    transfer.type === 'BANK_WITHDRAWAL' ||
    transfer.type === 'CAPITAL_INFUSION' ||
    transfer.type === 'SUPPLIER_PAYMENT' ||
    transfer.type === 'THIRD_PARTY_PAYOUT';

  const effectiveLogBranch = (isVaultTransfer || transfer.branch_id === 'HQ' || transfer.target_branch_id === 'ALL')
    ? 'ALL'
    : transfer.branch_id;

  // Entry A: OUT from source (if not already logged during transit dispatch)
  if (!wasInTransit && transfer.type !== 'BANK_WITHDRAWAL' && transfer.type !== 'CAPITAL_INFUSION') {
    const isOutVault = isVaultTransfer || transfer.type === 'FLOAT_ISSUE' || transfer.type === 'TILL_COLLECTION';
    const outStaffId = isOutVault ? 'VAULT_CUSTODY' : (actor?.id || transfer.created_by_user_id);
    const outStaffName = isOutVault ? 'Vault Custody' : (actor?.name || transfer.created_by_user_name);

    const logOut = addCashLog({
      date: nowIso.split('T')[0],
      time: nowIso.slice(11, 19),
      staff_id: outStaffId,
      staffId: outStaffId,
      staff_name: outStaffName,
      staffName: outStaffName,
      type: 'Transfer',
      line: transfer.type === 'TILL_COLLECTION' ? 'EOD Till Handover' : 'Custody Transfer OUT',
      category: isVaultTransfer ? 'Vault Custody Transfer' : (transfer.type === 'TILL_COLLECTION' ? 'EOD Till Handover' : 'Transfer'),
      isVaultCustody: true,
      isNonPosTransfer: true,
      description: `Custody Transfer OUT: [${transfer.type}] from ${fromAcc?.account_name || 'Safe'} (Ref: ${transfer.transfer_id})${transfer.bank_name ? ` to ${transfer.bank_name}` : ''}`,
      in: 0,
      out: safeAmount,
      currency: 'USD',
      company_id: transfer.company_id,
      branch_id: transfer.branch_id,
      target_branch_id: (isOutVault || effectiveLogBranch === 'ALL') ? 'ALL' : transfer.branch_id,
    } as any);
    linkedCashLogIds.push(logOut.id);
  }

  // Entry B: IN to destination (Safe, Till, HQ)
  if (destinationTarget) {
    const isInVault = isVaultTransfer || transfer.type === 'TILL_COLLECTION';
    const inStaffId = isInVault ? 'VAULT_CUSTODY' : (actor?.id || transfer.received_by_user_id || transfer.created_by_user_id);
    const inStaffName = isInVault ? 'Vault Custody' : (actor?.name || transfer.received_by_user_name || transfer.created_by_user_name);

    const logIn = addCashLog({
      date: nowIso.split('T')[0],
      time: nowIso.slice(11, 19),
      staff_id: inStaffId,
      staffId: inStaffId,
      staff_name: inStaffName,
      staffName: inStaffName,
      type: 'Transfer',
      line: transfer.type === 'TILL_COLLECTION' ? 'EOD Till Handover' : 'Custody Transfer IN',
      category: isVaultTransfer ? 'Vault Custody Transfer' : (transfer.type === 'FLOAT_ISSUE' ? 'Float' : 'Transfer'),
      isVaultCustody: isInVault,
      isNonPosTransfer: isVaultTransfer,
      description: `Custody Transfer IN: [${transfer.type}] into ${destinationTarget.account_name} (Ref: ${transfer.transfer_id})${transfer.bank_name ? ` from ${transfer.bank_name}` : ''}`,
      in: safeAmount,
      out: 0,
      currency: 'USD',
      company_id: transfer.company_id,
      branch_id: transfer.branch_id,
      target_branch_id: (isInVault || effectiveLogBranch === 'ALL') ? 'ALL' : transfer.branch_id,
    } as any);
    linkedCashLogIds.push(logIn.id);
  }

  // Update transfer record with linked CashLog IDs
  transfer.linked_cash_log_ids = linkedCashLogIds;
  transfer.updatedAt = nowMs;
  transfer.lastUpdated = nowIso;
  saveCashTransfer(transfer);

  // 4. If this is a completed FLOAT_ISSUE, record CashMovement for Cashier till so Form 2 & liveDrawerBalance reflect it immediately!
  // Guard against double-recording when Form 2 already recorded the movement (skipDrawerMovement or matching sourceRef).
  if (!skipDrawerMovement && transfer.type === 'FLOAT_ISSUE' && isSettledTransferStatus(transfer.status)) {
    try {
      const recipientName = transfer.recipient_name;
      const allStaff = getAllSalespeople();
      const targetStaff =
        allStaff.find((s) => s.id === transfer.received_by_user_id) ||
        allStaff.find((s) => s.name?.toLowerCase() === recipientName?.toLowerCase()) ||
        allStaff.find((s) => s.id === transfer.created_by_user_id);

      if (targetStaff) {
        const todayStr = nowIso.split('T')[0];
        const sId = getShiftId(targetStaff.id, todayStr, transfer.branch_id);
        const moves = getMovements(undefined, transfer.branch_id);
        const alreadyRecorded = moves.some((m) => m.sourceRef === transfer.transfer_id);
        if (!alreadyRecorded) {
          const hasInitialFloat = moves.some(
            (m) =>
              (m.shiftId === sId || (m.staffId === targetStaff.id && m.date === todayStr)) &&
              m.type === 'opening_float'
          );

          addMovement({
            shiftId: sId,
            staffId: targetStaff.id,
            date: todayStr,
            timestamp: nowIso,
            type: hasInitialFloat ? 'float_adjustment' : 'opening_float',
            amount: safeAmount,
            currency: 'USD',
            direction: 'in',
            affectsDrawer: true,
            status: 'approved',
            sourceModule: 'form2',
            sourceRef: transfer.transfer_id,
            notes: `Till Float ${hasInitialFloat ? 'Additional Float / Adjustment' : 'Shift Opening Float'} from ${fromAcc?.account_name || 'Custody'} (Voucher: ${transfer.transfer_id})`,
            approvedBy: actor?.id || transfer.created_by_user_id,
            approvedByName: actor?.name || transfer.created_by_user_name,
            approvedAt: nowIso,
            company_id: transfer.company_id,
            branch_id: transfer.branch_id,
          });
        }
      }
    } catch (_) {}
  }

  // If this was paying a supplier with a linked GRV, mark the GRV paid (or reduce unpaid balance if partial)!
  if (transfer.linked_grv_id) {
    markGrvAsPaid(transfer.linked_grv_id, transfer.transfer_id, { paidAmount: safeAmount });
  }

  // Deterministically align all custody account balances with the completed transfer ledger
  reconcileCashAccountsFromTransfers({ companyId: transfer.company_id, syncChanged: true, silent: true });
}

/**
 * Accounts Clerk EOD Consolidation: Sweeps surplus till collections from Clerk Float into Branch Safe Vault
 */
export const consolidateClerkFloatToSafe = (params: {
  amount?: number;
  actor: Salesperson;
  notes?: string;
}): { success: boolean; message: string; voucher?: CashTransfer } => {
  const currentBranch = getCurrentBranchId();
  const clerkAcc = getClerkFloatAccount(currentBranch);
  const safeAcc = getBranchSafeAccount(currentBranch);
  const retainedPettyFloat = 150.0; // Standard retained clerk float

  const clerkBal = parseSafeCurrencyAmount(clerkAcc.current_balance);
  const availableSurplus = Math.max(0, Math.round((clerkBal - retainedPettyFloat) * 100) / 100);
  const transferAmount = params.amount !== undefined
    ? validateCustodyTransactionAmount(params.amount, 'Consolidation amount')
    : availableSurplus;

  if (transferAmount <= 0) {
    return {
      success: false,
      message: `Clerk Float ($${clerkBal.toFixed(2)}) has no surplus above retained petty float ($${retainedPettyFloat.toFixed(2)}) to consolidate.`,
    };
  }

  if (transferAmount > clerkBal) {
    return {
      success: false,
      message: `Insufficient funds in Clerk Float ($${clerkBal.toFixed(2)}) to transfer $${transferAmount.toFixed(2)}.`,
    };
  }

  const voucher = createCashTransferVoucher({
    type: 'TILL_COLLECTION',
    from_account_id: clerkAcc.account_id,
    to_account_id: safeAcc.account_id,
    amount: transferAmount,
    initiator: params.actor,
    recipient_name: 'Branch Safe Vault Custodian',
    notes: params.notes || `Accounts Clerk EOD Sweep: Consolidated $${transferAmount.toFixed(2)} from Clerk Float to Branch Safe Vault`,
  });

  return {
    success: true,
    message: `Successfully consolidated $${transferAmount.toFixed(2)} from Clerk Float to Branch Safe. Vault balance updated!`,
    voucher,
  };
};


/**
 * Marks a GRV voucher as settled (or updates remaining unpaid balance on partial settlement) across all underlying stores
 * strictly within the active tenant company so other companies' records are never overwritten.
 */
export const markGrvAsPaid = (
  grvNumber: string,
  voucherId: string,
  options?: { fromSync?: boolean; paidAmount?: number }
): void => {
  if (!grvNumber) return;
  const activeCompany = getCurrentCompanyId();
  const normTarget = grvNumber.trim().toLowerCase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const paidAmt = options?.paidAmount !== undefined ? parseSafeCurrencyAmount(options.paidAmount) : undefined;

  // 1. Supplier Invoice Vouchers (WPS Excel-style Goods Received Vouchers)
  try {
    const allVouchers = getAllSupplierInvoiceVouchers('ALL');
    allVouchers.forEach((v) => {
      if (!isCompanyInTenantScope((v as any).company_id || (v as any).companyId, activeCompany)) return;
      const vId = (v.voucherId || '').trim().toLowerCase();
      const vInv = (v.invoiceNo || '').trim().toLowerCase();
      if (
        vId === normTarget ||
        vInv === normTarget ||
        (vId && (normTarget.includes(vId) || vId.includes(normTarget))) ||
        (vInv && (normTarget.includes(vInv) || vInv.includes(normTarget)))
      ) {
        const total = parseSafeCurrencyAmount((v as any).totalInvoiceAmount);
        const existingPaid = Math.max(
          parseSafeCurrencyAmount((v as any).custodyPaidAmount || 0),
          parseSafeCurrencyAmount((v as any).paidAmount || 0)
        );
        const nextPaid = paidAmt !== undefined ? Math.round((existingPaid + paidAmt) * 100) / 100 : total;
        const isFullySettled = paidAmt === undefined || total <= 0 || nextPaid >= total - 0.009;
        if (isFullySettled) {
          if (v.paymentStatus !== 'PAID' || v.paidVoucherId !== voucherId) {
            saveSupplierInvoiceVoucher(
              {
                ...v,
                paymentStatus: 'PAID',
                paidVoucherId: voucherId,
                paidAt: now,
                paidAmount: nextPaid,
                custodyPaidAmount: nextPaid,
              } as any,
              { fromSync: options?.fromSync }
            );
          }
        } else {
          saveSupplierInvoiceVoucher(
            {
              ...v,
              paidAmount: nextPaid,
              custodyPaidAmount: nextPaid,
            } as any,
            { fromSync: options?.fromSync }
          );
        }
      }
    });
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in SupplierInvoices:', err);
  }

  // 2. Direct GRVs (read raw store so other companies' Direct GRVs are never wiped)
  try {
    const rawAll = getStored<DirectGrv[]>(STORAGE_KEYS.DIRECT_GRVS, []);
    let updated = false;
    const updatedList: DirectGrv[] = [];
    rawAll.forEach((g) => {
      if (!isCompanyInTenantScope((g as any).company_id || (g as any).companyId, activeCompany)) return;
      const gNum = (g.grvNumber || '').trim().toLowerCase();
      const gId = (g.id || '').trim().toLowerCase();
      const gInv = (g.invoiceNo || '').trim().toLowerCase();
      if (
        gNum === normTarget ||
        gId === normTarget ||
        (gInv && gInv === normTarget) ||
        (gNum && (normTarget.includes(gNum) || gNum.includes(normTarget))) ||
        (gInv && (normTarget.includes(gInv) || gInv.includes(normTarget)))
      ) {
        const fullCost = parseSafeCurrencyAmount(g.totalCost);
        const currentRemaining =
          g.unpaidBalance !== undefined
            ? parseSafeCurrencyAmount(g.unpaidBalance)
            : Math.max(
                0,
                fullCost -
                  (Array.isArray(g.payments)
                    ? g.payments.reduce((s: number, p: any) => s + parseSafeCurrencyAmount(p?.amount), 0)
                    : parseSafeCurrencyAmount((g as any).paidFromDrawerAmount))
              );
        const nextRemaining =
          paidAmt !== undefined ? Math.round(Math.max(0, currentRemaining - paidAmt) * 100) / 100 : 0;
        const isFullySettled = nextRemaining <= 0.009;

        if (isFullySettled) {
          if (g.paymentStatus !== 'PAID' || (g as any).paidVoucherId !== voucherId) {
            g.paymentStatus = 'PAID';
            g.unpaidBalance = 0;
            (g as any).creditBalance = 0;
            g.paidVoucherId = voucherId;
            (g as any).updatedAt = nowMs;
            (g as any).lastUpdated = now;
            updated = true;
            updatedList.push(g);
          }
        } else {
          g.unpaidBalance = nextRemaining;
          (g as any).creditBalance = nextRemaining;
          (g as any).updatedAt = nowMs;
          (g as any).lastUpdated = now;
          updated = true;
          updatedList.push(g);
        }
      }
    });
    if (updated) {
      setStored(STORAGE_KEYS.DIRECT_GRVS, rawAll);
      if (!options?.fromSync) {
        updatedList.forEach((g) => {
          enqueueSync('Direct_GRV', 'UPDATE', g);
          notifyDirectGrvChanged(g);
        });
      }
      notifyListeners();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_direct_grvs_updated'));
      }
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in DirectGrvs:', err);
  }

  // 3. Unified Goods Received Notes (read raw so other companies' GRNs are never overwritten)
  try {
    const allGrns = getRawStoredGoodsReceivedNotes();
    let updatedGrns = false;
    allGrns.forEach((g) => {
      if (!isCompanyInTenantScope(g.company_id || g.companyId, activeCompany)) return;
      const gNum = (g.grnNumber || '').trim().toLowerCase();
      const gId = (g.id || '').trim().toLowerCase();
      const gInv = ((g as any).invoiceNo || '').trim().toLowerCase();
      if (
        gNum === normTarget ||
        gId === normTarget ||
        (gInv && gInv === normTarget) ||
        (gNum && (normTarget.includes(gNum) || gNum.includes(normTarget))) ||
        (gInv && (normTarget.includes(gInv) || gInv.includes(normTarget)))
      ) {
        const rawDirect = (g as any)._rawDirectGrv;
        const total = parseSafeCurrencyAmount(g.totals?.totalInventoryValue || g.totals?.subtotal);
        const currentRemaining =
          rawDirect && rawDirect.unpaidBalance !== undefined
            ? parseSafeCurrencyAmount(rawDirect.unpaidBalance)
            : total;
        const nextRemaining =
          paidAmt !== undefined ? Math.round(Math.max(0, currentRemaining - paidAmt) * 100) / 100 : 0;

        if (nextRemaining <= 0.009) {
          (g as any).paymentStatus = 'PAID';
          (g as any).paidVoucherId = voucherId;
          if (rawDirect) {
            rawDirect.paymentStatus = 'PAID';
            rawDirect.unpaidBalance = 0;
            rawDirect.paidVoucherId = voucherId;
          }
        } else if (rawDirect) {
          rawDirect.unpaidBalance = nextRemaining;
        }
        g.updatedAt = now;
        updatedGrns = true;
      }
    });
    if (updatedGrns) {
      saveAllGoodsReceivedNotes(allGrns);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_grn_updated'));
      }
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in GoodsReceivedNotes:', err);
  }

  // 4. Legacy Goods Received Entries (company-scoped + sync enqueued)
  try {
    const grns = getStored<any[]>(STORAGE_KEYS.GOODS_RECEIVED, []);
    let updatedLegacy = false;
    const updatedLegacyEntries: any[] = [];
    const mapped = grns.map((g) => {
      if (!isCompanyInTenantScope(g.company_id || g.companyId, activeCompany)) return g;
      const num = (g.grnNumber || g.invoiceNo || g.grnId || g.id || '').trim().toLowerCase();
      if (num === normTarget || (num && (normTarget.includes(num) || num.includes(normTarget)))) {
        const cost = parseSafeCurrencyAmount(g.totalCost || g.lineTotal);
        if (paidAmt === undefined || cost <= 0 || paidAmt >= cost - 0.009) {
          updatedLegacy = true;
          const nextEntry = {
            ...g,
            paymentStatus: 'PAID',
            paidVoucherId: voucherId,
            updatedAt: nowMs,
            lastUpdated: now,
          };
          updatedLegacyEntries.push(nextEntry);
          return nextEntry;
        }
      }
      return g;
    });
    if (updatedLegacy) {
      setStored(STORAGE_KEYS.GOODS_RECEIVED, mapped);
      if (!options?.fromSync) {
        updatedLegacyEntries.forEach((entry) => {
          enqueueSync('GoodsReceived' as any, 'UPDATE', entry);
        });
      }
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in GoodsReceived:', err);
  }
};

/**
 * Unified GRV Discovery for Accounts Clerk & Dual Custody:
 * Discovers ALL pending/unpaid GRVs across all formats in the store:
 * 1. Supplier Invoice Vouchers (WPS Excel-style multi-product receiving, e.g. Palliam)
 * 2. Direct GRVs (Form 2 / Direct deliveries)
 * 3. Unified Goods Received Notes
 * 4. Legacy Goods Received entries
 * De-duplicates entries so each delivery appears once with its correct total cost.
 */
export const getUnpaidGrvsForSafePayment = (): UnpaidGrvRecord[] => {
  const transfers = getCashTransfers('ALL');
  const paidGrvNumbers = new Set<string>();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const branches = getBranches();
  const rawSuppliers = getRawStoredSuppliers().filter((s: any) =>
    isCompanyInTenantScope(s.company_id || s.companyId, currentCompany)
  );

  // Build supplier lookup maps so raw UUIDs or SUP-001 codes always resolve to human Supplier Names
  const supplierNameByKey = new Map<string, string>();
  rawSuppliers.forEach((s: any) => {
    const humanName = (s.name || s.supplierName || s.companyName || '').trim();
    if (!humanName) return;
    if (s.id) supplierNameByKey.set(String(s.id).toLowerCase().trim(), humanName);
    if (s.supplierId) supplierNameByKey.set(String(s.supplierId).toLowerCase().trim(), humanName);
    if (s.code) supplierNameByKey.set(String(s.code).toLowerCase().trim(), humanName);
    if (s.supplierCode) supplierNameByKey.set(String(s.supplierCode).toLowerCase().trim(), humanName);
  });

  const looksLikeRawId = (val?: string): boolean => {
    if (!val) return true;
    const trimmed = val.trim();
    if (!trimmed) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    if (/^SUP[-_ ]?\d+$/i.test(trimmed)) return true;
    if (/^S-[A-Z0-9]+-[A-Z0-9]+-\d+$/i.test(trimmed)) return true;
    return false;
  };

  const resolveSupplierName = (supplierId?: string, supplierName?: string, fallback = 'General Supplier'): string => {
    const idKey = (supplierId || '').toLowerCase().trim();
    const nameKey = (supplierName || '').toLowerCase().trim();

    if (supplierName && !looksLikeRawId(supplierName)) {
      return supplierName.trim();
    }
    if (idKey && supplierNameByKey.has(idKey)) {
      return supplierNameByKey.get(idKey)!;
    }
    if (nameKey && supplierNameByKey.has(nameKey)) {
      return supplierNameByKey.get(nameKey)!;
    }
    if (supplierName && supplierName.trim()) {
      // Truncate ugly UUID if supplier was deleted
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(supplierName.trim())) {
        return `${fallback} (#${supplierName.trim().slice(0, 6).toUpperCase()})`;
      }
      return supplierName.trim();
    }
    return fallback;
  };

  const MAIN_ALIASES = new Set(['1', 'br-main', 'br001', 'hq-01', 'sai-01', 'main']);
  const resolveBranchInfo = (rawBranchId?: string, rawBranchName?: string): { branchId: string; branchName: string } => {
    const bId = (rawBranchId || (currentBranch && currentBranch !== 'ALL' ? currentBranch : '') || 'BR-MAIN').trim();
    const lowerId = bId.toLowerCase();
    const lowerName = (rawBranchName || '').trim().toLowerCase();

    // Single-branch companies map all tenant GRVs to their single canonical branch (no split duplicate pills)
    if (branches.length === 1) {
      const only = branches[0];
      return {
        branchId: only.branchId || only.id || bId,
        branchName: only.name || rawBranchName || 'Main Branch',
      };
    }

    const match = branches.find((b: any) => {
      const candidates = [b.id, b.branchId, b.branch_id, b.code, b.branchCode]
        .filter(Boolean)
        .map((v: any) => String(v).trim().toLowerCase());
      if (candidates.includes(lowerId)) return true;
      if (lowerName && b.name && String(b.name).trim().toLowerCase() === lowerName) return true;
      if (MAIN_ALIASES.has(lowerId) && (b.isMain || candidates.some((c) => MAIN_ALIASES.has(c)))) return true;
      return false;
    });

    return {
      branchId: match?.branchId || match?.id || (MAIN_ALIASES.has(lowerId) ? 'BR-MAIN' : bId),
      branchName: match?.name || rawBranchName || (MAIN_ALIASES.has(lowerId) ? 'Main Branch' : bId),
    };
  };

  // Collect settled / in-transit SUPPLIER_PAYMENT transfer amounts by linked GRV key
  const settledTransfersForGrv: { normRef: string; amount: number }[] = [];
  transfers.forEach((t) => {
    if (t.linked_grv_id && (isSettledTransferStatus(t.status) || t.status === 'IN_TRANSIT')) {
      const normRef = t.linked_grv_id.toLowerCase().trim();
      paidGrvNumbers.add(normRef);
      settledTransfersForGrv.push({ normRef, amount: parseSafeCurrencyAmount(t.amount) });
    }
  });

  const getCustodyPaidAmountForGrv = (id?: string, grvNum?: string, invoiceNo?: string): number => {
    const keys = [id, grvNum, invoiceNo]
      .filter(Boolean)
      .map((k) => String(k).toLowerCase().trim())
      .filter((k) => k.length > 0);
    if (keys.length === 0) return 0;

    let sum = 0;
    for (const st of settledTransfersForGrv) {
      const matches = keys.some(
        (k) => st.normRef === k || st.normRef.includes(k) || k.includes(st.normRef)
      );
      if (matches) sum += st.amount;
    }
    return Math.round(sum * 100) / 100;
  };

  const list: UnpaidGrvRecord[] = [];
  const seenKeys = new Set<string>();

  const isAlreadySeen = (id?: string, grvNum?: string, invoiceNo?: string): boolean => {
    const normId = (id || '').toLowerCase().trim();
    const normNum = (grvNum || '').toLowerCase().trim();
    const normInv = (invoiceNo || '').toLowerCase().trim();

    if (normId && seenKeys.has(normId)) return true;
    if (normNum && seenKeys.has(normNum)) return true;
    if (normInv && seenKeys.has(normInv)) return true;
    return false;
  };

  const registerSeen = (id?: string, grvNum?: string, invoiceNo?: string) => {
    if (id) seenKeys.add(id.toLowerCase().trim());
    if (grvNum) seenKeys.add(grvNum.toLowerCase().trim());
    if (invoiceNo) seenKeys.add(invoiceNo.toLowerCase().trim());
  };

  /**
   * Computes accurate till-paid, custody-paid, and remaining payable balance for Direct GRVs.
   * Example: $37.50 invoice where Till paid $37.50 -> remaining = $0.00 (excluded).
   * Example: $37.50 invoice where Till paid $27.50 -> remaining = $10.00 (payable in Dual Custody).
   */
  const computeDirectGrvPaymentBreakdown = (g: any, custodyPaid: number) => {
    const fullCost = parseSafeCurrencyAmount(g.totalCost);
    const paymentsSum = Array.isArray(g.payments)
      ? Math.round(g.payments.reduce((sum: number, p: any) => sum + parseSafeCurrencyAmount(p?.amount), 0) * 100) / 100
      : 0;
    const drawerPaid = parseSafeCurrencyAmount(g.paidFromDrawerAmount);
    const isExplicitCreditOrSafe =
      g.payFromTill === false ||
      g.paymentMethod === 'INVOICE_ON_ACCOUNT' ||
      g.paymentMethod === 'CREDIT' ||
      g.paymentMethod === 'BANK' ||
      g.paymentStatus === 'INVOICE_CREDIT' ||
      g.paymentStatus === 'AWAITING_SAFE_PAYMENT';

    let tillPaid = Math.max(paymentsSum, drawerPaid);

    // Handle Direct GRVs paid from till where payments[] wasn't populated (e.g. legacy or drawer-paid shorthand)
    if (tillPaid <= 0 && !isExplicitCreditOrSafe) {
      if (g.paymentStatus === 'PAID') {
        tillPaid = fullCost;
      } else if (g.payFromTill === true) {
        if (g.unpaidBalance !== undefined && g.unpaidBalance !== null && custodyPaid === 0) {
          const explicitUnpaid = parseSafeCurrencyAmount(g.unpaidBalance);
          tillPaid = Math.max(0, Math.round((fullCost - explicitUnpaid) * 100) / 100);
        } else if (g.unpaidBalance === undefined && g.creditBalance === undefined) {
          tillPaid = fullCost;
        }
      }
    }

    const clampedTillPaid = Math.min(fullCost, Math.max(0, Math.round(tillPaid * 100) / 100));
    let remainingBalance = Math.round(Math.max(0, fullCost - clampedTillPaid - custodyPaid) * 100) / 100;

    // Also respect explicit unpaidBalance === 0 when marked PAID or paidVoucherId set
    const isFullyPaid =
      Boolean(g.paidVoucherId) ||
      g.paymentStatus === 'PAID' ||
      remainingBalance <= 0.009;

    if (isFullyPaid) {
      remainingBalance = 0;
    }

    return {
      fullCost,
      tillPaid: clampedTillPaid,
      custodyPaid,
      remainingBalance,
      isFullyPaid,
    };
  };

  // 1. Scan Supplier Invoice Vouchers
  try {
    const vouchers = getAllSupplierInvoiceVouchers('ALL');
    vouchers.forEach((v: any) => {
      if (!isCompanyInTenantScope(v.company_id || v.companyId, currentCompany)) return;
      const vId = v.voucherId || v.invoiceNo;
      const vNum = v.voucherId || v.invoiceNo;
      const vInv = v.invoiceNo;

      if (isAlreadySeen(vId, vNum, vInv)) return;
      // Always register seen so mirrored GRN/legacy stores cannot resurrect paid/zero-balance vouchers
      registerSeen(vId, vNum, vInv);

      const fullCost = parseSafeCurrencyAmount(v.totalInvoiceAmount);
      if (fullCost <= 0) return;

      const custodyPaid = getCustodyPaidAmountForGrv(vId, vNum, vInv);
      const remaining = Math.round(Math.max(0, fullCost - custodyPaid) * 100) / 100;
      const explicitPaid = v.paymentStatus === 'PAID' || Boolean(v.paidVoucherId) || remaining <= 0.009;
      if (explicitPaid) return;

      const safeName = v.allocatedSafeName || (v.allocatedSafeId?.includes('HQ') ? 'HQ Central Vault Safe' : 'Branch Safe (Main Vault)');
      const branchInfo = resolveBranchInfo(v.branch_id || v.branchId, v.branch_name || v.branchName);
      const mappedItems: GrvLineItemDetail[] = Array.isArray(v.items)
        ? v.items.map((it: any) => {
            const qty = Number(it.qtyReceived ?? it.qty ?? it.quantity ?? it.cases ?? 1) || 0;
            const unitCost = Number(it.unitCost ?? it.costPrice ?? it.costPerCase ?? 0) || 0;
            const lineTotal = Number(it.lineTotal ?? it.totalCost ?? qty * unitCost) || 0;
            return {
              productName: it.productName || it.itemName || it.name || 'Item',
              qty,
              unit: it.unit || it.unitType || 'unit',
              unitCost,
              lineTotal,
            };
          })
        : [];

      list.push({
        id: vId,
        grvNumber: vNum,
        supplierId: v.supplierId || v.supplier,
        supplierName: resolveSupplierName(v.supplierId, v.supplierName || v.supplier, 'Supplier Delivery'),
        invoiceNo: vInv,
        date: v.date || toDateStringSafe(v.timestamp),
        totalCost: remaining,
        originalTotalCost: custodyPaid > 0 ? fullCost : undefined,
        custodyPaidAmount: custodyPaid > 0 ? custodyPaid : undefined,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: (v.paymentStatus as any) || 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: v.allocatedSafeId,
        allocatedSafeName: safeName,
        receivedByStaffName: v.staffName || v.staffId || 'Admin',
        itemsCount: mappedItems.length || 1,
        items: mappedItems,
        branchId: branchInfo.branchId,
        branchName: branchInfo.branchName,
        sourceType: 'SUPPLIER_VOUCHER',
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning SupplierInvoiceVouchers:', err);
  }

  // 2. Scan Direct GRVs (Form 2 / Direct deliveries)
  try {
    const directGrvs = getAllDirectGrvs('ALL');
    directGrvs.forEach((g: any) => {
      if (!isCompanyInTenantScope(g.company_id || g.companyId, currentCompany)) return;
      const gNumber = g.grvNumber || g.id;

      if (isAlreadySeen(g.id, gNumber, g.invoiceNo)) return;
      // CRITICAL: Register seen BEFORE skipping rejected/fully-paid Direct GRVs so Loop 3 (mirrored GoodsReceivedNotes) NEVER resurrects them!
      registerSeen(g.id, gNumber, g.invoiceNo);

      if (g.status === 'REJECTED') return;

      const custodyPaid = getCustodyPaidAmountForGrv(g.id, gNumber, g.invoiceNo);
      const breakdown = computeDirectGrvPaymentBreakdown(g, custodyPaid);

      if (breakdown.isFullyPaid || breakdown.remainingBalance <= 0.009) return;

      const safeName = g.allocatedSafeName || (g.allocatedSafeId?.includes('HQ') ? 'HQ Central Vault Safe' : 'Branch Safe (Main Vault)');
      const branchInfo = resolveBranchInfo(g.branch_id || g.branchId, g.branch_name || g.branchName);
      const mappedItems: GrvLineItemDetail[] = Array.isArray(g.items)
        ? g.items.map((it: any) => {
            const qty = Number(it.quantity ?? it.qty ?? it.qtyReceived ?? it.cases ?? 1) || 0;
            const unitCost = Number(it.unitCost ?? it.costPrice ?? it.cost ?? 0) || 0;
            const lineTotal = Number(it.totalCost ?? it.lineTotal ?? qty * unitCost) || 0;
            return {
              productName: it.productName || it.itemName || it.name || 'Item',
              qty,
              unit: it.unit || it.unitType || 'unit',
              unitCost,
              lineTotal,
            };
          })
        : [];

      list.push({
        id: g.id || gNumber,
        grvNumber: gNumber,
        supplierId: g.supplierId,
        supplierName: resolveSupplierName(g.supplierId, g.supplierName, 'Direct Supplier'),
        invoiceNo: g.invoiceNo,
        date: g.date || toDateStringSafe(g.createdAt),
        totalCost: breakdown.remainingBalance,
        originalTotalCost:
          breakdown.tillPaid > 0 || breakdown.custodyPaid > 0 ? breakdown.fullCost : undefined,
        tillPaidAmount: breakdown.tillPaid > 0 ? breakdown.tillPaid : undefined,
        custodyPaidAmount: breakdown.custodyPaid > 0 ? breakdown.custodyPaid : undefined,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: g.allocatedSafeId,
        allocatedSafeName: safeName,
        receivedByStaffName: g.receivedByStaffName,
        itemsCount: mappedItems.length,
        items: mappedItems,
        branchId: branchInfo.branchId,
        branchName: branchInfo.branchName,
        sourceType: 'DIRECT_GRV',
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning DirectGrvs:', err);
  }

  // 3. Scan Unified Goods Received Notes (goodsReceivedNotes store)
  try {
    const grnNotes = getAllGoodsReceivedNotes(currentCompany);
    grnNotes.forEach((entry: any) => {
      if (!isCompanyInTenantScope(entry.company_id || entry.companyId, currentCompany)) return;
      const gNum = entry.grnNumber || entry.id;
      const gInv = entry.invoiceNo || (entry.payableId && entry.payableId !== entry.id ? entry.payableId : undefined);

      if (isAlreadySeen(entry.id, gNum, gInv)) return;
      registerSeen(entry.id, gNum, gInv);

      if (entry.status === 'REJECTED') return;

      const custodyPaid = getCustodyPaidAmountForGrv(entry.id, gNum, gInv);
      const rawDirect = entry._rawDirectGrv;

      let payableCost = 0;
      let originalTotalCost: number | undefined;
      let tillPaidAmount: number | undefined;

      if (rawDirect) {
        const breakdown = computeDirectGrvPaymentBreakdown(rawDirect, custodyPaid);
        if (breakdown.isFullyPaid || breakdown.remainingBalance <= 0.009) return;
        payableCost = breakdown.remainingBalance;
        if (breakdown.tillPaid > 0 || breakdown.custodyPaid > 0) {
          originalTotalCost = breakdown.fullCost;
        }
        if (breakdown.tillPaid > 0) {
          tillPaidAmount = breakdown.tillPaid;
        }
      } else {
        const explicitPaid =
          entry.paymentStatus === 'PAID' ||
          entry.status === 'PAID' ||
          Boolean(entry.paidVoucherId);
        if (explicitPaid) return;

        // Direct cash_immediate deliveries without a partial-payment balance are already settled at the till
        if (
          entry.paymentMode === 'cash_immediate' &&
          entry.paymentStatus !== 'AWAITING_SAFE_PAYMENT' &&
          entry.paymentStatus !== 'PARTIALLY_PAID_TILL' &&
          entry.paymentStatus !== 'UNPAID'
        ) {
          return;
        }

        const fullCost = parseSafeCurrencyAmount(entry.totals?.totalInventoryValue || entry.totals?.subtotal);
        payableCost = Math.round(Math.max(0, fullCost - custodyPaid) * 100) / 100;
        if (payableCost <= 0.009) return;
        if (custodyPaid > 0) {
          originalTotalCost = fullCost;
        }
      }

      const branchInfo = resolveBranchInfo(entry.branch_id || entry.branchId, entry.branch_name || entry.branchName);
      const mappedItems: GrvLineItemDetail[] = Array.isArray(entry.lineItems)
        ? entry.lineItems.map((it: any) => {
            const qty = Number(it.deliveredCases ?? it.qtyReceived ?? it.qty ?? it.quantity ?? 1) || 0;
            const unitCost = Number(it.costPerCase ?? it.unitCost ?? it.cost ?? 0) || 0;
            const lineTotal = Number(it.lineTotal ?? it.totalCost ?? it.subtotal ?? qty * unitCost) || 0;
            return {
              productName: it.productName || it.itemName || it.name || 'Item',
              qty,
              unit: it.unit || it.unitType || 'case',
              unitCost,
              lineTotal,
            };
          })
        : [];

      list.push({
        id: entry.id || gNum,
        grvNumber: gNum,
        supplierId: entry.supplierId,
        supplierName: resolveSupplierName(entry.supplierId, entry.suppliers?.[0] || entry.supplierName, 'Goods Received Supplier'),
        invoiceNo: gInv,
        date: entry.dateReceived || '',
        totalCost: payableCost,
        originalTotalCost,
        tillPaidAmount,
        custodyPaidAmount: custodyPaid > 0 ? custodyPaid : undefined,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: undefined,
        allocatedSafeName: 'Branch Safe (Main Vault)',
        receivedByStaffName: entry.receivedBy,
        itemsCount: mappedItems.length || 1,
        items: mappedItems,
        branchId: branchInfo.branchId,
        branchName: branchInfo.branchName,
        sourceType: rawDirect ? 'DIRECT_GRV' : 'GRN',
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning GoodsReceivedNotes:', err);
  }

  // 4. Scan Tab 2 Legacy Goods Received Notes (strictly company-isolated)
  try {
    const grns = getStored<GoodsReceivedEntry[]>(STORAGE_KEYS.GOODS_RECEIVED, []).filter((entry: any) =>
      isCompanyInTenantScope(entry.company_id || entry.companyId, currentCompany)
    );
    const grnGroups = new Map<string, { entry: any; totalCost: number; items: GrvLineItemDetail[] }>();

    grns.forEach((entry: any) => {
      const num = entry.grnId || entry.grnNumber || entry.invoiceNo || entry.id;
      if (!num) return;
      const qty = Number(entry.deliveredCases ?? entry.receivedCases ?? entry.qty ?? 1) || 0;
      const unitCost = Number(entry.costPerCase ?? entry.unitCost ?? 0) || 0;
      const cost = Number(entry.totalCost) || Number(entry.lineTotal) || (qty * unitCost) || 0;
      const itemDetail: GrvLineItemDetail = {
        productName: entry.productName || entry.itemName || entry.product || 'Delivered Item',
        qty,
        unit: entry.unit || 'case',
        unitCost,
        lineTotal: cost,
      };

      if (!grnGroups.has(num)) {
        grnGroups.set(num, { entry, totalCost: cost, items: [itemDetail] });
      } else {
        const grp = grnGroups.get(num)!;
        grp.totalCost += cost;
        grp.items.push(itemDetail);
      }
    });

    grnGroups.forEach((group, num) => {
      const entry = group.entry;
      if (isAlreadySeen(entry.grnId || entry.id, num, entry.invoiceNo)) return;
      registerSeen(entry.grnId || entry.id, num, entry.invoiceNo);

      const custodyPaid = getCustodyPaidAmountForGrv(entry.grnId || entry.id, num, entry.invoiceNo);
      const remaining = Math.round(Math.max(0, group.totalCost - custodyPaid) * 100) / 100;
      const explicitPaid = entry.paymentStatus === 'PAID' || Boolean(entry.paidVoucherId) || remaining <= 0.009;
      if (explicitPaid) return;

      const branchInfo = resolveBranchInfo(entry.branch_id || entry.branchId, entry.branch_name || entry.branchName);

      list.push({
        id: entry.grnId || entry.id || num,
        grvNumber: num,
        supplierId: entry.supplierId,
        supplierName: resolveSupplierName(entry.supplierId, entry.supplier || entry.supplierName, 'Goods Received Supplier'),
        invoiceNo: entry.invoiceNo,
        date: entry.dateReceived || entry.date || '',
        totalCost: remaining,
        originalTotalCost: custodyPaid > 0 ? Math.round(group.totalCost * 100) / 100 : undefined,
        custodyPaidAmount: custodyPaid > 0 ? custodyPaid : undefined,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: undefined,
        allocatedSafeName: 'Branch Safe (Main Vault)',
        receivedByStaffName: entry.receivedBy || entry.staffName,
        itemsCount: group.items.length,
        items: group.items,
        branchId: branchInfo.branchId,
        branchName: branchInfo.branchName,
        sourceType: 'LEGACY_GRN',
      });
    });
  } catch (_) {}

  // Sort newest date first
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return list;
};

/**
 * Helper to retrieve Owner Break-Glass Overrides for the past N days
 */
export const getOwnerOverrideAlerts = (days = 7): CashTransfer[] => {
  const transfers = getCashTransfers();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return transfers.filter((t) => {
    if (!t.is_owner_override) return false;
    const createdAtTime = new Date(t.created_at).getTime();
    return createdAtTime >= cutoff;
  });
};

export interface BankBreakdownItem {
  name: string;
  balance: number;
  accountId: string;
  currency: string;
  nativeCurrency?: string;
  nativeBalance?: number;
  subtype?: 'ECOCASH' | 'ZIG' | 'COMMERCIAL_BANK';
}

/**
 * Helper to compute custody balances breakdown (including EcoCash & ZiG native + base USD totals)
 */
export const getCustodyBalancesSummary = (branchId?: string) => {
  const accounts = getCashAccounts(branchId || 'ALL');
  const transfers = getCashTransfers(branchId || 'ALL');

  let totalHqSafe = 0;
  let totalBranchSafes = 0;
  let totalClerkFloats = 0;
  let totalTills = 0;
  let totalBankBalances = 0;
  const bankBreakdown: BankBreakdownItem[] = [];

  accounts.forEach((acc) => {
    const bal = parseSafeCurrencyAmount(acc.current_balance);
    if (acc.account_type === 'HQ_SAFE') {
      totalHqSafe += bal;
    } else if (acc.account_type === 'SAFE') {
      totalBranchSafes += bal;
    } else if (acc.account_type === 'CLERK_FLOAT') {
      totalClerkFloats += bal;
    } else if (acc.account_type === 'TILL') {
      totalTills += bal;
    } else if (acc.account_type === 'BANK_ACCOUNT') {
      totalBankBalances += bal;
      bankBreakdown.push({
        name: acc.account_name,
        balance: bal,
        accountId: acc.account_id,
        currency: acc.currency || 'USD',
        nativeCurrency: acc.native_currency,
        nativeBalance: acc.native_currency ? parseSafeCurrencyAmount(acc.native_balance || 0) : undefined,
        subtype: acc.account_subtype || (
          acc.account_id.includes('ECOCASH') || acc.account_name.toLowerCase().includes('ecocash')
            ? 'ECOCASH'
            : acc.account_id.includes('ZIG') || acc.account_name.toLowerCase().includes('zig')
            ? 'ZIG'
            : 'COMMERCIAL_BANK'
        ),
      });
    }
  });

  totalHqSafe = Math.round(totalHqSafe * 100) / 100;
  totalBranchSafes = Math.round(totalBranchSafes * 100) / 100;
  totalClerkFloats = Math.round(totalClerkFloats * 100) / 100;
  totalTills = Math.round(totalTills * 100) / 100;
  totalBankBalances = Math.round(totalBankBalances * 100) / 100;

  // Calculate Cash In Transit from uncompleted transfers
  const totalCashInTransit = Math.round(
    transfers
      .filter((t) => t.status === 'IN_TRANSIT')
      .reduce((sum, t) => sum + parseSafeCurrencyAmount(t.amount), 0) * 100
  ) / 100;

  return {
    totalHqSafe,
    totalBranchSafes,
    totalClerkFloats,
    totalTills,
    totalCashInTransit,
    totalBankBalances,
    bankBreakdown,
    physicalCashTotal: Math.round((totalHqSafe + totalBranchSafes + totalClerkFloats + totalTills + totalCashInTransit) * 100) / 100,
    grandTotal: Math.round((totalHqSafe + totalBranchSafes + totalClerkFloats + totalTills + totalCashInTransit + totalBankBalances) * 100) / 100,
  };
};

/**
 * Returns all configured commercial bank & electronic settlement accounts
 */
export const getBankAccounts = (_companyId?: string): CashAccount[] => {
  const accounts = getCashAccounts('ALL');
  return accounts.filter((a) => a.account_type === 'BANK_ACCOUNT');
};

export interface RecordCustodialExpenseParams {
  fromAccountId: string;
  amount: number;
  category: string;
  description: string;
  payee: string;
  receiptNumber?: string;
  supervisor: Salesperson;
  notes?: string;
  date?: string;
}

/**
 * Record a major utility or operational expense paid directly from the Branch Safe Vault or Accounts Clerk Float.
 */
export const recordCustodialExpense = (
  params: RecordCustodialExpenseParams
): { success: boolean; message: string; voucher?: CashTransfer } => {
  const safeAmount = validateCustodyTransactionAmount(params.amount, 'Expense amount');
  const currentBranch = getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const accounts = getCashAccounts('ALL');
  const sourceAcc = accounts.find((a) => a.account_id === params.fromAccountId);

  if (!sourceAcc) {
    return { success: false, message: 'Source cash account not found.' };
  }

  const currentBal = parseSafeCurrencyAmount(sourceAcc.current_balance);
  if (currentBal < safeAmount) {
    return {
      success: false,
      message: `Insufficient balance in ${sourceAcc.account_name} ($${currentBal.toFixed(2)}) to pay expense of $${safeAmount.toFixed(2)}.`,
    };
  }

  const todayStr = params.date || new Date().toISOString().split('T')[0];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Deduct custodial account balance
  const updatedAcc: CashAccount = {
    ...sourceAcc,
    current_balance: Math.round((currentBal - safeAmount) * 100) / 100,
    updated_at: nowIso,
    updatedAt: nowMs,
    lastUpdated: nowIso,
  };
  saveCashAccount(updatedAcc);

  // 2. Create and complete CashTransfer voucher
  const voucherId = `TRF-${todayStr.replace(/-/g, '')}-${nowMs.toString().slice(-4)}`;
  const accBranch = sourceAcc.branch_id || currentBranch;
  const branchObj = getBranches().find((b) => b.id === accBranch || b.branchCode === accBranch);
  const voucher: CashTransfer = {
    transfer_id: voucherId,
    company_id: currentCompany,
    branch_id: accBranch,
    branch_name: branchObj?.name || accBranch,
    target_branch_id: isCompanyLevelTransfer('THIRD_PARTY_PAYOUT', accBranch) ? 'ALL' : accBranch,
    type: 'THIRD_PARTY_PAYOUT',
    from_account_id: sourceAcc.account_id,
    to_account_id: undefined,
    amount: safeAmount,
    currency: 'USD',
    status: 'COMPLETED',
    updatedAt: nowMs,
    lastUpdated: nowIso,
    created_by_user_id: params.supervisor.id,
    created_by_user_name: params.supervisor.name,
    created_at: nowIso,
    approved_by_user_id: params.supervisor.id,
    approved_by_user_name: params.supervisor.name,
    approved_at: nowIso,
    recipient_name: params.payee,
    receipt_image_url: params.receiptNumber ? `REF-${params.receiptNumber}` : undefined,
    notes: `[${params.category}] ${params.description} (Paid to: ${params.payee})${params.receiptNumber ? ` Ref: ${params.receiptNumber}` : ''}${params.notes ? ` - ${params.notes}` : ''}`,
    is_owner_override: params.supervisor.role === 'OWNER' || params.supervisor.role === 'SUPER_ADMIN',
  };
  saveCashTransfer(voucher);
  reconcileCashAccountsFromTransfers({ companyId: currentCompany, syncChanged: true, silent: true });

  // 3. Persist ExpenseEntry into roomDatabase so IncomeStatement includes it in Profit & Loss
  const paymentMethodLabel =
    sourceAcc.account_type === 'HQ_SAFE'
      ? 'HQ Safe Vault Cash'
      : sourceAcc.account_type === 'SAFE'
      ? 'Safe Vault Cash'
      : 'Clerk Float Cash';
  const custodialStaffId =
    sourceAcc.account_type === 'HQ_SAFE'
      ? 'CUSTODIAL_HQ_SAFE'
      : sourceAcc.account_type === 'SAFE'
      ? 'CUSTODIAL_SAFE'
      : 'CUSTODIAL_CLERK';

  addExpense({
    amount: safeAmount,
    category: params.category,
    description: `[${sourceAcc.account_name}] ${params.description} (Paid to: ${params.payee})${params.receiptNumber ? ` Receipt #${params.receiptNumber}` : ''}`,
    date: todayStr,
    timestamp: nowIso,
    paymentMethod: paymentMethodLabel,
    staffId: custodialStaffId,
    staffName: sourceAcc.account_name,
    recordedBy: params.supervisor.name,
    status: 'approved',
    recordCashLog: false,
    company_id: currentCompany,
    branch_id: accBranch,
  });

  // 4. Forensics & Audit Log
  addAuditLog({
    action: 'CASH_TRANSFER_APPROVE',
    severity: 'INFO',
    staffId: params.supervisor.id,
    staffName: params.supervisor.name,
    staffRole: params.supervisor.role,
    details: `Major utility/operational expense paid from ${sourceAcc.account_name}: $${safeAmount.toFixed(2)} for ${params.category} (${params.description}) to ${params.payee}.`,
    referenceId: voucher.transfer_id,
    amount: safeAmount,
  });

  return {
    success: true,
    message: `Recorded $${safeAmount.toFixed(2)} expense for ${params.category} from ${sourceAcc.account_name}. Balance and P&L updated!`,
    voucher,
  };
};

export interface AccountLedgerEntry {
  id: string;
  transferId: string;
  timestamp: string;
  date: string;
  type: CashTransferType;
  description: string;
  reference: string;
  inAmount: number;
  outAmount: number;
  runningBalance: number;
  nativeCurrency?: string;
  nativeInAmount?: number;
  nativeOutAmount?: number;
  exchangeRate?: number;
  batchRef?: string;
  authorizedBy: string;
  initiatedBy: string;
  approvedBy?: string;
  receivedBy?: string;
  recipientOrSource: string;
  fromAccountName?: string;
  toAccountName?: string;
  branchId?: string;
  branchName?: string;
  linkedGrvId?: string;
  linkedGrvItems?: GrvLineItemDetail[];
  denominations?: Record<string, number>;
  bagSealNumber?: string;
  status: CashTransferStatus;
}

/**
 * Returns chronological ledger statement for any custody account (HQ Safe, Branch Safe, Clerk Float, EcoCash, ZiG, Bank)
 * with rich forensic details, custody chain, dual-currency native amounts, branch info, and linked GRV line items.
 */
export const getAccountTransactionLedger = (
  accountId: string,
  branchId?: string
): {
  account: CashAccount | null;
  entries: AccountLedgerEntry[];
  totalIn: number;
  totalOut: number;
  currentBalance: number;
  nativeCurrency?: string;
  totalNativeIn: number;
  totalNativeOut: number;
  currentNativeBalance: number;
} => {
  const accounts = getCashAccounts('ALL');
  const branches = getBranches();
  const account = accounts.find((a) => a.account_id === accountId) || null;
  const currentBal = account ? parseSafeCurrencyAmount(account.current_balance) : 0;
  const currentNativeBal = account?.native_currency ? parseSafeCurrencyAmount(account.native_balance || 0) : 0;

  // For global accounts (HQ Safe, Commercial Bank, EcoCash, ZiG), query ALL branches
  const isGlobalAccount = account?.account_type === 'HQ_SAFE' || account?.account_type === 'BANK_ACCOUNT';
  const allTransfers = getCashTransfers(isGlobalAccount ? 'ALL' : branchId);

  const isLegacyBankMatch = (t: CashTransfer): boolean => {
    if (!account || account.account_type !== 'BANK_ACCOUNT') return false;
    if (t.type !== 'BANK_DEPOSIT' && t.type !== 'BANK_WITHDRAWAL' && t.type !== 'ELECTRONIC_SETTLEMENT') return false;
    if (t.to_account_id || t.from_account_id === accountId) return false;
    if (!t.bank_name) return false;
    return account.account_name.toLowerCase().includes(t.bank_name.toLowerCase().slice(0, 4));
  };

  const matchesToThisAccount = (t: CashTransfer): boolean => {
    if (!account) return t.to_account_id === accountId;
    if (t.type === 'CAPITAL_INFUSION') {
      if (account.account_type === 'BANK_ACCOUNT') return false;
      return (
        t.to_account_id === accountId ||
        isTransferRefMatchingAccount(t.to_account_id, account, t.branch_id) ||
        (!t.to_account_id && isTransferRefMatchingAccount(t.from_account_id, account, t.branch_id))
      );
    }
    if (t.type === 'BANK_WITHDRAWAL') {
      if (account.account_type === 'BANK_ACCOUNT') return false;
      return (
        t.to_account_id === accountId ||
        isTransferRefMatchingAccount(t.to_account_id, account, t.branch_id) ||
        (!t.to_account_id && isTransferRefMatchingAccount(t.from_account_id, account, t.branch_id))
      );
    }
    if (t.to_account_id === accountId) return true;
    if (isTransferRefMatchingAccount(t.to_account_id, account, t.branch_id)) return true;
    return isLegacyBankMatch(t) && (t.type === 'BANK_DEPOSIT' || t.type === 'ELECTRONIC_SETTLEMENT');
  };

  const matchesFromThisAccount = (t: CashTransfer): boolean => {
    if (!account) return t.from_account_id === accountId;
    if (t.type === 'CAPITAL_INFUSION') return false;
    if (t.type === 'BANK_WITHDRAWAL') {
      if (account.account_type !== 'BANK_ACCOUNT') return false;
      return (
        t.from_account_id === accountId ||
        isTransferRefMatchingAccount(t.from_account_id, account, t.branch_id) ||
        isLegacyBankMatch(t)
      );
    }
    if (t.from_account_id === accountId) return true;
    if (isTransferRefMatchingAccount(t.from_account_id, account, t.branch_id)) return true;
    return false;
  };

  const relevantTransfers = allTransfers.filter((t) => {
    const settled = isSettledTransferStatus(t.status);
    const inTransit = t.status === 'IN_TRANSIT';
    if (!settled && !inTransit) return false;
    const isTo = settled && matchesToThisAccount(t);
    const isFrom = matchesFromThisAccount(t);
    if (isTo && isFrom) return false; // self-referencing no-op
    return isTo || isFrom;
  });

  // Sort ascending chronologically to compute running balance
  relevantTransfers.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let running = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalNativeIn = 0;
  let totalNativeOut = 0;

  const entriesAsc: AccountLedgerEntry[] = relevantTransfers.map((t) => {
    const isToThisAccount = isSettledTransferStatus(t.status) && matchesToThisAccount(t);
    const isFromThisAccount = matchesFromThisAccount(t);
    const txAmt = parseSafeCurrencyAmount(t.amount);
    const nativeCurrency = t.native_currency || account?.native_currency;
    const txNativeAmt =
      t.native_amount !== undefined
        ? parseSafeCurrencyAmount(t.native_amount)
        : nativeCurrency
        ? Math.round(txAmt * (t.exchange_rate || getCurrencyRate(nativeCurrency)) * 100) / 100
        : 0;

    let inAmt = 0;
    let outAmt = 0;
    let nativeIn = 0;
    let nativeOut = 0;

    if (isToThisAccount) {
      inAmt = txAmt;
      totalIn += inAmt;
      running += inAmt;
      if (nativeCurrency) {
        nativeIn = txNativeAmt;
        totalNativeIn += nativeIn;
      }
    } else if (isFromThisAccount) {
      outAmt = txAmt;
      totalOut += outAmt;
      running -= outAmt;
      if (nativeCurrency) {
        nativeOut = txNativeAmt;
        totalNativeOut += nativeOut;
      }
    }

    const fromAccObj = accounts.find((a) => a.account_id === t.from_account_id);
    const toAccObj = accounts.find((a) => a.account_id === t.to_account_id);
    const otherAcc = isToThisAccount ? fromAccObj : toAccObj;
    const otherLabel = otherAcc
      ? otherAcc.account_name
      : t.recipient_name || t.bank_name || 'External / Expense / Supplier';

    const branchMatch = branches.find((b) => b.id === t.branch_id || b.branchCode === t.branch_id);
    const branchLabel =
      t.branch_name ||
      branchMatch?.name ||
      (t.branch_id === 'HQ' ? 'HQ Central' : t.branch_id === 'BR-MAIN' || t.branch_id === '1' ? 'Main Branch' : t.branch_id);

    return {
      id: t.transfer_id,
      transferId: t.transfer_id,
      timestamp: t.created_at,
      date: toDateStringSafe(t.created_at) || new Date().toISOString().slice(0, 10),
      type: t.type,
      description: t.notes || `${t.type.replace(/_/g, ' ')} (${otherLabel})`,
      reference: t.batch_ref || t.receipt_image_url || t.linked_grv_id || t.transfer_id,
      inAmount: inAmt,
      outAmount: outAmt,
      runningBalance: Math.round(running * 100) / 100,
      nativeCurrency,
      nativeInAmount: nativeIn > 0 ? nativeIn : undefined,
      nativeOutAmount: nativeOut > 0 ? nativeOut : undefined,
      exchangeRate: t.exchange_rate,
      batchRef: t.batch_ref,
      authorizedBy: t.approved_by_user_name || t.created_by_user_name || 'System',
      initiatedBy: t.created_by_user_name || 'System',
      approvedBy: t.approved_by_user_name,
      receivedBy: t.received_by_user_name,
      recipientOrSource: otherLabel,
      fromAccountName: fromAccObj?.account_name || (t.from_account_id?.startsWith('POS-ELECTRONIC') ? 'Form 4 POS Electronic Settlement' : t.from_account_id),
      toAccountName: toAccObj?.account_name || t.bank_name || t.recipient_name,
      branchId: t.branch_id,
      branchName: branchLabel,
      linkedGrvId: t.linked_grv_id,
      linkedGrvItems: t.linked_grv_items,
      denominations: t.denominations,
      bagSealNumber: t.bag_seal_number,
      status: t.status,
    };
  });

  // Re-align last entry running balance with actual current balance if there was an initial opening balance
  if (entriesAsc.length > 0) {
    const diff = currentBal - running;
    if (Math.abs(diff) > 0.001) {
      entriesAsc.forEach((e) => {
        e.runningBalance = Math.round((e.runningBalance + diff) * 100) / 100;
      });
    }
  }

  const entriesDesc = [...entriesAsc].reverse();

  return {
    account,
    entries: entriesDesc,
    totalIn: Math.round(totalIn * 100) / 100,
    totalOut: Math.round(totalOut * 100) / 100,
    currentBalance: currentBal,
    nativeCurrency: account?.native_currency,
    totalNativeIn: Math.round(totalNativeIn * 100) / 100,
    totalNativeOut: Math.round(totalNativeOut * 100) / 100,
    currentNativeBalance: currentNativeBal,
  };
};
