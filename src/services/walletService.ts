// Multi-Wallet & Real Cash Flow Service
// Supports: Cash, EcoCash, ZiG Bank, USD Bank, Home Safe
// Electronic money auto-posting, charge splitting, supervisor expected cash, shop use/internal consumption, owner drawings

import {
  Wallet,
  WalletId,
  WalletTransfer,
  InternalConsumption,
  InternalConsumptionItem,
  OwnerDrawing,
  SupervisorHandoverSummary,
  Salesperson,
  ExpenseEntry,
} from '../types';
import {
  getStored,
  setStored,
  getCurrentCompanyId,
  getCurrentBranchId,
  getTodayDateString,
  addExpense,
  addCashLog,
  getExpenses,
  getSales,
  getSalespeople,
  getAllCashLifts,
  getDirectGrvs,
  updateProductStock,
  getProductById,
  getMultiCurrencyConfig,
} from '../db/roomDatabase';
import { addMovement, getShiftId } from '../db/cashLedger';
import { isSameDaySafe } from '../utils/dateUtils';

export const WALLET_STORAGE_KEYS = {
  WALLETS: 'saimetric_wallets',
  TRANSFERS: 'saimetric_wallet_transfers',
  INTERNAL_CONSUMPTION: 'saimetric_internal_consumption',
  OWNER_DRAWINGS: 'saimetric_owner_drawings',
};

export const INITIAL_WALLETS: Wallet[] = [
  {
    id: 'wallet_cash',
    name: 'Till Cash Drawers',
    type: 'CASH_DRAWER',
    currency: 'USD',
    balance: 0,
    expectedBalance: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wallet_ecocash',
    name: 'Company EcoCash Merchant Account',
    type: 'ECOCASH',
    currency: 'EcoCash',
    balance: 0,
    expectedBalance: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wallet_bank_zig',
    name: 'Company ZiG Bank Account',
    type: 'BANK_ZIG',
    currency: 'ZiG',
    balance: 0,
    expectedBalance: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wallet_bank_usd',
    name: 'Company USD Bank Account',
    type: 'BANK_USD',
    currency: 'USD',
    balance: 0,
    expectedBalance: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wallet_home_safe',
    name: 'Owner Home Safe Cash',
    type: 'HOME_SAFE',
    currency: 'USD',
    balance: 0,
    expectedBalance: 0,
    updatedAt: new Date().toISOString(),
  },
];

// --- 1. Wallet CRUD & Balances ---

export const getWallets = (): Wallet[] => {
  return getStored<Wallet[]>(WALLET_STORAGE_KEYS.WALLETS, INITIAL_WALLETS);
};

export const getWalletById = (id: WalletId): Wallet | undefined => {
  return getWallets().find((w) => w.id === id);
};

export const saveWallets = (wallets: Wallet[]) => {
  setStored(WALLET_STORAGE_KEYS.WALLETS, wallets);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('saimetric_wallets_updated'));
  }
};

/**
 * Adjust wallet physical balance
 */
export const adjustWalletBalance = (walletId: WalletId, delta: number) => {
  const wallets = getWallets();
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx !== -1) {
    wallets[idx].balance = Math.round((wallets[idx].balance + delta) * 100) / 100;
    wallets[idx].updatedAt = new Date().toISOString();
    saveWallets(wallets);
  }
};

export const updateWalletCountedBalance = (walletId: WalletId, newCountedBalance: number) => {
  const wallets = getWallets();
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx !== -1) {
    wallets[idx].balance = Math.round(newCountedBalance * 100) / 100;
    wallets[idx].updatedAt = new Date().toISOString();
    saveWallets(wallets);
  }
};

// --- 2. Electronic Sale Wallet Inflow Hook ---
/**
 * Called when a sale is paid via EcoCash or ZiG Bank Transfer or Cash.
 * For electronic money (EcoCash, ZiG), credits the actual electronic amount received
 * into the company's electronic account (including any gross tender for cash withdrawals).
 * If a cash withdrawal was performed, the till cash drawer is debited for the physical USD handed out.
 */
