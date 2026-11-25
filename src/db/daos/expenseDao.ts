import { Branch, CashLogEntry, ExpenseEntry, Salesperson } from '../../types';
import { isSameDaySafe } from '../../utils/dateUtils';
import { STORAGE_KEYS } from '../storageKeys';

export interface ExpenseDaoDeps {
  getStored: <T>(key: string, defaultValue: T) => T;
  setStored: <T>(key: string, value: T) => void;
  initialExpenses: ExpenseEntry[];
  getCurrentBranchId: () => string;
  getCurrentCompanyId: () => string;
  getBranches: () => Branch[];
  isCompanyInTenantScope: (companyId: string | undefined, currentCompany: string) => boolean;
  isRecordInBranchScope: (
    recordBranchId: string | undefined,
    targetBranchId: string,
    branches?: Branch[],
    currentCompany?: string,
    recordCompanyId?: string
  ) => boolean;
  getSessionUser: () => Salesperson | null;
  isSupervisorOrAbove: (role?: string) => boolean;
  generateUUID: () => string;
  getCashLogs: () => CashLogEntry[];
  addCashLog: (entry: any, options?: { fromSync?: boolean }) => any;
  getMovements: () => any[];
  addMovement: (entry: any) => any;
  getShiftId: (staffId: string, date: string, branchId?: string) => string;
  enqueueSync: (sheet: any, action: 'INSERT' | 'UPDATE' | 'DELETE', data: any) => void;
  notifyExpenseChanged: (expense: ExpenseEntry) => void;
  notifyListeners: () => void;
}

export type AddExpenseInput = Omit<ExpenseEntry, 'id' | 'synced'> & {
  id?: string;
  recordCashLog?: boolean;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
  status?: 'pending_supervisor' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedByName?: string;
  approvalTimestamp?: string;
  fromMesh?: boolean;
  updatedAt?: number;
  lastUpdated?: string;
};

/**
 * Modular Expense DAO factory (Phase 3B roomDatabase decomposition).
 * Encapsulates expense persistence, supervisor approval/rejection workflows,
 * and automatic cash-drawer reversal synchronization without circular imports.
 */
