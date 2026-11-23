export interface SupplierPayable {
  id: string;
  grnId: string;
  companyId?: string;
  company_id?: string;
  amount: number;
  dueDate?: string;
  status: 'UNPAID' | 'PAID' | 'PARTIAL';
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'saimetric_supplier_payables';
let payablesMemory: SupplierPayable[] = [];

const normPayableTenant = (comp?: string | null): string => {
  const clean = String(comp || '').trim().toUpperCase();
  if (!clean || clean === 'COMP-001' || clean === 'COMP-MASTER' || clean === 'DEFAULT') {
    return 'COMP-001';
  }
  return clean;
};

const getActivePayableCompanyId = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const sessionRaw = window.localStorage.getItem('saimetric_room_session_user');
      if (sessionRaw) {
        const u = JSON.parse(sessionRaw);
        if (u?.companyId || u?.company_id) return String(u.companyId || u.company_id).trim();
      }
      const storedComp = window.localStorage.getItem('saimetric_room_current_company_id');
      if (storedComp && storedComp.trim()) return storedComp.trim();
    } catch {
      // Fallback below
    }
  }
  return 'COMP-001';
};

export const payablesLedger = {
  getRawStoredPayables(): SupplierPayable[] {
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

  getAllPayables(): SupplierPayable[] {
    const activeComp = normPayableTenant(getActivePayableCompanyId());
    return this.getRawStoredPayables().filter(
      (p) => normPayableTenant(p.company_id || p.companyId) === activeComp
    );
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

  createPayable(params: { grnId: string; amount: number; dueDate?: string; companyId?: string }): string {
    const id = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const activeComp = params.companyId || getActivePayableCompanyId();
    const payable: SupplierPayable = {
      id,
      grnId: params.grnId,
      companyId: activeComp,
      company_id: activeComp,
      amount: params.amount,
      dueDate: params.dueDate,
      status: 'UNPAID',
      createdAt: now,
      updatedAt: now,
    };
    const current = this.getRawStoredPayables();
    this.saveAllPayables([payable, ...current]);
    return id;
  },

  getPayableById(id: string): SupplierPayable | undefined {
    return this.getAllPayables().find((p) => p.id === id);
  },
};