export const creditWalletForSale = (
  paymentMethodOrCurrency: string,
  amount: number,
  saleId: string,
  customerName: string,
  options?: {
    totalChargedInCurrency?: number;
    totalInCurrency?: number;
    currency?: string;
    exchangeRate?: number;
    cashWithdrawalAmount?: number;
  }
) => {
  const method = (paymentMethodOrCurrency || '').toLowerCase();
  const cur = (options?.currency || '').toLowerCase();
  let targetWallet: WalletId = 'wallet_cash';
  let targetCreditAmount = amount;

  const isEco = method.includes('eco') || cur.includes('eco');
  const isZiG = method.includes('zig') || cur.includes('zig');

  if (isEco) {
    targetWallet = 'wallet_ecocash';
    // Exact EcoCash amount customer paid into merchant account
    targetCreditAmount =
      Number(options?.totalChargedInCurrency) ||
      Number(options?.totalInCurrency) ||
      Math.round(amount * (options?.exchangeRate || 1.05) * 100) / 100;
  } else if (isZiG) {
    targetWallet = 'wallet_bank_zig';
    // Exact ZiG bank amount customer transferred
    targetCreditAmount =
      Number(options?.totalChargedInCurrency) ||
      Number(options?.totalInCurrency) ||
      Math.round(amount * (options?.exchangeRate || 26.5) * 100) / 100;
  } else if (method.includes('bank') || method.includes('card') || method.includes('swipe')) {
    targetWallet = 'wallet_bank_usd';
  }

  // 1. Credit the electronic or cash wallet
  adjustWalletBalance(targetWallet, targetCreditAmount);

  // 2. If an electronic sale involved a physical cash withdrawal from the till drawer,
  // deduct the physical USD cash from Till Cash Drawer!
  if ((isEco || isZiG) && options?.cashWithdrawalAmount && options.cashWithdrawalAmount > 0) {
    adjustWalletBalance('wallet_cash', -Number(options.cashWithdrawalAmount));
  }
};

// --- 3. Wallet Transfers & Electronic Withdrawals with Fee Split ---

export const getWalletTransfers = (): WalletTransfer[] => {
  return getStored<WalletTransfer[]>(WALLET_STORAGE_KEYS.TRANSFERS, []);
};

export const recordWalletTransfer = (data: {
  fromWallet: WalletId;
  toWallet: WalletId;
  amountSent: number;
  amountReceived: number;
  bankCharge: number;
  notes?: string;
  currentUser: Salesperson;
  reference?: string;
}): WalletTransfer => {
  const now = new Date().toISOString();
  const today = getTodayDateString();
  const compId = getCurrentCompanyId();
  const brId = getCurrentBranchId();

  const transfer: WalletTransfer = {
    id: `WT-${Date.now().toString().slice(-6)}`,
    fromWallet: data.fromWallet,
    toWallet: data.toWallet,
    amountSent: data.amountSent,
    amountReceived: data.amountReceived,
    bankCharge: Math.max(0, data.bankCharge),
    notes: data.notes,
    performedBy: data.currentUser.id,
    performedByName: data.currentUser.name,
    timestamp: now,
    date: today,
    reference: data.reference,
    company_id: compId,
    branch_id: brId,
  };

  // 1. Deduct full amount sent from Source Wallet
  adjustWalletBalance(data.fromWallet, -data.amountSent);

  // 2. Add amount received to Destination Wallet
  adjustWalletBalance(data.toWallet, data.amountReceived);

  // 3. Auto-post Bank Charges to Expenses if bankCharge > 0
  if (data.bankCharge > 0) {
    const fromWalletName = getWalletById(data.fromWallet)?.name || data.fromWallet;
    const toWalletName = getWalletById(data.toWallet)?.name || data.toWallet;
    addExpense({
      date: today,
      category: 'Bank & Transaction Fees',
      description: `Transfer / Withdrawal Fee: ${fromWalletName} -> ${toWalletName} (Sent: $${data.amountSent.toFixed(2)}, Recv: $${data.amountReceived.toFixed(2)}, Fee: $${data.bankCharge.toFixed(2)})`,
      amount: data.bankCharge,
      staffId: data.currentUser.id,
      staffName: data.currentUser.name,
      paymentMethod: data.fromWallet === 'wallet_ecocash' ? 'EcoCash/Mobile' : 'Bank Transfer',
      reference: transfer.id,
      vendor: 'Bank / Mobile Network Operator',
      companyId: compId,
      branchId: brId,
    });
  }

  // 4. Save transfer record
  const transfers = getWalletTransfers();
  const updated = [transfer, ...transfers];
  setStored(WALLET_STORAGE_KEYS.TRANSFERS, updated);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('saimetric_wallets_updated'));
    window.dispatchEvent(new Event('saimetric_expenses_updated'));
  }

  return transfer;
};

