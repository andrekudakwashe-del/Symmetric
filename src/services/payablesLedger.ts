export interface SupplierPayable {
  id: string;
  grnId: string;
  amount: number;
  dueDate?: string;
  status: 'UNPAID' | 'PAID' | 'PARTIAL';
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'saimetric_supplier_payables';
let payablesMemory: SupplierPayable[] = [];

export const payablesLedger = {
  getAllPayables(): SupplierPayable[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return payablesMemory;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return payablesMemory;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        payablesMemory = parsed;
        return parsed;
      }
      return payablesMemory;
    } catch {
      return payablesMemory;
    }
  },

  saveAllPayables(payables: SupplierPayable[]): void {
    payablesMemory = payables;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payables));
      } catch (err) {
        console.warn('[PayablesLedger] Error saving payables:', err);
      }
    }
  },

  createPayable(params: { grnId: string; amount: number; dueDate?: string }): string {
    const id = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const payable: SupplierPayable = {
      id,
      grnId: params.grnId,
      amount: params.amount,
      dueDate: params.dueDate,
      status: 'UNPAID',
      createdAt: now,
      updatedAt: now,
    };
    const current = this.getAllPayables();
    this.saveAllPayables([payable, ...current]);
    return id;
  },

  getPayableById(id: string): SupplierPayable | undefined {
    return this.getAllPayables().find((p) => p.id === id);
  },
};
