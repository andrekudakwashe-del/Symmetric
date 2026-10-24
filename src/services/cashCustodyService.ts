import {
  CashAccount,
  CashAccountType,
  CashTransfer,
  CashTransferType,
  CashTransferStatus,
  Salesperson,
  GoodsReceivedEntry,
  CashGovernanceConfig,
} from '../types';
import {
  getCashAccounts,
  getAllCashAccounts,
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
  getAllDirectGrvs,
  saveDirectGrv,
  getAllSupplierInvoiceVouchers,
  saveSupplierInvoiceVoucher,
  getStored,
  setStored,
  STORAGE_KEYS,
  getCashGovernanceConfig,
  addExpense,
} from '../db/roomDatabase';
import {
  getAllGoodsReceivedNotes,
  saveAllGoodsReceivedNotes,
} from '../db/goodsReceivedNotes';
import { adjustWalletBalance } from './walletService';
import { addMovement, getMovements, getShiftId } from '../db/cashLedger';

// Standard default threshold for Owner PIN approval on supplier payments
export const DEFAULT_SUPPLIER_APPROVAL_THRESHOLD = 50.0;

export interface UnpaidGrvRecord {
  id: string;
  grvNumber: string;
  supplierId?: string;
  supplierName: string;
  invoiceNo?: string;
  date: string;
  totalCost: number;
  paymentMethod?: string;
  paymentStatus: 'AWAITING_SAFE_PAYMENT' | 'PAID' | 'UNPAID';
  allocatedSafeId?: string;
  allocatedSafeName?: string;
  receivedByStaffName?: string;
  itemsCount: number;
}

const isCashBranchMatch = (b1?: string, b2?: string): boolean => {
  if (!b1 || !b2) return true;
  if (b1 === b2) return true;
  if ((b1 === '1' || b1 === 'BR-MAIN') && (b2 === '1' || b2 === 'BR-MAIN')) return true;
  return false;
};

/**
 * Initializes default cash accounts for a company / branch if none exist yet.
 */