// --- 4. Internal Consumption / Shop Use / Staff Food ---

export const getInternalConsumptions = (): InternalConsumption[] => {
  return getStored<InternalConsumption[]>(WALLET_STORAGE_KEYS.INTERNAL_CONSUMPTION, []);
};

export const saveInternalConsumptions = (list: InternalConsumption[]) => {
  setStored(WALLET_STORAGE_KEYS.INTERNAL_CONSUMPTION, list);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('saimetric_internal_consumption_updated'));
  }
};

export const createInternalConsumptionRequest = (data: {
  type: 'STAFF_WELFARE' | 'OWNER_DRAWING_GROCERIES' | 'STORE_SUPPLIES';
  items: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    costPrice: number;
    retailPrice: number;
  }>;
  requestedBy: Salesperson;
  notes?: string;
}): InternalConsumption => {
  const now = new Date().toISOString();
  const today = getTodayDateString();
  const compId = getCurrentCompanyId();
  const brId = getCurrentBranchId();

  const itemsWithTotals: InternalConsumptionItem[] = data.items.map((it) => ({
    productId: it.productId,
    productName: it.productName,
    sku: it.sku,
    quantity: it.quantity,
    costPrice: it.costPrice,
    retailPrice: it.retailPrice,
    totalCost: Math.round(it.quantity * it.costPrice * 100) / 100,
    totalRetail: Math.round(it.quantity * it.retailPrice * 100) / 100,
  }));

  const totalCost = Math.round(itemsWithTotals.reduce((s, i) => s + i.totalCost, 0) * 100) / 100;
  const totalRetail = Math.round(itemsWithTotals.reduce((s, i) => s + i.totalRetail, 0) * 100) / 100;

  const request: InternalConsumption = {
    id: `USE-${Date.now().toString().slice(-6)}`,
    type: data.type,
    items: itemsWithTotals,
    totalCost,
    totalRetail,
    requestedBy: data.requestedBy.id,
    requestedByName: data.requestedBy.name,
    requestedAt: now,
    date: today,
    status: 'PENDING',
    notes: data.notes,
    company_id: compId,
    branch_id: brId,
  };

  const list = getInternalConsumptions();
  saveInternalConsumptions([request, ...list]);
  return request;
};

