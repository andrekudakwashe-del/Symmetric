import {
  Salesperson,
  Supplier,
  Branch,
  CashLogEntry,
  SaleInvoice,
  ExpenseEntry,
  DirectGrv,
  CashAccount,
  CashTransfer,
} from '../types';

export type SaleCreationListener = (sale: SaleInvoice) => void;
export const saleCreationListeners: Set<SaleCreationListener> = new Set();

export const inMemorySeenSaleIds: Set<string> = new Set();

export const registerSeenSaleId = (id: string) => {
  if (!id) return;
  inMemorySeenSaleIds.add(id);
};

export const onSaleCreated = (listener: SaleCreationListener) => {
  saleCreationListeners.add(listener);
  return () => {
    saleCreationListeners.delete(listener);
  };
};

export type SaleUpdateListener = (sale: SaleInvoice, extraCashLogs?: CashLogEntry[]) => void;
const saleUpdateListeners: Set<SaleUpdateListener> = new Set();
export const onSaleUpdated = (listener: SaleUpdateListener) => {
  saleUpdateListeners.add(listener);
  return () => {
    saleUpdateListeners.delete(listener);
  };
};
export const notifySaleUpdated = (sale: SaleInvoice, extraCashLogs?: CashLogEntry[]) => {
  saleUpdateListeners.forEach((fn) => {
    try {
      fn(sale, extraCashLogs);
    } catch (e) {
      console.error('saleUpdateListener error:', e);
    }
  });
};

export type CashLogListener = (log: CashLogEntry) => void;
const cashLogCreatedListeners: Set<CashLogListener> = new Set();
const cashLogUpdatedListeners: Set<CashLogListener> = new Set();
export const onCashLogCreated = (listener: CashLogListener) => {
  cashLogCreatedListeners.add(listener);
  return () => {
    cashLogCreatedListeners.delete(listener);
  };
};
export const notifyCashLogCreated = (log: CashLogEntry) => {
  cashLogCreatedListeners.forEach((fn) => {
    try {
      fn(log);
    } catch (e) {
      console.error('cashLogCreatedListener error:', e);
    }
  });
};
export const onCashLogUpdated = (listener: CashLogListener) => {
  cashLogUpdatedListeners.add(listener);
  return () => {
    cashLogUpdatedListeners.delete(listener);
  };
};
export const notifyCashLogUpdated = (log: CashLogEntry) => {
  cashLogUpdatedListeners.forEach((fn) => {
    try {
      fn(log);
    } catch (e) {
      console.error('cashLogUpdatedListener error:', e);
    }
  });
};

export type StaffChangeListener = (staff: Salesperson) => void;
const staffChangeListeners: Set<StaffChangeListener> = new Set();
export const onStaffChanged = (listener: StaffChangeListener) => {
  staffChangeListeners.add(listener);
  return () => {
    staffChangeListeners.delete(listener);
  };
};
export const notifyStaffChanged = (staff: Salesperson) => {
  staffChangeListeners.forEach((fn) => {
    try {
      fn(staff);
    } catch (e) {
      console.error('staffChangeListener error:', e);
    }
  });
};

export type CustomerChangeListener = (customer: any) => void;
const customerChangeListeners: Set<CustomerChangeListener> = new Set();
export const onCustomerChanged = (listener: CustomerChangeListener) => {
  customerChangeListeners.add(listener);
  return () => {
    customerChangeListeners.delete(listener);
  };
};
export const notifyCustomerChanged = (customer: any) => {
  customerChangeListeners.forEach((fn) => {
    try {
      fn(customer);
    } catch (e) {
      console.error('customerChangeListener error:', e);
    }
  });
};

export type SupplierChangeListener = (supplier: Supplier) => void;
const supplierChangeListeners: Set<SupplierChangeListener> = new Set();
export const onSupplierChanged = (listener: SupplierChangeListener) => {
  supplierChangeListeners.add(listener);
  return () => {
    supplierChangeListeners.delete(listener);
  };
};
export const notifySupplierChanged = (supplier: Supplier) => {
  supplierChangeListeners.forEach((fn) => {
    try {
      fn(supplier);
    } catch (e) {
      console.error('supplierChangeListener error:', e);
    }
  });
};

export type BranchChangeListener = (branch: Branch) => void;
const branchChangeListeners: Set<BranchChangeListener> = new Set();
export const onBranchChanged = (listener: BranchChangeListener) => {
  branchChangeListeners.add(listener);
  return () => {
    branchChangeListeners.delete(listener);
  };
};
export const notifyBranchChanged = (branch: Branch) => {
  branchChangeListeners.forEach((fn) => {
    try {
      fn(branch);
    } catch (e) {
      console.error('branchChangeListener error:', e);
    }
  });
};

export type CashAccountChangeListener = (account: CashAccount) => void;
const cashAccountChangeListeners: Set<CashAccountChangeListener> = new Set();
export const onCashAccountChanged = (listener: CashAccountChangeListener) => {
  cashAccountChangeListeners.add(listener);
  return () => {
    cashAccountChangeListeners.delete(listener);
  };
};
export const notifyCashAccountChanged = (account: CashAccount) => {
  cashAccountChangeListeners.forEach((fn) => {
    try {
      fn(account);
    } catch (e) {
      console.error('cashAccountChangeListener error:', e);
    }
  });
};

export type CashTransferChangeListener = (transfer: CashTransfer) => void;
const cashTransferChangeListeners: Set<CashTransferChangeListener> = new Set();
export const onCashTransferChanged = (listener: CashTransferChangeListener) => {
  cashTransferChangeListeners.add(listener);
  return () => {
    cashTransferChangeListeners.delete(listener);
  };
};
export const notifyCashTransferChanged = (transfer: CashTransfer) => {
  cashTransferChangeListeners.forEach((fn) => {
    try {
      fn(transfer);
    } catch (e) {
      console.error('cashTransferChangeListener error:', e);
    }
  });
};

export type ExpenseChangeListener = (expense: ExpenseEntry) => void;
const expenseChangeListeners: Set<ExpenseChangeListener> = new Set();
export const onExpenseChanged = (listener: ExpenseChangeListener) => {
  expenseChangeListeners.add(listener);
  return () => {
    expenseChangeListeners.delete(listener);
  };
};
export const notifyExpenseChanged = (expense: ExpenseEntry) => {
  expenseChangeListeners.forEach((fn) => {
    try {
      fn(expense);
    } catch (e) {
      console.error('expenseChangeListener error:', e);
    }
  });
};

export type DirectGrvChangeListener = (grv: DirectGrv) => void;
const directGrvChangeListeners: Set<DirectGrvChangeListener> = new Set();
export const onDirectGrvChanged = (listener: DirectGrvChangeListener) => {
  directGrvChangeListeners.add(listener);
  return () => {
    directGrvChangeListeners.delete(listener);
  };
};
export const notifyDirectGrvChanged = (grv: DirectGrv) => {
  directGrvChangeListeners.forEach((fn) => {
    try {
      fn(grv);
    } catch (e) {
      console.error('directGrvChangeListener error:', e);
    }
  });
};