export const createExpenseDao = (deps: ExpenseDaoDeps) => {
  const getRawStoredExpenses = (): ExpenseEntry[] => {
    return deps.getStored<ExpenseEntry[]>(STORAGE_KEYS.EXPENSES, deps.initialExpenses);
  };

  const getAllExpenses = (branchId?: string): ExpenseEntry[] => {
    const currentBranch = branchId || deps.getCurrentBranchId();
    const currentCompany = deps.getCurrentCompanyId();
    const raw = getRawStoredExpenses();
    if (!currentBranch || currentBranch === 'ALL') {
      return raw.filter((e) =>
        deps.isCompanyInTenantScope(e.company_id || e.companyId, currentCompany)
      );
    }
    const branches = deps.getBranches();
    return raw.filter((e) => {
      const compId = e.company_id || e.companyId;
      const brId = (e as any).branch_id || (e as any).branchId;
      return deps.isRecordInBranchScope(brId, currentBranch, branches, currentCompany, compId);
    });
  };

  const getExpenses = (): ExpenseEntry[] => {
    return getAllExpenses();
  };

  const getNextExpenseId = (): string => {
    return deps.generateUUID();
  };

  const addExpense = (
    expenseData: AddExpenseInput,
    options?: { fromSync?: boolean }
  ): ExpenseEntry => {
    const rawAll = getRawStoredExpenses();
    const currentCompany = deps.getCurrentCompanyId();
    const currentBranch = deps.getCurrentBranchId();
    const sessionUser = deps.getSessionUser();
    const isSupervisor = deps.isSupervisorOrAbove(sessionUser?.role);
    const compId = expenseData.company_id || expenseData.companyId || currentCompany;
    const brId = expenseData.branch_id || expenseData.branchId || currentBranch;
    const expId = expenseData.id || deps.generateUUID();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const existingIdx = rawAll.findIndex((e) => e.id === expId);
    const existing = existingIdx >= 0 ? rawAll[existingIdx] : null;

    const isStatusFinal = (st?: string) => st === 'approved' || st === 'rejected';
    const isStatusPending = (st?: string) =>
      !st || st === 'pending' || st === 'pending_supervisor' || st === 'pending_approval';

    if (existing) {
      // Protect finalized status against stale pending packets
      const preserveExistingFinal =
        isStatusFinal(existing.status) && isStatusPending(expenseData.status);
      const merged: ExpenseEntry = {
        ...existing,
        ...expenseData,
        id: expId,
        status: preserveExistingFinal ? existing.status : expenseData.status || existing.status,
        approvedBy: preserveExistingFinal
          ? existing.approvedBy
          : expenseData.approvedBy || existing.approvedBy,
        approvedByName: preserveExistingFinal
          ? existing.approvedByName
          : expenseData.approvedByName || existing.approvedByName,
        approvalTimestamp: preserveExistingFinal
          ? existing.approvalTimestamp
          : expenseData.approvalTimestamp || existing.approvalTimestamp,
        company_id: compId,
        companyId: compId,
        branch_id: brId,
        branchId: brId,
        updatedAt: expenseData.updatedAt || nowMs,
        lastUpdated: expenseData.lastUpdated || nowIso,
      };
      delete (merged as any).fromMesh;
      delete (merged as any).fromSync;
      rawAll[existingIdx] = merged;
      deps.setStored(STORAGE_KEYS.EXPENSES, rawAll);

      // If synced rejection for a Cash expense arrived from peer, apply local cash reversal idempotently
      const isNewlyRejectedFromMesh =
        (options?.fromSync || expenseData.fromMesh) &&
        merged.status === 'rejected' &&
        existing.status !== 'rejected' &&
        (merged.paymentMethod === 'Cash' || !merged.paymentMethod);
      if (isNewlyRejectedFromMesh) {
        const shiftDate = merged.date || nowIso.split('T')[0];
        const targetStaffId = merged.staffId || '001';
        const targetStaffName = merged.staffName || 'Cashier';
        const hasRevLog = deps
          .getCashLogs()
          .some(
            (l) => l.reference === merged.id && String(l.description || '').startsWith('REVERSAL:')
          );
        if (!hasRevLog) {
          deps.addCashLog(
            {
              timestamp: nowIso,
              date: shiftDate,
              staffId: targetStaffId,
              staffName: targetStaffName,
              line: 'Expenses',
              description: `REVERSAL: Expense #${merged.id} returned to drawer by ${merged.approvedByName || 'Supervisor'}`,
              in: merged.amount,
              out: 0,
              category: 'Expense Reversal',
              reference: merged.id,
              company_id: compId,
              branch_id: brId,
              fromMesh: true,
              skipSync: true,
            },
            { fromSync: true }
          );
        }
        const hasRevMov = deps
          .getMovements()
          .some((m) => m.type === 'expense_reversal' && m.sourceRef === merged.id);
        if (!hasRevMov) {
          deps.addMovement({
            shiftId: deps.getShiftId(targetStaffId, shiftDate, brId),
            staffId: targetStaffId,
            date: shiftDate,
            timestamp: nowIso,
            type: 'expense_reversal',
            amount: merged.amount,
            currency: 'USD',
            direction: 'in',
            affectsDrawer: true,
            status: 'approved',
            sourceModule: 'form2',
            sourceRef: merged.id,
            notes: `Peer Expense #${merged.id} rejected - $${merged.amount.toFixed(2)} returned to till`,
            approvedBy: merged.approvedBy,
            approvedByName: merged.approvedByName,
            company_id: compId,
            branch_id: brId,
            fromMesh: true,
          });
        }
      }

      deps.notifyListeners();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: merged }));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: merged }));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
      return merged;
    }

    const initialStatus = expenseData.status || (isSupervisor ? 'approved' : 'pending_supervisor');

    const created: ExpenseEntry = {
      ...expenseData,
      id: expId,
      synced: false,
      status: initialStatus,
      approvedBy:
        expenseData.approvedBy ||
        (initialStatus === 'approved' ? sessionUser?.id || '001' : undefined),
      approvedByName:
        expenseData.approvedByName ||
        (initialStatus === 'approved' ? sessionUser?.name || 'Supervisor' : undefined),
      approvalTimestamp:
        expenseData.approvalTimestamp || (initialStatus === 'approved' ? nowIso : undefined),
      company_id: compId,
      companyId: compId,
      branch_id: brId,
      branchId: brId,
      updatedAt: expenseData.updatedAt || nowMs,
      lastUpdated: expenseData.lastUpdated || nowIso,
    };
    delete (created as any).fromMesh;
    delete (created as any).fromSync;
    const updated = [created, ...rawAll];
    deps.setStored(STORAGE_KEYS.EXPENSES, updated);

    // If cash expense, add to CashLog
    if (expenseData.paymentMethod === 'Cash' && expenseData.recordCashLog !== false) {
      const hasLog = deps
        .getCashLogs()
        .some((l) => l.reference === created.id && (Number(l.out) || 0) > 0);
      if (!hasLog) {
        deps.addCashLog(
          {
            timestamp: created.timestamp,
            date: created.date,
            staffId: created.staffId,
            staffName: created.staffName,
            line: 'Expenses',
            description: `Expense #${created.id} [${created.status === 'approved' ? 'Approved' : 'Pending Approval'}] - ${created.category}: ${created.description}`,
            in: 0,
            out: created.amount,
            category: created.category,
            reference: created.id,
            company_id: compId,
            branch_id: brId,
            skipSync: !!options?.fromSync || !!expenseData.fromMesh,
          },
          options
        );
      }
    }

    deps.notifyListeners();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: created }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: created }));
    }

    // Save to Sheet "Expenses" & broadcast to Local Hub / Mesh
    if (!options?.fromSync && !expenseData.fromMesh) {
      console.log(
        `[Row10] Direct enqueue: Expenses ${created.id} (fromSync=${options?.fromSync ?? false})`
      );
      deps.enqueueSync('Expenses', 'INSERT', {
        ...created,
        id: created.id,
        company_id: compId,
        branch_id: brId,
        Timestamp: created.timestamp,
        ExpenseID: created.id,
        Date: created.date,
        Category: created.category,
        VendorOrCustomer: created.vendorOrCustomer || '',
        Amount: created.amount,
        PaymentMethod: created.paymentMethod,
        StaffID: created.staffId,
        StaffName: created.staffName,
        Description: created.description,
        ReceiptRef: created.receiptRef || '',
        Status: created.status,
      });
      deps.notifyExpenseChanged(created);
    }

    return created;
  };

  const getExpensesForStaffAndDate = (staffId: string, date: string): ExpenseEntry[] => {
    const currentCompany = deps.getCurrentCompanyId();
    const allExpenses = getAllExpenses();
    const targetStaffId = String(staffId || '').trim().toLowerCase();
    const normTarget = targetStaffId.replace(/^usr-|^staff-|^0+/, '');

    return allExpenses.filter((e) => {
      const compId = (e.company_id || e.companyId || '').trim();
      const matchesComp =
        !compId ||
        currentCompany === 'COMP-MASTER' ||
        compId === 'COMP-MASTER' ||
        compId === currentCompany ||
        (!currentCompany && (compId === 'COMP-001' || compId === 'COMP-MASTER'));
      if (!matchesComp) return false;

      const expStaffId = e.staffId ? String(e.staffId).trim().toLowerCase() : '';
      const normExpStaff = expStaffId.replace(/^usr-|^staff-|^0+/, '');

      const isSameStaff =
        !targetStaffId ||
        targetStaffId === 'all' ||
        expStaffId === targetStaffId ||
        (normTarget && normExpStaff === normTarget);

      const isSameDate = isSameDaySafe(e.date, e.timestamp, date);
      return isSameStaff && isSameDate;
    });
  };

  const approveExpense = (expenseId: string, supervisor: Salesperson): boolean => {
    const all = getRawStoredExpenses();
    const idx = all.findIndex((e) => e.id === expenseId);
    if (idx === -1) return false;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const nextExp: any = {
      ...all[idx],
      status: 'approved',
      approvedBy: supervisor.id,
      approvedByName: supervisor.name,
      approvalTimestamp: nowIso,
      updatedAt: nowMs,
      lastUpdated: nowIso,
    };
    delete nextExp.fromMesh;
    delete nextExp.fromSync;
    all[idx] = nextExp;
    deps.setStored(STORAGE_KEYS.EXPENSES, all);
    const exp = all[idx];
    deps.enqueueSync('Expenses', 'UPDATE', {
      ...exp,
      ExpenseID: exp.id,
      Status: exp.status,
      ApprovedBy: supervisor.name,
      ApprovalTimestamp: nowIso,
    });
    deps.notifyExpenseChanged(exp);
    deps.notifyListeners();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: exp }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: exp }));
    }
    return true;
  };

  const rejectExpense = (
    expenseId: string,
    supervisor: Salesperson,
    reason: string = 'Returned to cashier drawer for re-entry'
  ): boolean => {
    const all = getRawStoredExpenses();
    const idx = all.findIndex((e) => e.id === expenseId);
    if (idx === -1) return false;
    const exp = all[idx];

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const nextExp: any = {
      ...exp,
      status: 'rejected',
      approvedBy: supervisor.id,
      approvedByName: supervisor.name,
      approvalTimestamp: now,
      updatedAt: nowMs,
      lastUpdated: now,
      notes: `${exp.notes ? exp.notes + ' • ' : ''}Rejected by ${supervisor.name}: ${reason}`,
    };
    delete nextExp.fromMesh;
    delete nextExp.fromSync;
    all[idx] = nextExp;
    deps.setStored(STORAGE_KEYS.EXPENSES, all);

    // If cash expense, return the money to the cashier's drawer so it can be re-entered
    if (exp.paymentMethod === 'Cash' || !exp.paymentMethod) {
      const shiftDate = exp.date || now.split('T')[0];
      const targetStaffId = exp.staffId || '001';
      const targetStaffName = exp.staffName || 'Cashier';

      // 1. Compensatory CashLog entry (IN to balance out previous OUT)
      deps.addCashLog({
        timestamp: now,
        date: shiftDate,
        staffId: targetStaffId,
        staffName: targetStaffName,
        line: 'Expenses',
        description: `REVERSAL: Expense #${exp.id} returned to drawer by ${supervisor.name} (${reason})`,
        in: exp.amount,
        out: 0,
        category: 'Expense Reversal',
        reference: exp.id,
        company_id: exp.company_id,
        branch_id: exp.branch_id,
      });

      // 2. Compensatory cash movement into the cashier's drawer
      deps.addMovement({
        shiftId: deps.getShiftId(targetStaffId, shiftDate, exp.branch_id || (exp as any).branchId),
        staffId: targetStaffId,
        date: shiftDate,
        timestamp: now,
        type: 'expense_reversal',
        amount: exp.amount,
        currency: 'USD',
        direction: 'in',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form2',
        sourceRef: exp.id,
        notes: `Expense #${exp.id} rejected by ${supervisor.name} - $${exp.amount.toFixed(2)} returned to till (${reason})`,
        approvedBy: supervisor.id,
        approvedByName: supervisor.name,
      });
    }

    const updatedExp = all[idx];
    deps.enqueueSync('Expenses', 'UPDATE', {
      ...updatedExp,
      ExpenseID: updatedExp.id,
      Status: updatedExp.status,
      ApprovedBy: supervisor.name,
      ApprovalTimestamp: now,
    });
    deps.notifyExpenseChanged(updatedExp);
    deps.notifyListeners();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: updatedExp }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: updatedExp }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
    }
    return true;
  };

  const approveAllExpensesForStaffAndDate = (
    staffId: string,
    date: string,
    supervisor: Salesperson
  ): number => {
    const all = getRawStoredExpenses();
    let count = 0;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const targetStaffId = String(staffId || '').trim().toLowerCase();
    const normTarget = targetStaffId.replace(/^usr-|^staff-|^0+/, '');
    const newlyApproved: ExpenseEntry[] = [];

    const updated = all.map((e) => {
      const isDateMatch = isSameDaySafe(e.date, e.timestamp, date);
      const expStaffId = e.staffId ? String(e.staffId).trim().toLowerCase() : '';
      const normExpStaff = expStaffId.replace(/^usr-|^staff-|^0+/, '');
      const isStaffMatch =
        !targetStaffId ||
        targetStaffId === 'all' ||
        expStaffId === targetStaffId ||
        (normTarget && normExpStaff === normTarget);

      if (isDateMatch && isStaffMatch && e.status !== 'approved' && e.status !== 'rejected') {
        count++;
        const next: any = {
          ...e,
          status: 'approved',
          approvedBy: supervisor.id,
          approvedByName: supervisor.name,
          approvalTimestamp: now,
          updatedAt: nowMs,
          lastUpdated: now,
        };
        delete next.fromMesh;
        delete next.fromSync;
        newlyApproved.push(next);
        return next;
      }
      return e;
    });

    if (count > 0) {
      deps.setStored(STORAGE_KEYS.EXPENSES, updated);
      newlyApproved.forEach((exp) => {
        deps.enqueueSync('Expenses', 'UPDATE', {
          ...exp,
          ExpenseID: exp.id,
          Status: exp.status,
          ApprovedBy: supervisor.name,
          ApprovalTimestamp: now,
        });
        deps.notifyExpenseChanged(exp);
      });
      deps.notifyListeners();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }
    return count;
  };

  return {
    getRawStoredExpenses,
    getAllExpenses,
    getExpenses,
    getNextExpenseId,
    addExpense,
    getExpensesForStaffAndDate,
    approveExpense,
    rejectExpense,
    approveAllExpensesForStaffAndDate,
  };
};