export const approveInternalConsumption = (
  id: string,
  approver: Salesperson,
  supervisorPin: string
): { success: boolean; message: string; record?: InternalConsumption } => {
  // Cashier cannot authorize own request
  const list = getInternalConsumptions();
  const req = list.find((r) => r.id === id);
  if (!req) return { success: false, message: 'Consumption request not found.' };

  if (req.requestedBy === approver.id && approver.role !== 'OWNER' && approver.role !== 'Admin' && approver.role !== 'SUPER_ADMIN') {
    return {
      success: false,
      message: 'Segregation of Duties: Cashiers and supervisors cannot approve their own shop use / internal food request. A separate supervisor or manager must authorize with PIN.',
    };
  }

  // Deduct stock for all items
  for (const it of req.items) {
    const prod = getProductById(it.productId);
    if (prod) {
      updateProductStock(it.productId, -it.quantity);
    }
  }

  // Post expense or owner drawing at COST
  const today = getTodayDateString();
  const compId = getCurrentCompanyId();
  const brId = getCurrentBranchId();

  if (req.type === 'STAFF_WELFARE' || req.type === 'STORE_SUPPLIES') {
    addExpense({
      date: today,
      category: req.type === 'STAFF_WELFARE' ? 'Staff Welfare / Meals' : 'Operating Supplies',
      description: `Shop Use / ${req.type} #${req.id} (${req.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}) at Cost`,
      amount: req.totalCost,
      staffId: req.requestedBy,
      staffName: req.requestedByName,
      paymentMethod: 'Non-Cash (Shop Use)',
      recordCashLog: false,
      reference: req.id,
      notes: `Approved with PIN by ${approver.name}. Non-cash inventory meal/supplies: affects profit in P&L, zero cash outflow from till drawer. Retail value: $${req.totalRetail.toFixed(2)}, Cost: $${req.totalCost.toFixed(2)}.`,
      companyId: compId,
      branchId: brId,
    });
  } else if (req.type === 'OWNER_DRAWING_GROCERIES') {
    // Owner drawing groceries taken at cost - non-cash store goods withdrawal from inventory
    recordOwnerDrawing({
      amount: req.totalCost,
      fromWallet: 'wallet_inventory',
      category: 'PERSONAL',
      recipientOrPurpose: `Owner Drawing: Store groceries taken for home at cost (#${req.id}) (Non-Cash)`,
      notes: `Requested by ${req.requestedByName}, approved by ${approver.name}. Non-cash goods withdrawal from shelves. Items: ${req.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}`,
      currentUser: approver,
    });
  }

  req.status = 'APPROVED';
  req.approvedBy = approver.id;
  req.approvedByName = approver.name;
  req.approvedAt = new Date().toISOString();

  saveInternalConsumptions(list);
  return { success: true, message: `Approved shop use #${req.id} at cost ($${req.totalCost.toFixed(2)}). Stock updated.`, record: req };
};

export const rejectInternalConsumption = (
  id: string,
  approver: Salesperson,
  reason: string
): { success: boolean; message: string } => {
  const list = getInternalConsumptions();
  const req = list.find((r) => r.id === id);
  if (!req) return { success: false, message: 'Request not found' };

  req.status = 'REJECTED';
  req.approvedBy = approver.id;
  req.approvedByName = approver.name;
  req.approvedAt = new Date().toISOString();
  req.rejectionReason = reason;

  saveInternalConsumptions(list);
  return { success: true, message: 'Internal consumption request rejected.' };
};

// --- 5. Owner Drawings ---

export const getOwnerDrawings = (): OwnerDrawing[] => {
  return getStored<OwnerDrawing[]>(WALLET_STORAGE_KEYS.OWNER_DRAWINGS, []);
};