export const ensureDefaultCashAccounts = (companyId?: string, branchId?: string): CashAccount[] => {
  const currentCompany = companyId || getCurrentCompanyId();
  const currentBranch = branchId || getCurrentBranchId();
  const allExisting = getAllCashAccounts();

  // Deduplicate and group duplicate accounts with branch aliases (e.g. '1' vs 'BR-MAIN')
  const grouped = new Map<string, CashAccount[]>();
  for (const acc of allExisting) {
    const normBranch = (acc.branch_id === '1' || acc.branch_id === 'BR-MAIN' || !acc.branch_id) ? 'BR-MAIN' : acc.branch_id;
    const key = `${acc.account_type}_${acc.account_type === 'HQ_SAFE' || acc.account_type === 'BANK_ACCOUNT' ? 'GLOBAL' : normBranch}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(acc);
  }

  const canonicalAccounts: CashAccount[] = [];
  for (const [, group] of grouped.entries()) {
    if (group.length === 1) {
      canonicalAccounts.push(group[0]);
    } else {
      // Prioritize account with newest updated_at, and higher balance if updated at same time
      const sorted = [...group].sort((a, b) => {
        const timeA = new Date(a.updated_at || 0).getTime();
        const timeB = new Date(b.updated_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0);
      });
      canonicalAccounts.push(sorted[0]);
    }
  }

  // Cross-check transfer history to ensure any completed or in-transit transfers into or from Safe or Clerk Float are accurately reflected
  const allTransfers = getAllCashTransfers();

  canonicalAccounts.forEach((acc) => {
    if (acc.account_type === 'SAFE') {
      const sent = allTransfers
        .filter(
          (t) =>
            (t.type === 'BRANCH_TO_HQ' || t.from_account_id?.includes('SAFE')) &&
            (t.status === 'COMPLETED' || t.status === 'IN_TRANSIT')
        )
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      const received = allTransfers
        .filter(
          (t) =>
            (t.to_account_id?.includes('SAFE') || (t.type === 'TILL_COLLECTION' && !t.to_account_id?.includes('CLERK'))) &&
            t.status === 'COMPLETED'
        )
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      if (sent > 0 || received > 0) {
        // Base initial safe is 1500.0
        const computed = Math.max(0, Math.round((1500.0 - sent + received) * 100) / 100);
        // If account hasn't been set to a higher manual amount, sync it
        if (acc.current_balance === 1500.0 || acc.current_balance === 0 || acc.current_balance === null || acc.current_balance === undefined) {
          acc.current_balance = computed;
          acc.updated_at = new Date().toISOString();
        }
      }
    }

    if (acc.account_type === 'CLERK_FLOAT') {
      const sent = allTransfers
        .filter(
          (t) =>
            (t.from_account_id?.includes('CLERK') || t.from_account_id?.includes('FLOAT')) &&
            (t.status === 'COMPLETED' || t.status === 'IN_TRANSIT')
        )
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      const received = allTransfers
        .filter(
          (t) =>
            (t.to_account_id?.includes('CLERK') || (t.type === 'TILL_COLLECTION' && t.to_account_id?.includes('CLERK'))) &&
            t.status === 'COMPLETED'
        )
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      if (sent > 0 || received > 0) {
        // Base initial clerk float is 150.0
        const computed = Math.max(0, Math.round((150.0 - sent + received) * 100) / 100);
        // Ensure transfers received into or sent from Clerk Float are accurately preserved!
        acc.current_balance = computed;
        acc.updated_at = new Date().toISOString();
      }
    }
  });

  const defaults: Omit<CashAccount, 'created_at' | 'updated_at'>[] = [
    {
      account_id: `ACC-HQ-SAFE-${currentCompany.slice(0, 6)}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      account_type: 'HQ_SAFE',
      account_name: 'HQ Central Vault Safe',
      current_balance: 5000.0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-BR-SAFE-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'SAFE',
      account_name: 'Branch Safe',
      current_balance: 1500.0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-CLERK-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'CLERK_FLOAT',
      account_name: 'Accounts Clerk Petty Float',
      current_balance: 150.0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-TILL-1-${currentBranch}`,
      company_id: currentCompany,
      branch_id: currentBranch,
      account_type: 'TILL',
      account_name: 'Till 1 Register',
      current_balance: 100.0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-BANK-CBZ-${currentCompany.slice(0, 6)}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      account_type: 'BANK_ACCOUNT',
      account_name: 'CBZ Bank Corporate (USD)',
      current_balance: 12500.0,
      currency: 'USD',
      status: 'OPEN',
    },
    {
      account_id: `ACC-BANK-STANBIC-${currentCompany.slice(0, 6)}`,
      company_id: currentCompany,
      branch_id: 'HQ',
      account_type: 'BANK_ACCOUNT',
      account_name: 'Stanbic Bank Commercial (USD)',
      current_balance: 8400.0,
      currency: 'USD',
      status: 'OPEN',
    },
  ];

  let hasChanges = canonicalAccounts.length !== allExisting.length;

  defaults.forEach((def) => {
    const found = canonicalAccounts.find(
      (a) =>
        a.account_id === def.account_id ||
        (a.account_type === def.account_type &&
          (def.account_type === 'HQ_SAFE' ||
           def.account_type === 'BANK_ACCOUNT' ||
           isCashBranchMatch(a.branch_id, def.branch_id)))
    );
    if (!found) {
      canonicalAccounts.push({
        ...def,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      hasChanges = true;
    }
  });

  if (hasChanges || canonicalAccounts.length !== allExisting.length) {
    setAllCashAccounts(canonicalAccounts);
  }

  return getCashAccounts(currentBranch);
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
  const newHq: CashAccount = {
    account_id: `ACC-HQ-SAFE-${currentCompany.slice(0, 6)}`,
    company_id: currentCompany,
    branch_id: 'HQ',
    account_type: 'HQ_SAFE',
    account_name: 'HQ Central Vault Safe',
    current_balance: 0,
    currency: 'USD',
    status: 'OPEN',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return saveCashAccount(newHq);
};

export const getBranchSafeAccount = (branchId?: string): CashAccount => {
  const targetBranch = branchId || getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const accounts = getCashAccounts();
  const safe = accounts.find((a) => a.account_type === 'SAFE' && isCashBranchMatch(a.branch_id, targetBranch));
  if (safe) return safe;

  const newSafe: CashAccount = {
    account_id: `ACC-BR-SAFE-${targetBranch}`,
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
  const accounts = getCashAccounts();
  const clerk = accounts.find((a) => a.account_type === 'CLERK_FLOAT' && isCashBranchMatch(a.branch_id, targetBranch));
  if (clerk) return clerk;

  const newClerk: CashAccount = {
    account_id: `ACC-CLERK-${targetBranch}`,
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
  recipient_name?: string;
  receipt_image_url?: string;
  bag_seal_number?: string;
  notes?: string;
  witness_user_id?: string;
  is_owner_break_glass?: boolean;
  bank_name?: string;
  bank_account_number?: string;
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
  const accounts = getCashAccounts();
  const fromAcc = findAccountWithFallback(accounts, transfer.from_account_id, transfer.branch_id);
  if (fromAcc) {
    const updatedFrom: CashAccount = {
      ...fromAcc,
      current_balance: Math.max(0, Math.round(((fromAcc.current_balance || 0) - transfer.amount) * 100) / 100),
      updated_at: new Date().toISOString(),
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

  const logOut = addCashLog({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().split(' ')[0],
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
    out: transfer.amount,
    currency: 'USD',
    company_id: transfer.company_id,
    branch_id: transfer.branch_id,
  });

  transfer.linked_cash_log_ids = [logOut.id];
  saveCashTransfer(transfer);
}

/**
 * Creates a new Cash Transfer Voucher
 */
export const createCashTransferVoucher = (payload: CreateTransferPayload): CashTransfer => {
  const companyId = getCurrentCompanyId();
  const branchId = getCurrentBranchId();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const transferId = `TRF-${dateStr}-${Date.now().toString().slice(-4)}`;

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
    // Float is strictly PENDING_ACCEPTANCE: requires Till Operator or Accounts Clerk confirmation before funds activate
    status = 'PENDING_ACCEPTANCE';
  } else if (payload.type === 'SUPPLIER_PAYMENT') {
    const threshold = govConfig.defaultSupplierApprovalThreshold || DEFAULT_SUPPLIER_APPROVAL_THRESHOLD;
    if (payload.amount > threshold) {
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
      amount: payload.amount,
      metadata: { transferType: payload.type, amount: payload.amount, governanceMode: govConfig.governanceMode },
    });
  } else {
    addAuditLog({
      action: 'CASH_TRANSFER_CREATE',
      severity: 'INFO',
      staffId: payload.initiator.id,
      staffName: payload.initiator.name,
      staffRole: payload.initiator.role,
      details: `Created Cash Transfer ${transferId} (${payload.type}) for $${payload.amount.toFixed(2)}${payload.bank_name ? ` [${payload.bank_name}]` : ''}`,
      referenceId: transferId,
      amount: payload.amount,
      metadata: { transferType: payload.type, amount: payload.amount, status },
    });
  }

  const transfer: CashTransfer = {
    transfer_id: transferId,
    company_id: companyId,
    branch_id: branchId,
    type: payload.type,
    from_account_id: payload.from_account_id,
    to_account_id: payload.to_account_id,
    amount: Number(payload.amount),
    currency: 'USD',
    status,
    created_by_user_id: payload.initiator.id,
    created_by_user_name: payload.initiator.name,
    created_at: now.toISOString(),
    linked_grv_id: payload.linked_grv_id,
    recipient_name: payload.recipient_name,
    receipt_image_url: payload.receipt_image_url,
    bag_seal_number: payload.bag_seal_number,
    notes: payload.notes,
    bank_name: payload.bank_name,
    bank_account_number: payload.bank_account_number,
    is_owner_override: isOwnerOverride,
    owner_override_reason: isOwnerOverride ? 'Owner Break-Glass / Lean Policy Action' : undefined,
    approved_by_user_id: (isOwner || isLean) ? payload.initiator.id : undefined,
    approved_by_user_name: (isOwner || isLean) ? payload.initiator.name : undefined,
    approved_at: (isOwner || isLean) ? now.toISOString() : undefined,
  };

  const saved = saveCashTransfer(transfer);

  // If dispatched immediately into transit, deduct source account now so safe does not overstate physical cash
  if (status === 'IN_TRANSIT') {
    deductSourceAccountForTransit(saved, payload.initiator);
  } else if (status === 'COMPLETED') {
    finalizeTransferLedger(saved, payload.initiator, false);
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

  // Refund source account
  const accounts = getCashAccounts();
  const fromAcc = accounts.find((a) => a.account_id === transfer.from_account_id);
  if (fromAcc) {
    const refunded: CashAccount = {
      ...fromAcc,
      current_balance: Math.round(((fromAcc.current_balance || 0) + transfer.amount) * 100) / 100,
      updated_at: new Date().toISOString(),
    };
    saveCashAccount(refunded);
  }

  const now = new Date().toISOString();
  const updated: CashTransfer = {
    ...transfer,
    status: 'RETURNED',
    returned_reason: reason || 'Trip aborted; returned undelivered cash to safe',
    returned_at: now,
    returned_by_user_id: staff.id,
    returned_by_user_name: staff.name,
    notes: `${transfer.notes ? transfer.notes + ' | ' : ''}Returned to safe: ${reason || 'Supplier premises closed'}`,
  };
  saveCashTransfer(updated);

  addAuditLog({
    action: 'CASH_TRANSFER_RETURN' as any,
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `Undelivered cash of $${transfer.amount.toFixed(2)} returned to ${fromAcc?.account_name || 'Safe'}. Reason: ${reason}`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
  });

  addCashLog({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().split(' ')[0],
    staff_id: staff.id,
    staffId: staff.id,
    staff_name: staff.name,
    staffName: staff.name,
    type: 'Transfer',
    description: `Transit RETURNED into Safe: $${transfer.amount.toFixed(2)} (Ref: ${transfer.transfer_id}). Reason: ${reason}`,
    in: transfer.amount,
    out: 0,
    currency: 'USD',
    company_id: transfer.company_id,
    branch_id: transfer.branch_id,
  });

  return {
    success: true,
    message: `Successfully returned $${transfer.amount.toFixed(2)} to ${fromAcc?.account_name || 'Safe'}.`,
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

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && approver.pin && approver.pin !== enteredPin) {
    return { success: false, message: 'Invalid PIN entered.' };
  }

  const now = new Date().toISOString();
  let nextStatus: CashTransferStatus = 'COMPLETED';

  if (transfer.type === 'BRANCH_TO_HQ') {
    nextStatus = 'IN_TRANSIT';
  }

  const updated: CashTransfer = {
    ...transfer,
    status: nextStatus,
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
    details: `Approved Cash Transfer ${transfer.transfer_id} (${transfer.type}) for $${transfer.amount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
  });

  if (nextStatus === 'COMPLETED') {
    finalizeTransferLedger(updated, approver, false);
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

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && cashier.pin && cashier.pin !== enteredPin) {
    return { success: false, message: 'Incorrect Cashier PIN. Physical custody rejected.' };
  }

  const now = new Date().toISOString();
  const updated: CashTransfer = {
    ...transfer,
    status: 'COMPLETED',
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
    details: `Cashier ${cashier.name} accepted Till Float ${transfer.transfer_id} for $${transfer.amount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
  });

  finalizeTransferLedger(updated, cashier, false);

  return { success: true, message: `Till Float of $${transfer.amount.toFixed(2)} accepted into register.`, transfer: updated };
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

  const updated: CashTransfer = {
    ...transfer,
    status: 'CANCELLED',
    notes: `${transfer.notes ? `${transfer.notes}. ` : ''}Rejected by Cashier ${cashier.name}${reason ? `: ${reason}` : ''}`,
  };

  saveCashTransfer(updated);

  addAuditLog({
    action: 'TILL_FLOAT_REJECT',
    severity: 'WARNING',
    staffId: cashier.id,
    staffName: cashier.name,
    staffRole: cashier.role,
    details: `Cashier ${cashier.name} rejected Till Float ${transfer.transfer_id} ($${transfer.amount.toFixed(2)})`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
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
}): { success: boolean; message: string; voucher: CashTransfer } => {
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
    amount: params.amount,
    initiator: params.supervisor,
    recipient_name: params.cashierName,
    notes:
      params.notes ||
      `Till Float issued to ${params.cashierName} for shift on ${params.shiftDate}`,
  });

  return {
    success: true,
    message: `Float of $${params.amount.toFixed(2)} issued to ${params.cashierName}.`,
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

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && owner.pin && owner.pin !== enteredPin) {
    return { success: false, message: 'Invalid Owner PIN.' };
  }

  const now = new Date().toISOString();
  const updated: CashTransfer = {
    ...transfer,
    status: 'COMPLETED',
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
    details: `Owner received Branch transfer ${transfer.transfer_id} into HQ Safe for $${transfer.amount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
  });

  // Source account was already deducted when dispatched to transit
  finalizeTransferLedger(updated, owner, true);

  return { success: true, message: `Cash of $${transfer.amount.toFixed(2)} deposited into HQ Safe.`, transfer: updated };
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

  const govConfig = getCashGovernanceConfig();
  if (govConfig.governanceMode !== 'LEAN' && receiver.pin && receiver.pin !== enteredPin) {
    return { success: false, message: 'Invalid Receiver PIN.' };
  }

  const now = new Date().toISOString();
  const updated: CashTransfer = {
    ...transfer,
    status: 'COMPLETED',
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
    details: `Received HQ transfer ${transfer.transfer_id} into Branch Safe for $${transfer.amount.toFixed(2)}`,
    referenceId: transfer.transfer_id,
    amount: transfer.amount,
  });

  // Source account was already deducted when dispatched from HQ
  finalizeTransferLedger(updated, receiver, true);

  return { success: true, message: `Funds of $${transfer.amount.toFixed(2)} received into Branch Safe.`, transfer: updated };
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

  const wasInTransit = transfer.status === 'IN_TRANSIT';

  const updated: CashTransfer = {
    ...transfer,
    status: 'COMPLETED',
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
function finalizeTransferLedger(transfer: CashTransfer, actor?: Salesperson, wasInTransit = false) {
  const accounts = getCashAccounts();
  const fromAcc = findAccountWithFallback(accounts, transfer.from_account_id, transfer.branch_id);
  const toAcc = findAccountWithFallback(accounts, transfer.to_account_id, transfer.branch_id);

  // 1. Update source account balance ONLY if not already deducted at transit dispatch
  // (and if not a bank withdrawal or capital infusion where source is external)
  if (fromAcc && !wasInTransit && transfer.type !== 'BANK_WITHDRAWAL' && transfer.type !== 'CAPITAL_INFUSION') {
    const updatedFrom: CashAccount = {
      ...fromAcc,
      current_balance: Math.max(0, Math.round(((fromAcc.current_balance || 0) - transfer.amount) * 100) / 100),
      updated_at: new Date().toISOString(),
    };
    saveCashAccount(updatedFrom);
  }

  // 2. Update destination account balance if internal account
  const destinationTarget = toAcc || (transfer.type === 'CAPITAL_INFUSION' || transfer.type === 'BANK_WITHDRAWAL' ? fromAcc : undefined);
  if (destinationTarget) {
    const updatedTo: CashAccount = {
      ...destinationTarget,
      current_balance: Math.round(((destinationTarget.current_balance || 0) + transfer.amount) * 100) / 100,
      updated_at: new Date().toISOString(),
    };
    saveCashAccount(updatedTo);
  }

  // 2b. Update Commercial Bank Account balances for Bank Deposits & Withdrawals
  if (transfer.type === 'BANK_DEPOSIT') {
    const bankTarget =
      accounts.find(
        (a) =>
          a.account_type === 'BANK_ACCOUNT' &&
          transfer.bank_name &&
          a.account_name.toLowerCase().includes(transfer.bank_name.slice(0, 3).toLowerCase())
      ) || accounts.find((a) => a.account_type === 'BANK_ACCOUNT');

    if (bankTarget) {
      const updatedBank: CashAccount = {
        ...bankTarget,
        current_balance: Math.round(((bankTarget.current_balance || 0) + transfer.amount) * 100) / 100,
        updated_at: new Date().toISOString(),
      };
      saveCashAccount(updatedBank);
    }
    try {
      adjustWalletBalance('wallet_bank_usd', transfer.amount);
    } catch (_) {}
  } else if (transfer.type === 'BANK_WITHDRAWAL') {
    const bankTarget =
      accounts.find(
        (a) =>
          a.account_type === 'BANK_ACCOUNT' &&
          transfer.bank_name &&
          a.account_name.toLowerCase().includes(transfer.bank_name.slice(0, 3).toLowerCase())
      ) || accounts.find((a) => a.account_type === 'BANK_ACCOUNT');

    if (bankTarget) {
      const updatedBank: CashAccount = {
        ...bankTarget,
        current_balance: Math.max(0, Math.round(((bankTarget.current_balance || 0) - transfer.amount) * 100) / 100),
        updated_at: new Date().toISOString(),
      };
      saveCashAccount(updatedBank);
    }
    try {
      adjustWalletBalance('wallet_bank_usd', -transfer.amount);
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

  // Entry A: OUT from source (if not already logged during transit dispatch)
  if (!wasInTransit && transfer.type !== 'BANK_WITHDRAWAL' && transfer.type !== 'CAPITAL_INFUSION') {
    const isOutVault = isVaultTransfer || transfer.type === 'FLOAT_ISSUE' || transfer.type === 'TILL_COLLECTION';
    const outStaffId = isOutVault ? 'VAULT_CUSTODY' : (actor?.id || transfer.created_by_user_id);
    const outStaffName = isOutVault ? 'Vault Custody' : (actor?.name || transfer.created_by_user_name);

    const logOut = addCashLog({
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0],
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
      out: transfer.amount,
      currency: 'USD',
      company_id: transfer.company_id,
      branch_id: transfer.branch_id,
    });
    linkedCashLogIds.push(logOut.id);
  }

  // Entry B: IN to destination (Safe, Till, HQ)
  if (destinationTarget) {
    const isInVault = isVaultTransfer || transfer.type === 'TILL_COLLECTION';
    const inStaffId = isInVault ? 'VAULT_CUSTODY' : (actor?.id || transfer.received_by_user_id || transfer.created_by_user_id);
    const inStaffName = isInVault ? 'Vault Custody' : (actor?.name || transfer.received_by_user_name || transfer.created_by_user_name);

    const logIn = addCashLog({
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0],
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
      in: transfer.amount,
      out: 0,
      currency: 'USD',
      company_id: transfer.company_id,
      branch_id: transfer.branch_id,
    });
    linkedCashLogIds.push(logIn.id);
  }

  // Update transfer record with linked CashLog IDs
  transfer.linked_cash_log_ids = linkedCashLogIds;
  saveCashTransfer(transfer);

  // 4. If this is a completed FLOAT_ISSUE, record CashMovement for Cashier till so Form 2 & liveDrawerBalance reflect it immediately!
  if (transfer.type === 'FLOAT_ISSUE' && transfer.status === 'COMPLETED') {
    try {
      const recipientName = transfer.recipient_name;
      const allStaff = getAllSalespeople();
      const targetStaff =
        allStaff.find((s) => s.id === transfer.received_by_user_id) ||
        allStaff.find((s) => s.name?.toLowerCase() === recipientName?.toLowerCase()) ||
        allStaff.find((s) => s.id === transfer.created_by_user_id);

      if (targetStaff) {
        const todayStr = new Date().toISOString().split('T')[0];
        const sId = getShiftId(targetStaff.id, todayStr);
        const moves = getMovements();
        const hasInitialFloat = moves.some(
          (m) =>
            (m.shiftId === sId || (m.staffId === targetStaff.id && m.date === todayStr)) &&
            m.type === 'opening_float'
        );

        addMovement({
          shiftId: sId,
          staffId: targetStaff.id,
          date: todayStr,
          timestamp: new Date().toISOString(),
          type: hasInitialFloat ? 'float_adjustment' : 'opening_float',
          amount: transfer.amount,
          currency: 'USD',
          direction: 'in',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          sourceRef: transfer.transfer_id,
          notes: `Till Float ${hasInitialFloat ? 'Additional Float / Adjustment' : 'Shift Opening Float'} from ${fromAcc?.account_name || 'Custody'} (Voucher: ${transfer.transfer_id})`,
          approvedBy: actor?.id || transfer.created_by_user_id,
          approvedByName: actor?.name || transfer.created_by_user_name,
          approvedAt: new Date().toISOString(),
          company_id: transfer.company_id,
          branch_id: transfer.branch_id,
        });
      }
    } catch (_) {}
  }

  // If this was paying a supplier with a linked GRV, mark the GRV paid!
  if (transfer.linked_grv_id) {
    markGrvAsPaid(transfer.linked_grv_id, transfer.transfer_id);
  }
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

  const availableSurplus = Math.max(0, Math.round(((clerkAcc.current_balance || 0) - retainedPettyFloat) * 100) / 100);
  const transferAmount = params.amount !== undefined ? Number(params.amount) : availableSurplus;

  if (transferAmount <= 0) {
    return {
      success: false,
      message: `Clerk Float ($${(clerkAcc.current_balance || 0).toFixed(2)}) has no surplus above retained petty float ($${retainedPettyFloat.toFixed(2)}) to consolidate.`,
    };
  }

  if (transferAmount > (clerkAcc.current_balance || 0)) {
    return {
      success: false,
      message: `Insufficient funds in Clerk Float ($${(clerkAcc.current_balance || 0).toFixed(2)}) to transfer $${transferAmount.toFixed(2)}.`,
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
 * Marks a GRV voucher as settled and paid from Safe across all underlying stores
 */
export const markGrvAsPaid = (grvNumber: string, voucherId: string): void => {
  if (!grvNumber) return;
  const normTarget = grvNumber.trim().toLowerCase();
  const now = new Date().toISOString();

  // 1. Supplier Invoice Vouchers (WPS Excel-style Goods Received Vouchers, e.g. Palliam)
  try {
    const allVouchers = getAllSupplierInvoiceVouchers();
    let updatedVouchers = false;
    allVouchers.forEach((v) => {
      const vId = (v.voucherId || '').trim().toLowerCase();
      const vInv = (v.invoiceNo || '').trim().toLowerCase();
      if (
        vId === normTarget ||
        vInv === normTarget ||
        (vId && (normTarget.includes(vId) || vId.includes(normTarget))) ||
        (vInv && (normTarget.includes(vInv) || vInv.includes(normTarget)))
      ) {
        v.paymentStatus = 'PAID';
        v.paidVoucherId = voucherId;
        v.paidAt = now;
        updatedVouchers = true;
      }
    });
    if (updatedVouchers) {
      setStored(STORAGE_KEYS.SUPPLIER_INVOICES, allVouchers);
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in SupplierInvoices:', err);
  }

  // 2. Direct GRVs
  try {
    const all = getAllDirectGrvs();
    let updated = false;
    all.forEach((g) => {
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
        g.paymentStatus = 'PAID';
        g.paidVoucherId = voucherId;
        updated = true;
      }
    });
    if (updated) {
      setStored(STORAGE_KEYS.DIRECT_GRVS, all);
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in DirectGrvs:', err);
  }

  // 3. Unified Goods Received Notes
  try {
    const allGrns = getAllGoodsReceivedNotes();
    let updatedGrns = false;
    allGrns.forEach((g) => {
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
        (g as any).paymentStatus = 'PAID';
        (g as any).paidVoucherId = voucherId;
        g.updatedAt = now;
        updatedGrns = true;
      }
    });
    if (updatedGrns) {
      saveAllGoodsReceivedNotes(allGrns);
    }
  } catch (err) {
    console.warn('[CashCustody] markGrvAsPaid error in GoodsReceivedNotes:', err);
  }

  // 4. Legacy Goods Received Entries
  try {
    const grns = getStored<any[]>(STORAGE_KEYS.GOODS_RECEIVED, []);
    let updatedLegacy = false;
    const mapped = grns.map((g) => {
      const num = (g.grnNumber || g.invoiceNo || g.grnId || g.id || '').trim().toLowerCase();
      if (num === normTarget || (num && (normTarget.includes(num) || num.includes(normTarget)))) {
        updatedLegacy = true;
        return { ...g, paymentStatus: 'PAID', paidVoucherId: voucherId };
      }
      return g;
    });
    if (updatedLegacy) {
      setStored(STORAGE_KEYS.GOODS_RECEIVED, mapped);
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
  const transfers = getCashTransfers();
  const paidGrvNumbers = new Set<string>();

  // Collect all paid / settled GRVs from completed or in-transit transfers
  transfers.forEach((t) => {
    if (t.linked_grv_id && (t.status === 'COMPLETED' || t.status === 'IN_TRANSIT')) {
      paidGrvNumbers.add(t.linked_grv_id.toLowerCase().trim());
    }
  });

  const list: UnpaidGrvRecord[] = [];
  const seenKeys = new Set<string>();

  const isAlreadyPaidOrSeen = (
    id?: string,
    grvNum?: string,
    invoiceNo?: string,
    explicitStatus?: string
  ): boolean => {
    if (explicitStatus === 'PAID') return true;
    const normId = (id || '').toLowerCase().trim();
    const normNum = (grvNum || '').toLowerCase().trim();
    const normInv = (invoiceNo || '').toLowerCase().trim();

    if (normId && (paidGrvNumbers.has(normId) || seenKeys.has(normId))) return true;
    if (normNum && (paidGrvNumbers.has(normNum) || seenKeys.has(normNum))) return true;
    if (normInv && (paidGrvNumbers.has(normInv) || seenKeys.has(normInv))) return true;

    // Check if any paid reference matches or contains the identifier
    for (const p of paidGrvNumbers) {
      if (normNum && (p === normNum || p.includes(normNum) || normNum.includes(p))) return true;
      if (normInv && (p === normInv || p.includes(normInv) || normInv.includes(p))) return true;
      if (normId && (p === normId || p.includes(normId) || normId.includes(p))) return true;
    }

    return false;
  };

  const registerSeen = (id?: string, grvNum?: string, invoiceNo?: string) => {
    if (id) seenKeys.add(id.toLowerCase().trim());
    if (grvNum) seenKeys.add(grvNum.toLowerCase().trim());
    if (invoiceNo) seenKeys.add(invoiceNo.toLowerCase().trim());
  };

  // 1. Scan Supplier Invoice Vouchers (WPS Excel-style multi-product receiving, e.g. Palliam)
  try {
    const vouchers = getAllSupplierInvoiceVouchers();
    vouchers.forEach((v) => {
      const vId = v.voucherId || v.invoiceNo;
      const vNum = v.voucherId || v.invoiceNo;
      const vInv = v.invoiceNo;
      const explicitPaid = v.paymentStatus === 'PAID' || Boolean(v.paidVoucherId);

      if (isAlreadyPaidOrSeen(vId, vNum, vInv, explicitPaid ? 'PAID' : undefined)) return;

      const cost = Number(v.totalInvoiceAmount) || 0;
      if (cost <= 0) return;

      registerSeen(vId, vNum, vInv);

      const safeName = v.allocatedSafeName || (v.allocatedSafeId?.includes('HQ') ? 'HQ Central Vault Safe' : 'Branch Safe (Main Vault)');

      list.push({
        id: vId,
        grvNumber: vNum,
        supplierId: v.supplierId || v.supplier,
        supplierName: v.supplier || 'Supplier Delivery',
        invoiceNo: vInv,
        date: v.date || (v.timestamp ? v.timestamp.slice(0, 10) : ''),
        totalCost: cost,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: (v.paymentStatus as any) || 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: v.allocatedSafeId,
        allocatedSafeName: safeName,
        receivedByStaffName: v.staffName || v.staffId || 'Admin',
        itemsCount: Array.isArray(v.items) ? v.items.length : 1,
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning SupplierInvoiceVouchers:', err);
  }

  // 2. Scan Direct GRVs (Form 2 / Direct deliveries)
  try {
    const directGrvs = getAllDirectGrvs();
    directGrvs.forEach((g) => {
      if (g.status === 'REJECTED') return;
      const gNumber = g.grvNumber || g.id;
      const explicitPaid = g.paymentStatus === 'PAID' || Boolean(g.paidVoucherId);

      if (isAlreadyPaidOrSeen(g.id, gNumber, g.invoiceNo, explicitPaid ? 'PAID' : undefined)) return;

      const cost = Number(g.totalCost) || 0;
      if (cost <= 0) return;

      registerSeen(g.id, gNumber, g.invoiceNo);

      const safeName = g.allocatedSafeName || (g.allocatedSafeId?.includes('HQ') ? 'HQ Central Vault Safe' : 'Branch Safe (Main Vault)');

      list.push({
        id: g.id || gNumber,
        grvNumber: gNumber,
        supplierId: g.supplierId,
        supplierName: g.supplierName || 'General Supplier',
        invoiceNo: g.invoiceNo,
        date: g.date || (g.createdAt ? g.createdAt.slice(0, 10) : ''),
        totalCost: cost,
        paymentMethod: g.paymentMethod || (g.payFromTill ? 'TILL' : 'SAFE_PAYOUT'),
        paymentStatus: (g.paymentStatus as any) || (g.paymentMethod === 'SAFE_PAYOUT' ? 'AWAITING_SAFE_PAYMENT' : 'UNPAID'),
        allocatedSafeId: g.allocatedSafeId,
        allocatedSafeName: safeName,
        receivedByStaffName: g.receivedByStaffName,
        itemsCount: Array.isArray(g.items) ? g.items.length : 0,
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning DirectGrvs:', err);
  }

  // 3. Scan Unified Goods Received Notes (goodsReceivedNotes store)
  try {
    const grnNotes = getAllGoodsReceivedNotes();
    grnNotes.forEach((entry) => {
      if (entry.status === 'REJECTED') return;
      const gNum = entry.grnNumber || entry.id;
      const gInv = (entry as any).invoiceNo || (entry.payableId && entry.payableId !== entry.id ? entry.payableId : undefined);
      const explicitPaid = (entry as any).paymentStatus === 'PAID' || entry.status === 'PAID' || Boolean((entry as any).paidVoucherId);

      if (isAlreadyPaidOrSeen(entry.id, gNum, gInv, explicitPaid ? 'PAID' : undefined)) return;

      const cost = Number(entry.totals?.totalInventoryValue || entry.totals?.subtotal) || 0;
      if (cost <= 0) return;

      registerSeen(entry.id, gNum, gInv);

      list.push({
        id: entry.id || gNum,
        grvNumber: gNum,
        supplierName: entry.suppliers?.[0] || 'Goods Received Supplier',
        invoiceNo: gInv,
        date: entry.dateReceived || '',
        totalCost: cost,
        paymentMethod: entry.paymentMode === 'cash_immediate' ? 'TILL' : 'SAFE_PAYOUT',
        paymentStatus: 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: undefined,
        allocatedSafeName: 'Branch Safe (Main Vault)',
        receivedByStaffName: entry.receivedBy,
        itemsCount: entry.lineItems?.length || 1,
      });
    });
  } catch (err) {
    console.warn('[CashCustody] Error scanning GoodsReceivedNotes:', err);
  }

  // 4. Scan Tab 2 Legacy Goods Received Notes
  try {
    const grns = getStored<GoodsReceivedEntry[]>(STORAGE_KEYS.GOODS_RECEIVED, []);
    const grnGroups = new Map<string, { entry: GoodsReceivedEntry; totalCost: number; itemsCount: number }>();

    grns.forEach((entry) => {
      const num = entry.grnId || entry.grnNumber || entry.invoiceNo || (entry as any).id;
      if (!num) return;
      const cost = Number(entry.totalCost) || Number(entry.lineTotal) || (Number(entry.deliveredCases || entry.receivedCases || 0) * Number(entry.costPerCase || 0)) || 0;

      if (!grnGroups.has(num)) {
        grnGroups.set(num, { entry, totalCost: cost, itemsCount: 1 });
      } else {
        const grp = grnGroups.get(num)!;
        grp.totalCost += cost;
        grp.itemsCount += 1;
      }
    });

    grnGroups.forEach((group, num) => {
      const entry = group.entry;
      const explicitPaid = (entry as any).paymentStatus === 'PAID' || Boolean((entry as any).paidVoucherId);
      if (isAlreadyPaidOrSeen(entry.grnId || (entry as any).id, num, entry.invoiceNo, explicitPaid ? 'PAID' : undefined)) return;

      if (group.totalCost <= 0) return;

      registerSeen(entry.grnId || (entry as any).id, num, entry.invoiceNo);

      list.push({
        id: entry.grnId || (entry as any).id || num,
        grvNumber: num,
        supplierName: entry.supplier || 'Goods Received Supplier',
        invoiceNo: entry.invoiceNo,
        date: entry.dateReceived || entry.date || '',
        totalCost: group.totalCost,
        paymentMethod: 'SAFE_PAYOUT',
        paymentStatus: 'AWAITING_SAFE_PAYMENT',
        allocatedSafeId: undefined,
        allocatedSafeName: 'Branch Safe (Main Vault)',
        receivedByStaffName: entry.receivedBy || (entry as any).staffName,
        itemsCount: group.itemsCount,
      });
    });
  } catch (_) {}

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

/**
 * Helper to compute custody balances breakdown
 */
export const getCustodyBalancesSummary = (branchId?: string) => {
  const accounts = getCashAccounts();
  const transfers = getCashTransfers(branchId);
  const targetBranch = branchId || getCurrentBranchId();

  let totalHqSafe = 0;
  let totalBranchSafes = 0;
  let totalClerkFloats = 0;
  let totalTills = 0;
  let totalBankBalances = 0;
  const bankBreakdown: { name: string; balance: number; accountId: string }[] = [];

  accounts.forEach((acc) => {
    const bal = Number(acc.current_balance) || 0;
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
      });
    }
  });

  // Calculate Cash In Transit from uncompleted transfers
  const totalCashInTransit = transfers
    .filter((t) => t.status === 'IN_TRANSIT')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  return {
    totalHqSafe,
    totalBranchSafes,
    totalClerkFloats,
    totalTills,
    totalCashInTransit,
    totalBankBalances,
    bankBreakdown,
    physicalCashTotal: totalHqSafe + totalBranchSafes + totalClerkFloats + totalTills + totalCashInTransit,
    grandTotal: totalHqSafe + totalBranchSafes + totalClerkFloats + totalTills + totalCashInTransit + totalBankBalances,
  };
};

/**
 * Returns all configured commercial bank accounts
 */
export const getBankAccounts = (companyId?: string): CashAccount[] => {
  const accounts = getCashAccounts();
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
 * Debits the account, logs a dual-custody completed CashTransfer voucher, and persists an ExpenseEntry
 * for IncomeStatement / Profit and Loss without polluting cashier till Form 2 logs.
 */
export const recordCustodialExpense = (
  params: RecordCustodialExpenseParams
): { success: boolean; message: string; voucher?: CashTransfer } => {
  const currentBranch = getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const accounts = getCashAccounts();
  const sourceAcc = accounts.find((a) => a.account_id === params.fromAccountId);

  if (!sourceAcc) {
    return { success: false, message: 'Source cash account not found.' };
  }

  const currentBal = Number(sourceAcc.current_balance) || 0;
  if (currentBal < params.amount) {
    return {
      success: false,
      message: `Insufficient balance in ${sourceAcc.account_name} ($${currentBal.toFixed(2)}) to pay expense of $${params.amount.toFixed(2)}.`,
    };
  }

  const todayStr = params.date || new Date().toISOString().split('T')[0];
  const nowIso = new Date().toISOString();

  // 1. Deduct custodial account balance
  const updatedAcc: CashAccount = {
    ...sourceAcc,
    current_balance: Math.round((currentBal - params.amount) * 100) / 100,
    updated_at: nowIso,
  };
  saveCashAccount(updatedAcc);

  // 2. Create and complete CashTransfer voucher
  const voucherId = `TRF-${todayStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const voucher: CashTransfer = {
    transfer_id: voucherId,
    company_id: currentCompany,
    branch_id: sourceAcc.branch_id || currentBranch,
    type: 'THIRD_PARTY_PAYOUT',
    from_account_id: sourceAcc.account_id,
    to_account_id: undefined,
    amount: params.amount,
    currency: 'USD',
    status: 'COMPLETED',
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

  // 3. Persist ExpenseEntry into roomDatabase so IncomeStatement includes it in Profit & Loss
  const paymentMethodLabel = sourceAcc.account_type === 'SAFE' ? 'Safe Vault Cash' : 'Clerk Float Cash';
  const custodialStaffId = sourceAcc.account_type === 'SAFE' ? 'CUSTODIAL_SAFE' : 'CUSTODIAL_CLERK';

  addExpense({
    amount: params.amount,
    category: params.category,
    description: `[${sourceAcc.account_name}] ${params.description} (Paid to: ${params.payee})${params.receiptNumber ? ` Receipt #${params.receiptNumber}` : ''}`,
    date: todayStr,
    timestamp: nowIso,
    paymentMethod: paymentMethodLabel,
    staffId: custodialStaffId,
    staffName: sourceAcc.account_name,
    recordedBy: params.supervisor.name,
    status: 'approved',
    recordCashLog: false, // Don't duplicate in standard till cash log
    company_id: currentCompany,
    branch_id: sourceAcc.branch_id || currentBranch,
  });

  // 4. Forensics & Audit Log
  addAuditLog({
    action: 'CASH_TRANSFER_APPROVE',
    severity: 'INFO',
    staffId: params.supervisor.id,
    staffName: params.supervisor.name,
    staffRole: params.supervisor.role,
    details: `Major utility/operational expense paid from ${sourceAcc.account_name}: $${params.amount.toFixed(2)} for ${params.category} (${params.description}) to ${params.payee}.`,
    referenceId: voucher.transfer_id,
    amount: params.amount,
  });

  return {
    success: true,
    message: `Recorded $${params.amount.toFixed(2)} expense for ${params.category} from ${sourceAcc.account_name}. Balance and P&L updated!`,
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
  authorizedBy: string;
  recipientOrSource: string;
  status: CashTransferStatus;
}

/**
 * Returns chronological ledger statement for an account (Safe, Clerk Float, Bank, etc.)
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
} => {
  const accounts = getCashAccounts();
  const account = accounts.find((a) => a.account_id === accountId) || null;
  const currentBal = account ? Number(account.current_balance) || 0 : 0;

  const allTransfers = getCashTransfers(branchId);
  const relevantTransfers = allTransfers.filter(
    (t) =>
      (t.status === 'COMPLETED' || t.status === 'IN_TRANSIT') &&
      (t.from_account_id === accountId || t.to_account_id === accountId)
  );

  // Sort ascending chronologically to compute running balance
  relevantTransfers.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let running = 0;
  let totalIn = 0;
  let totalOut = 0;

  const entriesAsc: AccountLedgerEntry[] = relevantTransfers.map((t) => {
    const isToThisAccount = t.to_account_id === accountId;
    const isFromThisAccount = t.from_account_id === accountId;

    let inAmt = 0;
    let outAmt = 0;

    if (isToThisAccount) {
      inAmt = Number(t.amount) || 0;
      totalIn += inAmt;
      running += inAmt;
    } else if (isFromThisAccount) {
      outAmt = Number(t.amount) || 0;
      totalOut += outAmt;
      running -= outAmt;
    }

    const otherAccId = isToThisAccount ? t.from_account_id : t.to_account_id;
    const otherAcc = accounts.find((a) => a.account_id === otherAccId);
    const otherLabel = otherAcc ? otherAcc.account_name : (t.recipient_name || 'External / Expense / Supplier');

    return {
      id: t.transfer_id,
      transferId: t.transfer_id,
      timestamp: t.created_at,
      date: t.created_at ? t.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      type: t.type,
      description: t.notes || `${t.type.replace(/_/g, ' ')} (${otherLabel})`,
      reference: t.receipt_image_url || t.transfer_id,
      inAmount: inAmt,
      outAmount: outAmt,
      runningBalance: Math.round(running * 100) / 100,
      authorizedBy: t.approved_by_user_name || t.created_by_user_name || 'System',
      recipientOrSource: otherLabel,
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

  // Reverse so newest appears first for tabular display
  const entriesDesc = [...entriesAsc].reverse();

  return {
    account,
    entries: entriesDesc,
    totalIn: Math.round(totalIn * 100) / 100,
    totalOut: Math.round(totalOut * 100) / 100,
    currentBalance: currentBal,
  };
};