export const recordOwnerDrawing = (data: {
  amount: number;
  fromWallet: WalletId;
  category: 'PERSONAL' | 'FAMILY' | 'SCHOOL_FEES' | 'HOME_SAFE_TRANSIT' | 'OTHER';
  recipientOrPurpose: string;
  notes?: string;
  currentUser: Salesperson;
}): OwnerDrawing => {
  const now = new Date().toISOString();
  const today = getTodayDateString();
  const compId = getCurrentCompanyId();
  const brId = getCurrentBranchId();

  const drawing: OwnerDrawing = {
    id: `DRAW-${Date.now().toString().slice(-6)}`,
    amount: data.amount,
    fromWallet: data.fromWallet,
    category: data.category,
    recipientOrPurpose: data.recipientOrPurpose,
    notes: data.notes,
    withdrawnBy: data.currentUser.id,
    withdrawnByName: data.currentUser.name,
    timestamp: now,
    date: today,
    company_id: compId,
    branch_id: brId,
  };

  // 1. Deduct from wallet
  adjustWalletBalance(data.fromWallet, -data.amount);

  // 2. If transfer to Home Safe, add to Home Safe wallet
  if (data.category === 'HOME_SAFE_TRANSIT') {
    adjustWalletBalance('wallet_home_safe', data.amount);
  }

  // 3. Save
  const list = getOwnerDrawings();
  setStored(WALLET_STORAGE_KEYS.OWNER_DRAWINGS, [drawing, ...list]);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('saimetric_wallets_updated'));
    window.dispatchEvent(new Event('saimetric_owner_drawings_updated'));
  }

  return drawing;
};

// --- 6. Supervisor Expected Cash Calculation ---
/**
 * Expected Cash = Opening + His Cash Sales + Till Lifts He Collected
 *                 - Expenses He Paid From Cash - GRV Payments He Made From Cash
 *                 - Cash Already Handed Over / Transferred - Shop Use Issued
 */
export const calculateSupervisorExpectedCash = (
  supervisorId: string,
  date: string
): SupervisorHandoverSummary => {
  const allStaff = getSalespeople();
  const sup = allStaff.find((s) => s.id === supervisorId);
  const supName = sup?.name || 'Supervisor';

  // 1. Own cash sales done by supervisor himself
  const allSales = getSales();
  const supSales = allSales.filter(
    (s) => (s.staffId === supervisorId || s.salespersonName === supName) && s.date === date
  );
  const ownCashSales = supSales
    .filter((s) => s.paymentMethod === 'Cash' || !s.paymentMethod)
    .reduce((sum, s) => sum + (s.total || 0), 0);

  // 2. Till lifts collected by this supervisor
  const allLifts = getAllCashLifts();
  const liftsCollected = allLifts
    .filter((l) => (l.supervisorId === supervisorId || l.supervisorName === supName) && l.date === date)
    .reduce((sum, l) => sum + (l.totalAmount || 0), 0);

  // 3. Expenses paid out of cash by supervisor
  const allExpenses = getExpenses();
  const expensesPaid = allExpenses
    .filter(
      (e) =>
        (e.staffId === supervisorId || e.staffName === supName) &&
        e.date === date &&
        (e.paymentMethod === 'Cash' || !e.paymentMethod)
    )
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  // 4. GRVs paid from cash by supervisor
  const allGrvs = getDirectGrvs();
  let grvPaidFromCash = 0;
  allGrvs.forEach((grv) => {
    if (grv.date === date && grv.status !== 'REJECTED') {
      if (grv.payments && grv.payments.length > 0) {
        grv.payments.forEach((p) => {
          if ((p.userId === supervisorId || p.userName === supName) && p.amount > 0) {
            grvPaidFromCash += p.amount;
          }
        });
      } else if (grv.payFromTill && (grv.receivedByStaffId === supervisorId || grv.receivedByStaffName === supName)) {
        grvPaidFromCash += grv.totalCost || 0;
      }
    }
  });

  // 5. Owner drawings taken by or transferred to safe
  const drawings = getOwnerDrawings().filter(
    (d) => d.date === date && (d.withdrawnBy === supervisorId || d.withdrawnByName === supName)
  );
  const ownerDrawingsTaken = drawings.reduce((sum, d) => sum + (d.amount || 0), 0);

  // 6. Shop use / internal consumption: Non-cash inventory transaction (affects P&L profit, but does NOT affect cash)
  const shopUsePaidFromCash = 0;

  // Opening float for supervisor (defaults to 0 unless assigned)
  const openingCash = 0;
  const totalCashHandled = openingCash + ownCashSales + liftsCollected;
  const cashOutTotal = expensesPaid + grvPaidFromCash + ownerDrawingsTaken;
  const expectedHandoverCash = Math.round((totalCashHandled - cashOutTotal) * 100) / 100;

  return {
    supervisorId,
    supervisorName: supName,
    date,
    openingCash,
    ownCashSales,
    tillLiftsCollected: liftsCollected,
    totalCashHandled,
    expensesPaidFromCash: expensesPaid,
    grvPaymentsPaidFromCash: grvPaidFromCash,
    shopUsePaidFromCash,
    ownerDrawingsTaken,
    transfersToSafeOrBank: ownerDrawingsTaken,
    expectedHandoverCash,
    status: 'Balanced',
  };
};

// --- 7. "Where is My Money?" Reconciliation Engine ---

export interface WalletReconciliationItem {
  wallet: Wallet;
  openingBalance: number;
  salesInflow: number;
  transfersIn: number;
  transfersOut: number;
  grvPayments: number;
  ownerDrawings: number;
  bankCharges: number;
  shopUseDeductions: number;
  expectedBalance: number;
  actualCountedBalance: number;
  variance: number;
  status: 'Balanced' | 'Over' | 'Shortage';
}

export const calculateWhereIsMyMoney = (date: string): WalletReconciliationItem[] => {
  const wallets = getWallets();
  const allSales = getSales();
  const isMatchDate = (sale: any) => {
    if (sale.status === 'Refunded' || sale.status === 'Voided') return false;
    return isSameDaySafe(sale.date, sale.timestamp, date);
  };
  const sales = allSales.filter(isMatchDate);
  const transfers = getWalletTransfers().filter((t) => t.date === date);
  const grvs = getDirectGrvs().filter((g) => g.date === date && g.status !== 'REJECTED');
  const expenses = getExpenses().filter((e) => e.date === date);
  const drawings = getOwnerDrawings().filter((d) => d.date === date);
  const consumptions = getInternalConsumptions().filter((c) => c.date === date && c.status === 'APPROVED');
  const multiConfig = getMultiCurrencyConfig();

  return wallets.map((w) => {
    // 1. Sales inflow
    let salesInflow = 0;
    if (w.id === 'wallet_cash') {
      const pureCashSales = sales
        .filter((s) => s.paymentMethod === 'Cash' || !s.paymentMethod)
        .reduce((sum, s) => sum + (s.total || 0), 0);
      
      // Cash withdrawal payouts handed out from till cash drawer (e.g. customer swiped EcoCash/ZiG and received USD cash)
      const cashOutFromTill = sales.reduce((sum, s) => sum + (Number(s.cashWithdrawalAmount) || 0), 0);

      salesInflow = Math.round((pureCashSales - cashOutFromTill) * 100) / 100;
    } else if (w.id === 'wallet_ecocash') {
      // In Zimbabwe EcoCash, customer paid the electronic EcoCash amount into company merchant account.
      // If customer made a $38 sale, they paid 39.90 EcoCash.
      // If customer also withdrew $10 cash, they transferred 49.05 EcoCash (or 50.40) into our EcoCash merchant account!
      const defaultEcoRate = multiConfig.rates['EcoCash']?.rateToUsd || multiConfig.rates['EcoCash']?.rateToBase || 1.05;
      salesInflow = sales
        .filter((s) => (s.paymentMethod || '').toLowerCase().includes('eco') || (s.currency || '').toLowerCase().includes('eco'))
        .reduce((sum, s) => {
          const ecoRate = Number(s.exchangeRate) || defaultEcoRate;
          const saleInCur = Number(s.totalInCurrency) || (Number(s.total || 0) * ecoRate);
          const withdrawalInCur = Number(s.cashWithdrawalInCurrency) || (Number(s.cashWithdrawalAmount || 0) * ecoRate);
          const actualElectronicPaid =
            Number(s.totalChargedInCurrency) ||
            (saleInCur + withdrawalInCur) ||
            (Number(s.grossTenderUsd || s.total || 0) * ecoRate);
          return sum + Math.round(actualElectronicPaid * 100) / 100;
        }, 0);
      salesInflow = Math.round(salesInflow * 100) / 100;
    } else if (w.id === 'wallet_bank_zig') {
      // For ZiG bank transfer, customer paid the electronic ZiG amount into company account (including any gross with cash withdrawal)
      const defaultZigRate = multiConfig.rates['ZiG']?.rateToUsd || multiConfig.rates['ZiG']?.rateToBase || 26.5;
      salesInflow = sales
        .filter((s) => (s.paymentMethod || '').toLowerCase().includes('zig') || (s.currency || '').toLowerCase().includes('zig'))
        .reduce((sum, s) => {
          const zigRate = Number(s.exchangeRate) || defaultZigRate;
          const saleInCur = Number(s.totalInCurrency) || (Number(s.total || 0) * zigRate);
          const withdrawalInCur = Number(s.cashWithdrawalInCurrency) || (Number(s.cashWithdrawalAmount || 0) * zigRate);
          const actualElectronicPaid =
            Number(s.totalChargedInCurrency) ||
            (saleInCur + withdrawalInCur) ||
            (Number(s.grossTenderUsd || s.total || 0) * zigRate);
          return sum + Math.round(actualElectronicPaid * 100) / 100;
        }, 0);
      salesInflow = Math.round(salesInflow * 100) / 100;
    } else if (w.id === 'wallet_bank_usd') {
      salesInflow = sales
        .filter((s) => s.paymentMethod === 'Card' || s.paymentMethod === 'Bank Transfer')
        .reduce((sum, s) => sum + (s.total || 0), 0);
      salesInflow = Math.round(salesInflow * 100) / 100;
    }

    // 2. Transfers In & Out
    const transfersIn = transfers
      .filter((t) => t.toWallet === w.id)
      .reduce((sum, t) => sum + (t.amountReceived || 0), 0);
    const transfersOut = transfers
      .filter((t) => t.fromWallet === w.id)
      .reduce((sum, t) => sum + (t.amountSent || 0), 0);

    // 3. GRV Payments from this wallet
    let grvPayments = 0;
    if (w.id === 'wallet_cash') {
      grvs.forEach((g) => {
        if (g.payFromTill) grvPayments += g.totalCost || 0;
      });
    }

    // 4. Owner Drawings from this wallet
    const ownerDrawings = drawings
      .filter((d) => d.fromWallet === w.id)
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    // 5. Bank charges applied to this wallet
    const bankCharges = transfers
      .filter((t) => t.fromWallet === w.id)
      .reduce((sum, t) => sum + (t.bankCharge || 0), 0);

    // 6. Shop use deductions: Shop use is a non-cash transaction (reduces inventory and P&L profit, does NOT affect cash in drawer/bank)
    const shopUseDeductions = 0;

    const opening = 0;
    const expected = Math.round(
      (opening + salesInflow + transfersIn - transfersOut - grvPayments - ownerDrawings - bankCharges) * 100
    ) / 100;

    const actual = w.balance;
    const variance = Math.round((actual - expected) * 100) / 100;

    let status: 'Balanced' | 'Over' | 'Shortage' = 'Balanced';
    if (Math.abs(variance) < 0.01) {
      status = 'Balanced';
    } else if (variance < 0) {
      status = 'Shortage';
    } else {
      status = 'Over';
    }

    return {
      wallet: w,
      openingBalance: opening,
      salesInflow,
      transfersIn,
      transfersOut,
      grvPayments,
      ownerDrawings,
      bankCharges,
      shopUseDeductions,
      expectedBalance: expected,
      actualCountedBalance: actual,
      variance,
      status,
    };
  });
};
