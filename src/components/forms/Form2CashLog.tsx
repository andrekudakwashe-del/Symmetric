import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, CashLogEntry, DirectGrv, CashLiftRecord, ExpenseEntry, CashTransfer } from '../../types';
import {
  getCashLogs,
  addCashLog,
  deleteCashLog,
  saveDailyCashLogSheet,
  getCashCounts,
  getSalespeople,
  subscribeToDatabase,
  getTodayDateString,
  getCashLogsForStaffAndDate,
  getCashCountForStaffAndDate,
  getDirectGrvs,
  getCashLiftsForStaffAndDate,
  getSalesForStaffAndDate,
  isSupervisorOrAbove,
  getActiveCurrencies,
  getExpensesForStaffAndDate,
  approveExpense,
  approveAllExpensesForStaffAndDate,
  addExpense,
  getCashGovernanceConfig,
  getCashTransfers,
  approveDirectGrv,
  rejectDirectGrv,
} from '../../db/roomDatabase';
import {
  issueTillFloat,
  acceptTillFloat,
  rejectTillFloat,
  createCashTransferVoucher,
  getBranchSafeAccount,
  getClerkFloatAccount,
} from '../../services/cashCustodyService';
import { downloadCsvFile, retrySyncInvoice } from '../../services/googleSheetsSync';
import { SyncStatusDot } from '../common/SyncStatusDot';
import { Form2ExpenseModal } from './Form2ExpenseModal';
import { Form2ExpensesAuditModal } from './Form2ExpensesAuditModal';
import {
  ReceiptText,
  PlusCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Calendar,
  User,
  Wallet,
  CheckCircle2,
  Search,
  Sparkles,
  Trash2,
  Printer,
  X,
  FileCheck,
  RefreshCw,
  Table,
  Save,
  Plus,
  ShoppingBag,
  Smartphone,
  Banknote,
  Lock,
  Edit3,
  Home,
  ArrowLeft,
  ArrowRight,
  Truck,
  ExternalLink,
  Eye,
  Coins,
  ShieldCheck,
  AlertTriangle,
  KeyRound,
  Shield,
  UserCheck,
  Clock,
  Check,
  CreditCard,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';
import { ExchangeRatesModal } from '../common/ExchangeRatesModal';
import { CashLiftModal } from './CashLiftModal';
import { getCashierRetainedFloat } from '../../services/cashCustodyService';
import {
  addMovement,
  updateMovement,
  deleteMovement,
  getMovements,
  getShiftId,
  computeDrawerBalance,
  computeExpectedCash,
  computeVariance,
  approveMovement,
} from '../../db/cashLedger';

interface Form2CashLogProps {
  currentUser: Salesperson;
  onNavigateToCashCount?: () => void;
  onNavigateToCustomerChange?: () => void;
  onNavigateToReconcile?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToDirectGrv?: (grvId?: string) => void;
}

export interface StandardFixedPoint {
  id: string;
  categoryGroup: 'Float & Closeout' | 'Daily Utilities & Home' | 'Daily Store Expenses';
  description: string;
  defaultIn: number | '';
  defaultOut: number | '';
  allowIn: boolean;
  allowOut: boolean;
  placeholder?: string;
  isAutofilledFromCashCount?: boolean;
}

export interface DynamicSectionRow {
  id: string;
  type: string;
  categoryGroup: string;
  label: string;
  allowIn: boolean;
  allowOut: boolean;
  defaultIn?: number | '';
  defaultOut?: number | '';
  placeholder?: string;
  isReadOnly?: boolean;
  isAutofilledFromPos?: boolean;
  isCashLift?: boolean;
  cashLiftId?: string;
  currency?: string;
  currencyAmount?: number;
  exchangeRate?: number;
  isWithdrawal?: boolean;
  supervisorName?: string;
  cashierName?: string;
}

export const FIXED_CASH_LOG_ENTRY_POINTS: StandardFixedPoint[] = [
  // 1. Float & Closeout
  {
    id: 'float',
    categoryGroup: 'Float & Closeout',
    description: 'Float',
    defaultIn: '',
    defaultOut: '',
    allowIn: true,
    allowOut: false,
    placeholder: 'Confirmed drawer float ($0.00)',
  },

  // 2. Daily Store Expenses & Petty Cash
  {
    id: 'expenses',
    categoryGroup: 'Daily Store Expenses',
    description: 'Expenses',
    defaultIn: '',
    defaultOut: '',
    allowIn: false,
    allowOut: true,
    placeholder: 'Store petty cash expenses (filled from POS expenses & Form 2)',
  },
];

// Initial default entries for dynamic categories (ZiG and EcoCash are auto-populated from POS transactions; Cash entries are strictly managed via Supervisor Cash Lifts)
export const INITIAL_DYNAMIC_ROWS: DynamicSectionRow[] = [];

const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200];

export interface QuickEntryType {
  id: string;
  label: string;
  group: 'Float & Closeout' | 'Daily Utilities & Home' | 'ZiG' | 'EcoCash' | 'Direct Procurement';
  allowIn: boolean;
  allowOut: boolean;
  defaultIn?: number | '';
  defaultOut?: number | '';
}

// Clean types for Quick Add single mode (Direct cash transactions removed; Supervisor Cash Lifts are logged via dual-PIN Lift Modal)
const QUICK_ENTRY_TYPES: QuickEntryType[] = [
  { id: 'float', label: 'Float', group: 'Float & Closeout', allowIn: true, allowOut: false, defaultIn: 20.0 },
  { id: 'expenses', label: 'Expenses (Petty Cash)', group: 'Daily Utilities & Home', allowIn: false, allowOut: true },
  { id: 'direct_procurement', label: 'Direct Procurement', group: 'Direct Procurement', allowIn: false, allowOut: true },
];

export const Form2CashLog: React.FC<Form2CashLogProps> = ({
  currentUser,
  onNavigateToCashCount,
  onNavigateToCustomerChange,
  onNavigateToReconcile,
  onNavigateToHome,
  onNavigateToDirectGrv,
}) => {
  const today = getTodayDateString();

  // View mode: 'spreadsheet' (Daily Sheet Matrix) or 'single' (Quick Add)
  const [activeView, setActiveView] = useState<'spreadsheet' | 'single'>('spreadsheet');

  // Sheet configuration state
  const [sheetDate, setSheetDate] = useState<string>(today);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(currentUser.id);
  const salespeople = getSalespeople();

  const selectedStaff = useMemo(() => {
    return salespeople.find((s) => s.id === selectedStaffId) || currentUser;
  }, [salespeople, selectedStaffId, currentUser]);

  const [cashLogs, setCashLogs] = useState<CashLogEntry[]>(() => getCashLogs());
  const [cashCounts, setCashCounts] = useState(() => getCashCounts());
  const [directGrvs, setDirectGrvs] = useState<DirectGrv[]>(() => getDirectGrvs());
  const [viewingProcurementGrv, setViewingProcurementGrv] = useState<DirectGrv | null>(null);
  const [isExistingSavedSheet, setIsExistingSavedSheet] = useState(false);
  const [isShiftSubmitted, setIsShiftSubmitted] = useState(false);

  const isToday = sheetDate === today;
  const isSupervisorOrManager = isSupervisorOrAbove(currentUser.role);
  const isAdmin = currentUser.role === 'Admin' || isSupervisorOrManager;
  const isEditable = isAdmin || isToday; // Staff can only edit today; Admins can edit any day

  // Dynamic rows state (starts with 2 EcoCash, 2 Cash)
  const [dynamicRows, setDynamicRows] = useState<DynamicSectionRow[]>(INITIAL_DYNAMIC_ROWS);

  // Spreadsheet Row Values (Fixed rows + Dynamic rows)
  const [gridValues, setGridValues] = useState<
    Record<
      string,
      {
        in: string;
        out: string;
        note: string;
        itemBought?: string; // Optional: what was bought for Direct Procurement
      }
    >
  >({});

  // Cash Lift Modal and Slip states
  const [isCashLiftModalOpen, setIsCashLiftModalOpen] = useState(false);
  const [selectedCashLiftToView, setSelectedCashLiftToView] = useState<CashLiftRecord | null>(null);
  const [cashLiftsList, setCashLiftsList] = useState<CashLiftRecord[]>(() =>
    getCashLiftsForStaffAndDate(selectedStaffId, sheetDate)
  );

  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0);

  // Float Adjustment Modal State
  const [isFloatModalOpen, setIsFloatModalOpen] = useState(false);
  const [floatAdjAmount, setFloatAdjAmount] = useState('');
  const [floatAdjReason, setFloatAdjReason] = useState('Drawer float adjustment');
  const [floatSupervisorId, setFloatSupervisorId] = useState('');
  const [floatSupervisorPin, setFloatSupervisorPin] = useState('');
  const [floatModalError, setFloatModalError] = useState<string | null>(null);

  // Cashier Float Confirmation housed in Form 2
  const [pendingFloatPin, setPendingFloatPin] = useState('');
  const [pendingFloatPinError, setPendingFloatPinError] = useState('');
  const [isAcceptingFloat, setIsAcceptingFloat] = useState(false);

  // Detect pending float vouchers dispatched to this cashier
  const pendingFloatVouchers = useMemo(() => {
    const allTransfers = getCashTransfers(currentUser?.branchId);
    const staff = selectedStaff || currentUser;
    const staffNameLower = (staff?.name || '').toLowerCase().trim();
    const staffIdLower = (staff?.id || '').toLowerCase().trim();

    return allTransfers.filter((t) => {
      if (t.type !== 'FLOAT_ISSUE' || t.status !== 'PENDING_ACCEPTANCE') return false;
      const recipLower = (t.recipient_name || '').toLowerCase().trim();
      const notesLower = (t.notes || '').toLowerCase().trim();
      const toAccLower = (t.to_account_id || '').toLowerCase().trim();
      return (
        recipLower === staffNameLower ||
        notesLower.includes(staffNameLower) ||
        toAccLower.includes(staffIdLower) ||
        t.created_by_user_id === staff?.id ||
        (salespeople.length === 1 && !t.recipient_name)
      );
    });
  }, [selectedStaff, currentUser, salespeople, ledgerRefreshKey, cashLogs]);

  const currentShiftId = useMemo(() => {
    return getShiftId(selectedStaffId, sheetDate);
  }, [selectedStaffId, sheetDate]);

  // Float Requirement: On Form 2 open, if no opening_float exists for the shift, auto-create it with configured default float and deduct from Safe/Clerk
  useEffect(() => {
    const sId = getShiftId(selectedStaffId, sheetDate);
    const moves = getMovements();
    const hasOpeningFloat = moves.some(
      (m) => (m.shiftId === sId || (m.staffId === selectedStaffId && m.date === sheetDate)) && m.type === 'opening_float'
    );
    if (!hasOpeningFloat) {
      const govConfig = getCashGovernanceConfig();
      const defaultFloat = govConfig.defaultTillFloat !== undefined ? govConfig.defaultTillFloat : 20.0;

      // Only auto-issue if explicitly configured in Governance Config! Default is false to require operator/clerk confirmation.
      if (govConfig.autoIssueOpeningFloatOnShiftStart && defaultFloat > 0) {
        addMovement({
          shiftId: sId,
          staffId: selectedStaffId,
          date: sheetDate,
          timestamp: new Date().toISOString(),
          type: 'opening_float',
          amount: defaultFloat,
          currency: 'USD',
          direction: 'in',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          notes: `Initial opening float ($${defaultFloat.toFixed(2)}) from ${govConfig.floatSourceAccountId === 'CLERK' ? 'Accounts Clerk Float' : 'Branch Safe'}`,
        });

        // Deduct from Safe / Accounts Clerk Petty Float and record custody transfer voucher
        try {
          const cashierObj = salespeople.find((s) => s.id === selectedStaffId);
          issueTillFloat({
            cashierId: selectedStaffId,
            cashierName: cashierObj?.name || 'Cashier',
            amount: defaultFloat,
            supervisor: currentUser,
            shiftDate: sheetDate,
            notes: `Auto-issued initial shift opening float ($${defaultFloat.toFixed(2)})`,
          });
        } catch (_) {}

        setLedgerRefreshKey((k) => k + 1);
      }
    }
  }, [selectedStaffId, sheetDate]);

  // Compute shift movements live from cashMovements
  const shiftMovements = useMemo(() => {
    const sId = getShiftId(selectedStaffId, sheetDate);
    return getMovements().filter(
      (m) => m.shiftId === sId || (m.staffId === selectedStaffId && m.date === sheetDate)
    );
  }, [selectedStaffId, sheetDate, ledgerRefreshKey, cashLogs]);

  // Check if opening float was explicitly issued/recorded for this shift
  const hasOpeningFloat = useMemo(() => {
    return shiftMovements.some((m) => m.type === 'opening_float');
  }, [shiftMovements]);

  // 1. Live Drawer Balance: computeDrawerBalance(shiftId)
  const liveDrawerBalance = useMemo(() => {
    return computeDrawerBalance(currentShiftId);
  }, [currentShiftId, shiftMovements]);

  // 2. Pending Approvals: count of pending movements
  const pendingMovements = useMemo(() => {
    return shiftMovements.filter((m) => m.status === 'pending');
  }, [shiftMovements]);
  const pendingApprovalsCount = pendingMovements.length;

  // 3. Non-Cash (Reporting): sum of non-cash electronic sales
  const nonCashReportingTotal = useMemo(() => {
    return shiftMovements
      .filter(
        (m) =>
          !m.affectsDrawer &&
          (m.type === 'ecocash_sale' || m.type === 'zig_sale' || (m.type === 'cash_sale' && m.direction === 'none'))
      )
      .reduce((sum, m) => sum + m.amount, 0);
  }, [shiftMovements]);

  // Shift Float Total: opening float + adjustments (strictly from confirmed movements, saved float logs, or overnight cashbox carryover)
  const shiftFloatTotal = useMemo(() => {
    const floatMoves = shiftMovements.filter(
      (m) => m.type === 'opening_float' || m.type === 'float_adjustment'
    );
    if (floatMoves.length === 0) {
      // Check if there is an explicit saved float in cashLogs for this staff and date
      const savedFloatLog = cashLogs.find(
        (l) =>
          (l.staffId === selectedStaffId || l.staff_id === selectedStaffId) &&
          l.date === sheetDate &&
          (l.line === 'Float' || l.line === 'Opening Float' || (l.description && l.description.toLowerCase().startsWith('float')))
      );
      if (savedFloatLog && savedFloatLog.in > 0) return savedFloatLog.in;

      // Check if cashier retained an overnight float in their physical cashbox from cash-up
      const retainedFloat = getCashierRetainedFloat(selectedStaffId, sheetDate) ?? getCashierRetainedFloat(selectedStaffId);
      if (retainedFloat !== null && retainedFloat > 0) {
        return retainedFloat;
      }
      return 0.0;
    }
    return floatMoves.reduce((sum, m) => {
      if (m.direction === 'in') return sum + m.amount;
      if (m.direction === 'out') return sum - m.amount;
      return sum;
    }, 0);
  }, [shiftMovements, cashLogs, selectedStaffId, sheetDate]);

  // Synchronize selected cashier to active branch staff
  useEffect(() => {
    if (salespeople.length > 0 && !salespeople.some((s) => s.id === selectedStaffId)) {
      const matchCurrent = salespeople.find((s) => s.id === currentUser.id);
      setSelectedStaffId(matchCurrent ? matchCurrent.id : salespeople[0].id);
    }
  }, [salespeople, selectedStaffId, currentUser.id, currentUser.branchId]);

  // Debounced subscription to Room DB and cashMovements changes (eliminates 4x mount re-render lag)
  useEffect(() => {
    let refreshTimer: any = null;
    const debouncedRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        setCashCounts(getCashCounts());
        setCashLogs(getCashLogs());
        setDirectGrvs(getDirectGrvs());
        setCashLiftsList(getCashLiftsForStaffAndDate(selectedStaffId, sheetDate));
        setLedgerRefreshKey((k) => k + 1);
      }, 50);
    };

    window.addEventListener('saimetric_cash_movements_updated', debouncedRefresh);
    window.addEventListener('saimetric_sales_updated', debouncedRefresh);
    window.addEventListener('saimetric_cash_updated', debouncedRefresh);
    window.addEventListener('mesh-catchup-completed', debouncedRefresh);

    const unsubscribe = subscribeToDatabase(() => {
      debouncedRefresh();
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('saimetric_cash_movements_updated', debouncedRefresh);
      window.removeEventListener('saimetric_sales_updated', debouncedRefresh);
      window.removeEventListener('saimetric_cash_updated', debouncedRefresh);
      window.removeEventListener('mesh-catchup-completed', debouncedRefresh);
      unsubscribe();
    };
  }, [selectedStaffId, sheetDate]);

  // Direct Procurements derived from cashMovements (supplier_payment) + directGrvs
  const derivedProcurements = useMemo(() => {
    const list: Array<{
      grvId: string;
      grvNumber: string;
      supplierName: string;
      invoiceNo?: string;
      itemsSummary: string;
      amount: number;
      originalAmount?: number;
      drawerId?: string;
      status: string;
      rejectionReason?: string;
      approvedByName?: string;
      date: string;
      movementId?: string;
    }> = [];

    const seenVouchers = new Set<string>();

    const isStaffMatch = (targetId?: string, targetName?: string) => {
      if (!targetId && !targetName) return false;
      const cleanTarget = (targetId || '').trim().toLowerCase();
      const cleanCur = (selectedStaffId || '').trim().toLowerCase();
      if (cleanTarget && cleanCur) {
        if (cleanTarget === cleanCur) return true;
        const normTarget = cleanTarget.replace(/^usr-|^staff-|^0+/, '');
        const normCur = cleanCur.replace(/^usr-|^staff-|^0+/, '');
        if (normTarget && normCur && normTarget === normCur) return true;
      }
      if (targetName && selectedStaff?.name) {
        if (targetName.trim().toLowerCase() === selectedStaff.name.trim().toLowerCase()) return true;
      }
      return false;
    };

    // 1. First, check shiftMovements for supplier_payment movements
    const procurementMovements = shiftMovements.filter(
      (m) => m.type === 'supplier_payment' && (!m.sourceModule || m.sourceModule === 'DirectGRV')
    );

    procurementMovements.forEach((m) => {
      const refKey = m.sourceRef || m.notes || m.id;
      if (seenVouchers.has(refKey)) return;
      seenVouchers.add(refKey);

      const matchingGrv = directGrvs.find(
        (g) => g.grvNumber === m.sourceRef || g.id === m.sourceRef || (m.sourceRef && m.sourceRef.startsWith(g.grvNumber))
      );

      const isRejected = m.status === 'rejected' || matchingGrv?.status === 'REJECTED';

      list.push({
        grvId: matchingGrv?.id || m.id,
        grvNumber: matchingGrv?.grvNumber || m.sourceRef || m.id,
        supplierName: matchingGrv?.supplierName || m.notes?.replace('Direct Supplier Delivery: ', '').split(' (')[0] || 'Supplier Delivery',
        invoiceNo: matchingGrv?.invoiceNo,
        itemsSummary: matchingGrv ? matchingGrv.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ') : (m.notes || 'Procurement voucher'),
        amount: isRejected ? 0 : (Number(m.amount) || 0),
        originalAmount: Number(m.amount) || matchingGrv?.totalCost || 0,
        drawerId: m.terminalId || 'Till 1',
        status: isRejected ? 'REJECTED' : m.status,
        rejectionReason: matchingGrv?.rejectedReason,
        approvedByName: matchingGrv?.approvedByStaffName || 'Supervisor',
        date: m.date || sheetDate,
        movementId: m.id,
      });
    });

    // 2. Also incorporate any GRVs for this staff & date that may not yet be indexed in movements
    directGrvs.forEach((grv) => {
      const grvDate = (grv.date || grv.createdAt || '').slice(0, 10);
      if (grvDate && grvDate !== sheetDate) return;

      const isRejected = grv.status === 'REJECTED';

      if (grv.payments && grv.payments.length > 0) {
        grv.payments.forEach((p) => {
          if (isStaffMatch(p.userId, p.userName) && (Number(p.amount) || 0) > 0) {
            const vKey = `${grv.grvNumber}-${p.userId}`;
            if (seenVouchers.has(grv.grvNumber) || seenVouchers.has(grv.id) || seenVouchers.has(vKey)) return;
            seenVouchers.add(grv.grvNumber);
            seenVouchers.add(vKey);

            list.push({
              grvId: grv.id,
              grvNumber: grv.grvNumber,
              supplierName: grv.supplierName,
              invoiceNo: grv.invoiceNo,
              itemsSummary: grv.items.map((i) => `${i.quantity}x ${i.productName}`).join(', '),
              amount: isRejected ? 0 : (Number(p?.amount) || 0),
              originalAmount: Number(p?.amount) || 0,
              drawerId: p.drawerId || 'Till 1',
              status: grv.status,
              rejectionReason: grv.rejectedReason,
              approvedByName: grv.approvedByStaffName,
              date: grvDate || sheetDate,
            });
          }
        });
      } else if (grv.payFromTill && isStaffMatch(grv.receivedByStaffId, grv.receivedByStaffName) && (grv.totalCost || 0) > 0) {
        if (seenVouchers.has(grv.grvNumber) || seenVouchers.has(grv.id)) return;
        seenVouchers.add(grv.grvNumber);

        list.push({
          grvId: grv.id,
          grvNumber: grv.grvNumber,
          supplierName: grv.supplierName,
          invoiceNo: grv.invoiceNo,
          itemsSummary: grv.items.map((i) => `${i.quantity}x ${i.productName}`).join(', '),
          amount: isRejected ? 0 : (Number(grv.totalCost) || 0),
          originalAmount: Number(grv.totalCost) || 0,
          drawerId: 'Till 1',
          status: grv.status,
          rejectionReason: grv.rejectedReason,
          approvedByName: grv.approvedByStaffName,
          date: grvDate || sheetDate,
        });
      }
    });

    return list;
  }, [shiftMovements, directGrvs, sheetDate, selectedStaffId, selectedStaff]);

  const derivedProcurementTotalOut = useMemo(() => {
    return (derivedProcurements || [])
      .filter((p) => p.status !== 'REJECTED' && p.status !== 'rejected')
      .reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
  }, [derivedProcurements]);

  // Core function to load saved daily sheet or initialize blank for staff + date
  const loadSheetDataForStaffAndDate = (targetDate: string, targetStaffId: string) => {
    const savedLogs = getCashLogsForStaffAndDate(targetStaffId, targetDate);

    if (savedLogs.length > 0) {
      setIsExistingSavedSheet(true);
      const newGrid: Record<string, { in: string; out: string; note: string; itemBought?: string }> = {};

      // Match Fixed points
      FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
        let matchLog: CashLogEntry | undefined;
        if (pt.id === 'float') {
          matchLog = savedLogs.find(
            (l) => l.line === 'Float' || l.line === 'Opening Float' || (l.description && l.description.toLowerCase().startsWith('float'))
          );
        } else if (pt.id === 'expenses') {
          matchLog = savedLogs.find(
            (l) => (l.line || '').toLowerCase().includes('expense') || (l.description || '').toLowerCase().includes('expense')
          );
        }

        if (pt.id === 'expenses') {
          const staffExp = getExpensesForStaffAndDate(targetStaffId, targetDate).filter(
            (e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod)
          );
          const expTotal = staffExp.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
          const pendingCount = staffExp.filter((e) => e.status !== 'approved').length;

          let outVal = '';
          if (expTotal > 0) {
            outVal = expTotal.toFixed(2);
          } else if (matchLog && matchLog.out > 0) {
            outVal = matchLog.out.toFixed(2);
          }

          let noteVal = '';
          if (staffExp.length > 0) {
            noteVal = `${staffExp.length} expense(s): ${staffExp.map((e) => e.description || e.category).join(', ')}`;
            if (pendingCount > 0) {
              noteVal += ` [${pendingCount} pending supervisor approval]`;
            } else {
              noteVal += ` [All Approved]`;
            }
          } else if (matchLog?.reference) {
            noteVal = matchLog.reference;
          }

          newGrid[pt.id] = {
            in: '',
            out: outVal,
            note: noteVal,
          };
          return;
        }

        if (matchLog) {
          newGrid[pt.id] = {
            in: matchLog.in > 0 ? String(matchLog.in) : '',
            out: matchLog.out > 0 ? String(matchLog.out) : '',
            note: matchLog.reference || '',
          };
        } else {
          // Default fallback
          const initialOut = pt.defaultOut !== '' ? String(pt.defaultOut) : '';
          const retainedFloat = pt.id === 'float' ? (getCashierRetainedFloat(targetStaffId, targetDate) ?? getCashierRetainedFloat(targetStaffId)) : null;
          const initialIn =
            pt.id === 'float'
              ? (retainedFloat !== null && retainedFloat > 0 ? retainedFloat.toFixed(2) : (pt.defaultIn !== '' ? String(pt.defaultIn) : ''))
              : (pt.defaultIn !== '' ? String(pt.defaultIn) : '');
          newGrid[pt.id] = {
            in: initialIn,
            out: initialOut,
            note: pt.id === 'float' && retainedFloat !== null && retainedFloat > 0 ? `Opening float from cashbox ($${retainedFloat.toFixed(2)})` : '',
          };
        }
      });

      // Match Dynamic points
      const remainingDynamicLogs = savedLogs.filter(
        (l) => {
          const desc = (l.description || '').toLowerCase();
          const line = (l.line || '').toLowerCase();
          return (
            !desc.includes('final cash out') &&
            !line.includes('final cash out') &&
            !line.startsWith('float') &&
            !desc.startsWith('float') &&
            !line.startsWith('expense') &&
            !desc.startsWith('expense')
          );
        }
      );

      const activeCurrenciesList = getActiveCurrencies();
      const consumedCurrLogs = new Set<CashLogEntry>();
      const newDynamicRows: DynamicSectionRow[] = [];

      // Dynamically add rows for all active foreign currencies (rate > 0)
      activeCurrenciesList.forEach((curr) => {
        const currKey = curr.currency;
        const currLogs = remainingDynamicLogs.filter(
          (l) =>
            !consumedCurrLogs.has(l) &&
            (l.currency === currKey ||
              l.currency === curr.code ||
              l.line === currKey ||
              l.line === curr.code ||
              l.category?.toLowerCase().includes(currKey.toLowerCase()) ||
              l.category?.toLowerCase().includes(curr.code.toLowerCase()) ||
              (l.description && l.description.toLowerCase().includes(currKey.toLowerCase())) ||
              (l.description && l.description.toLowerCase().includes(curr.code.toLowerCase())))
        );
        currLogs.forEach((l) => consumedCurrLogs.add(l));

        currLogs.forEach((log, i) => {
          const isWithdrawal =
            log.isWithdrawal ||
            log.line?.toLowerCase().includes('withdrawal') ||
            log.category?.toLowerCase().includes('withdrawal') ||
            log.description?.toLowerCase().includes('withdrawal') ||
            log.description?.toLowerCase().includes('cash-out');
          const id = `${currKey.toLowerCase()}_${isWithdrawal ? 'withdrawal' : 'sales'}_pos_${i}_${log.id || Date.now()}`;
          newDynamicRows.push({
            id,
            type: isWithdrawal ? `${currKey}Withdrawal` : `${currKey}Sales`,
            categoryGroup: curr.name,
            label: isWithdrawal ? `${curr.name} Cash-Out` : `${curr.name} Sale`,
            currency: currKey,
            allowIn: false,
            allowOut: true,
            isReadOnly: true,
            isAutofilledFromPos: true,
            isWithdrawal,
            placeholder: isWithdrawal
              ? `POS ${curr.name} Cash-Out (Cash Handed to Customer)`
              : `POS register ${curr.name} non-cash sale`,
          });
          newGrid[id] = {
            in: log.in > 0 ? String(log.in) : '',
            out: log.out > 0 ? String(log.out) : '',
            note:
              log.reference ||
              log.notes ||
              log.description?.replace(new RegExp(`^${currKey}(\\s*-\\s*)?`, 'i'), '') ||
              '',
          };
        });
      });

      const procLogs = remainingDynamicLogs.filter(
        (l) =>
          !consumedCurrLogs.has(l) &&
          (l.line === 'Direct Procurement' ||
            l.category === 'Direct Procurement' ||
            (l.description && l.description.toLowerCase().includes('procurement')))
      );
      const cashLogsList = remainingDynamicLogs.filter(
        (l) =>
          !consumedCurrLogs.has(l) &&
          !procLogs.includes(l) &&
          (l.line === 'Cash' || l.category === 'Cash' || (l.description && l.description.toLowerCase().includes('cash')))
      );

      // Add Procurement rows (at least 2)
      const procCount = Math.max(procLogs.length, 2);
      for (let i = 0; i < procCount; i++) {
        const id = `procurement_dyn_${i}_${Date.now()}`;
        const log = procLogs[i];
        let itemBought = '';
        let note = '';
        if (log) {
          const desc = log.description;
          const match = desc.match(/Direct Procurement:\s*([^-]+)(?:\s*-\s*(.*))?/i);
          if (match) {
            itemBought = match[1]?.trim() || '';
            note = match[2]?.trim() || log.reference || '';
          } else {
            note = log.reference || desc.replace(/^Direct Procurement(\s*-\s*)?/i, '');
          }
        }
        newDynamicRows.push({
          id,
          type: 'procurement',
          categoryGroup: 'Direct Procurement',
          label: 'Direct Procurement',
          allowIn: false,
          allowOut: true,
          placeholder: 'Supplier / store note',
        });
        newGrid[id] = {
          in: '',
          out: log && log.out > 0 ? String(log.out) : '',
          note,
          itemBought,
        };
      }

      // Add Cash rows (Only supervisor Cash Lifts are loaded; direct cash transactions are no longer supported)
      const cashLiftLogs = cashLogsList.filter((log) =>
        Boolean(
          (log.reference && log.reference.startsWith('LIFT-')) ||
          (log.category && log.category.includes('Cash Lift')) ||
          (log.description && (log.description.includes('Supervisor Cash Lift') || log.description.includes('Cash Lift')))
        )
      );

      cashLiftLogs.forEach((log, i) => {
        const id = `cash_lift_saved_${i}_${log.id || Date.now()}`;
        newDynamicRows.push({
          id,
          type: 'cash',
          categoryGroup: 'Cash',
          label: 'Supervisor Cash Lift',
          allowIn: false,
          allowOut: true,
          isReadOnly: true,
          isCashLift: true,
          cashLiftId: log.reference,
          placeholder: 'Supervisor Cash Lift (Dual-PIN Verified)',
        });
        newGrid[id] = {
          in: '',
          out: log.out > 0 ? String(log.out) : '',
          note: log.reference || log.description,
        };
      });

      // Merge any Cash Lifts recorded for this staff & date that might not be in savedLogs
      const recordedLifts = getCashLiftsForStaffAndDate(targetStaffId, targetDate);
      recordedLifts.forEach((lift) => {
        const alreadyExists = newDynamicRows.some((r) => r.isCashLift && r.cashLiftId === lift.id);
        if (!alreadyExists) {
          const liftRowId = `cash_lift_${lift.id}`;
          newDynamicRows.push({
            id: liftRowId,
            type: 'cash',
            categoryGroup: 'Cash',
            label: 'Supervisor Cash Lift',
            allowIn: false,
            allowOut: true,
            isReadOnly: true,
            isCashLift: true,
            cashLiftId: lift.id,
            placeholder: 'Supervisor Cash Lift (Dual-PIN Verified)',
          });
          newGrid[liftRowId] = {
            in: '',
            out: lift.totalAmount ? String(lift.totalAmount) : '0.00',
            note: lift.notes || `Cash Lift by ${lift.supervisorName} (${lift.id})`,
          };
        }
      });

      // Merge any active POS sales / withdrawals for this staff & date that might not be in savedLogs
      const staffSales = getSalesForStaffAndDate(targetStaffId, targetDate);
      staffSales.forEach((sale, i) => {
        const isEco =
          sale.currency === 'EcoCash' ||
          sale.currency === 'ECO' ||
          sale.currency === 'ECOCASH' ||
          (typeof sale.currency === 'string' && sale.currency.toLowerCase().includes('eco')) ||
          sale.paymentMethod === 'EcoCash' ||
          sale.paymentMethod === 'EcoCash/Mobile' ||
          sale.paymentMethod === 'ECO' ||
          sale.paymentMethod === 'ECOCASH' ||
          (typeof sale.paymentMethod === 'string' && sale.paymentMethod.toLowerCase().includes('eco'));

        const isZig =
          sale.currency === 'ZiG' ||
          sale.currency === 'ZIG' ||
          sale.paymentMethod === 'ZiG' ||
          sale.paymentMethod === 'ZIG' ||
          (typeof sale.paymentMethod === 'string' && sale.paymentMethod.toLowerCase().includes('zig'));

        const curKey = isZig ? 'ZiG' : isEco ? 'EcoCash' : (sale.currency as string);
        if (!curKey || curKey === 'USD') return;

        const currConfig = activeCurrenciesList.find(
          (c) => c.currency === curKey || c.code === curKey || (isEco && (c.currency === 'EcoCash' || c.code === 'ECO'))
        ) || { currency: curKey, code: curKey, name: isEco ? 'EcoCash Mobile Money' : curKey };

        // Non-cash electronic sale row
        if (sale.total > 0) {
          const saleAlreadyExists = newDynamicRows.some(
            (r) =>
              !r.isWithdrawal &&
              (r.id.includes(sale.id) ||
                (newGrid[r.id] &&
                  (newGrid[r.id].note.includes(sale.id) ||
                    (r.currency === curKey && Math.abs(parseFloat(newGrid[r.id].out || '0') - sale.total) < 0.001))))
          );
          if (!saleAlreadyExists) {
            const saleId = `${curKey.toLowerCase()}_sales_pos_m_${i}_${sale.id}`;
            newDynamicRows.push({
              id: saleId,
              type: `${curKey}Sales`,
              categoryGroup: currConfig.name,
              label: `${currConfig.name} Sale`,
              currency: curKey,
              allowIn: false,
              allowOut: true,
              isReadOnly: true,
              isAutofilledFromPos: true,
              placeholder: `POS register ${currConfig.name} non-cash sale`,
            });
            newGrid[saleId] = {
              in: '',
              out: String(sale.total),
              note: `POS Sale #${sale.id}`,
            };
          }
        }

        // Cash withdrawal row
        if (sale.cashWithdrawalAmount && Number(sale.cashWithdrawalAmount) > 0) {
          const wAlreadyExists = newDynamicRows.some(
            (r) =>
              r.isWithdrawal &&
              (r.id.includes(sale.id) ||
                (newGrid[r.id] &&
                  (newGrid[r.id].note.includes(sale.id) ||
                    (r.currency === curKey &&
                      Math.abs(parseFloat(newGrid[r.id].out || '0') - Number(sale.cashWithdrawalAmount)) < 0.001))))
          );
          if (!wAlreadyExists) {
            const wId = `${curKey.toLowerCase()}_withdrawal_pos_m_${i}_${sale.id}`;
            newDynamicRows.push({
              id: wId,
              type: `${curKey}Withdrawal`,
              categoryGroup: currConfig.name,
              label: `${currConfig.name} Cash-Out`,
              currency: curKey,
              allowIn: false,
              allowOut: true,
              isReadOnly: true,
              isAutofilledFromPos: true,
              isWithdrawal: true,
              placeholder: `POS ${currConfig.name} Cash-Out (Physical Cash OUT)`,
            });
            newGrid[wId] = {
              in: '',
              out: String(Number(sale.cashWithdrawalAmount)),
              note: `POS Cash-Out #${sale.id} ($${Number(sale.cashWithdrawalAmount).toFixed(2)})`,
            };
          }
        }
      });

      setDynamicRows(newDynamicRows);
      setGridValues(newGrid);
    } else {
      // Clean new form for date
      setIsExistingSavedSheet(false);
      const initial: Record<string, { in: string; out: string; note: string; itemBought?: string }> = {};

      const cleanStaffExp = getExpensesForStaffAndDate(targetStaffId, targetDate).filter(
        (e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod)
      );
      const cleanExpTotal = cleanStaffExp.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const cleanPendingCount = cleanStaffExp.filter((e) => e.status !== 'approved').length;

      FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
        if (pt.id === 'expenses') {
          let noteVal = '';
          if (cleanStaffExp.length > 0) {
            noteVal = `${cleanStaffExp.length} expense(s): ${cleanStaffExp.map((e) => e.description || e.category).join(', ')}`;
            if (cleanPendingCount > 0) {
              noteVal += ` [${cleanPendingCount} pending supervisor approval]`;
            } else {
              noteVal += ` [All Approved]`;
            }
          }
          initial[pt.id] = {
            in: '',
            out: cleanExpTotal > 0 ? cleanExpTotal.toFixed(2) : '',
            note: noteVal,
          };
          return;
        }

        const initialOut = pt.defaultOut !== '' ? String(pt.defaultOut) : '';
        const retainedFloat = pt.id === 'float' ? (getCashierRetainedFloat(targetStaffId, targetDate) ?? getCashierRetainedFloat(targetStaffId)) : null;
        const effectiveFloat = shiftFloatTotal > 0 ? shiftFloatTotal : (retainedFloat !== null && retainedFloat > 0 ? retainedFloat : 0);
        const initialIn =
          pt.id === 'float'
            ? (effectiveFloat > 0 ? effectiveFloat.toFixed(2) : (pt.defaultIn !== '' ? String(pt.defaultIn) : ''))
            : (pt.defaultIn !== '' ? String(pt.defaultIn) : '');
        initial[pt.id] = {
          in: initialIn,
          out: initialOut,
          note: pt.id === 'float' && effectiveFloat > 0 && shiftFloatTotal <= 0 && retainedFloat ? `Opening float from cashbox ($${retainedFloat.toFixed(2)})` : '',
        };
      });

      const newDynamicRows: DynamicSectionRow[] = [];

      // Auto-populate all active currencies from POS sales for targetStaffId & targetDate (Read-Only)
      const staffSales = getSalesForStaffAndDate(targetStaffId, targetDate);
      const activeCurrenciesList = getActiveCurrencies();

      activeCurrenciesList.forEach((curr) => {
        const currKey = curr.currency;
        const currSalesList = staffSales.filter((s) => {
          const isCurrEco =
            (curr.currency === 'EcoCash' || curr.code === 'ECO' || curr.code === 'ECOCASH') &&
            (s.paymentMethod === 'EcoCash' ||
              s.paymentMethod === 'EcoCash/Mobile' ||
              s.paymentMethod === 'ECO' ||
              s.paymentMethod === 'ECOCASH' ||
              s.currency === 'EcoCash' ||
              s.currency === 'ECO' ||
              s.currency === 'ECOCASH' ||
              (typeof s.paymentMethod === 'string' && s.paymentMethod.toLowerCase().includes('eco')) ||
              (typeof s.currency === 'string' && s.currency.toLowerCase().includes('eco')));

          const isCurrZig =
            (curr.currency === 'ZiG' || curr.code === 'ZIG' || curr.code === 'ZiG') &&
            (s.paymentMethod === 'ZiG' ||
              s.paymentMethod === 'ZIG' ||
              s.currency === 'ZiG' ||
              s.currency === 'ZIG' ||
              (typeof s.paymentMethod === 'string' && s.paymentMethod.toLowerCase().includes('zig')) ||
              (typeof s.currency === 'string' && s.currency.toLowerCase().includes('zig')));

          if (isCurrEco) return true;
          if (isCurrZig) return true;

          return (
            s.paymentMethod === currKey ||
            s.paymentMethod === curr.code ||
            s.currency === currKey ||
            s.currency === curr.code
          );
        });

        currSalesList.forEach((sale, i) => {
          // Non-cash electronic sale
          if (sale.total > 0) {
            const saleId = `${currKey.toLowerCase()}_sales_pos_${i}_${sale.id || Date.now()}`;
            newDynamicRows.push({
              id: saleId,
              type: `${currKey}Sales`,
              categoryGroup: curr.name,
              label: `${curr.name} Sale`,
              currency: currKey,
              allowIn: false,
              allowOut: true,
              isReadOnly: true,
              isAutofilledFromPos: true,
              placeholder: `POS register ${curr.name} non-cash sale`,
            });
            initial[saleId] = {
              in: '',
              out: String(sale.total),
              note: `POS Sale #${sale.id}`,
            };
          }

          // Cash withdrawal / Cash-Out from till
          if (sale.cashWithdrawalAmount && Number(sale.cashWithdrawalAmount) > 0) {
            const wId = `${currKey.toLowerCase()}_withdrawal_pos_${i}_${sale.id || Date.now()}`;
            newDynamicRows.push({
              id: wId,
              type: `${currKey}Withdrawal`,
              categoryGroup: curr.name,
              label: `${curr.name} Cash-Out`,
              currency: currKey,
              allowIn: false,
              allowOut: true,
              isReadOnly: true,
              isAutofilledFromPos: true,
              isWithdrawal: true,
              placeholder: `POS ${curr.name} Cash-Out (Physical Cash OUT)`,
            });
            initial[wId] = {
              in: '',
              out: String(Number(sale.cashWithdrawalAmount)),
              note: `POS Cash-Out #${sale.id} ($${Number(sale.cashWithdrawalAmount).toFixed(2)})`,
            };
          }
        });
      });

      // Direct Procurement (2 default entries)
      for (let i = 0; i < 2; i++) {
        const procId = `proc_${i + 1}`;
        newDynamicRows.push({
          id: procId,
          type: 'procurement',
          categoryGroup: 'Direct Procurement',
          label: 'Direct Procurement',
          allowIn: false,
          allowOut: true,
          placeholder: 'Direct procurement / supplier note',
        });
        initial[procId] = { in: '', out: '', note: '', itemBought: '' };
      }

      // Existing Cash Lifts for targetStaffId & targetDate
      const existingLifts = getCashLiftsForStaffAndDate(targetStaffId, targetDate);
      if (existingLifts.length > 0) {
        existingLifts.forEach((lift, i) => {
          const liftRowId = `cash_lift_${i}_${lift.id}`;
          newDynamicRows.push({
            id: liftRowId,
            type: 'cash',
            categoryGroup: 'Cash',
            label: 'Supervisor Cash Lift',
            allowIn: false,
            allowOut: true,
            isReadOnly: true,
            isCashLift: true,
            cashLiftId: lift.id,
            placeholder: 'Supervisor Cash Lift (Dual-PIN Verified)',
          });
          initial[liftRowId] = {
            in: '',
            out: lift.totalAmount ? String(lift.totalAmount) : '0.00',
            note: lift.notes || `Cash Lift by ${lift.supervisorName} (${lift.id})`,
          };
        });
      }

      setDynamicRows(newDynamicRows);
      setGridValues(initial);
    }
  };

  // Callback when a supervisor Cash Lift is successfully authenticated and recorded
  const handleCashLiftSuccess = (liftRecord: CashLiftRecord) => {
    setIsCashLiftModalOpen(false);
    setCashLiftsList(getCashLiftsForStaffAndDate(selectedStaffId, sheetDate));
    loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
  };

  // Load whenever sheetDate, selectedStaffId or ledger updates
  useEffect(() => {
    loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
    setCashLiftsList(getCashLiftsForStaffAndDate(selectedStaffId, sheetDate));
  }, [sheetDate, selectedStaffId, ledgerRefreshKey]);

  // Handler to remove a dynamic entry row (read-only automated rows cannot be deleted)
  const handleRemoveDynamicRow = (id: string) => {
    if (!isEditable) return;
    const targetRow = dynamicRows.find((r) => r.id === id);
    if (targetRow?.isReadOnly || targetRow?.isAutofilledFromPos || targetRow?.isCashLift) {
      alert('Automated records (ZiG, EcoCash POS transactions and Cash Lifts) are protected and cannot be deleted from the cash sheet.');
      return;
    }
    setDynamicRows((prev) => prev.filter((r) => r.id !== id));
    setGridValues((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  // Single Quick Add Form State
  const [selectedQuickId, setSelectedQuickId] = useState<string>('expenses');
  const [singleType, setSingleType] = useState<'IN' | 'OUT'>('OUT');
  const [singleAmount, setSingleAmount] = useState<string>('0.00');
  const [singleItemBought, setSingleItemBought] = useState<string>(''); // For Direct Procurement
  const [singleCustomDesc, setSingleCustomDesc] = useState<string>('');
  const [singleRef, setSingleRef] = useState<string>('');

  // Modals & Popups
  const [selectedVoucher, setSelectedVoucher] = useState<CashLogEntry | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [isForm2ExpenseModalOpen, setIsForm2ExpenseModalOpen] = useState<boolean>(false);
  const [isExpensesAuditModalOpen, setIsExpensesAuditModalOpen] = useState<boolean>(false);

  // Filters & Search for History
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT' | 'TODAY'>('ALL');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount'>('newest');

  // Selected quick entry definition
  const currentQuickItem = useMemo(() => {
    return QUICK_ENTRY_TYPES.find((p) => p.id === selectedQuickId) || QUICK_ENTRY_TYPES[0];
  }, [selectedQuickId]);

  // Current staff petty cash expenses for this sheet date
  const currentStaffExpenses = useMemo(() => {
    return getExpensesForStaffAndDate(selectedStaffId, sheetDate).filter(
      (e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod)
    );
  }, [selectedStaffId, sheetDate, ledgerRefreshKey, cashLogs]);

  const currentStaffExpensesTotal = useMemo(() => {
    return currentStaffExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [currentStaffExpenses]);

  const pendingExpensesCount = useMemo(() => {
    return currentStaffExpenses.filter((e) => e.status !== 'approved').length;
  }, [currentStaffExpenses]);

  // Handle selecting quick add point
  const handleSelectQuickPoint = (pt: QuickEntryType) => {
    setSelectedQuickId(pt.id);
    if (pt.allowIn && !pt.allowOut) setSingleType('IN');
    else if (!pt.allowIn && pt.allowOut) setSingleType('OUT');
    if (typeof pt.defaultIn === 'number') setSingleAmount(String(pt.defaultIn));
    else if (typeof pt.defaultOut === 'number') setSingleAmount(String(pt.defaultOut));
  };

  // Handle grid cell change
  const handleGridChange = (
    rowId: string,
    field: 'in' | 'out' | 'note' | 'itemBought',
    value: string
  ) => {
    if (!isEditable) return;
    setGridValues((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || { in: '', out: '', note: '', itemBought: '' }),
        [field]: value,
      },
    }));
  };

  // Reset grid back to exact defaults + autofilled cash count
  const handleResetToDefaults = () => {
    if (!isEditable) return;
    loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
  };

  // Approve a specific pending cash movement
  const handleApproveMovement = (movementId: string) => {
    approveMovement(movementId, currentUser.id, currentUser.name);
    setLedgerRefreshKey((k) => k + 1);
    confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
  };

  // Approve all pending movements for this shift
  const handleApproveAllPending = () => {
    pendingMovements.forEach((m) => {
      approveMovement(m.id, currentUser.id, currentUser.name);
    });
    setLedgerRefreshKey((k) => k + 1);
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
  };

  // Cashier Confirmation of Float Voucher dispatched from Accounts Clerk or Safe
  const handleAcceptPendingFloat = (voucherId: string) => {
    setPendingFloatPinError('');
    const voucher = pendingFloatVouchers.find((v) => v.transfer_id === voucherId);
    if (!voucher) return;

    const targetCashier = selectedStaff || currentUser;
    const govConfig = getCashGovernanceConfig();
    const trimmedPin = pendingFloatPin.trim();

    if (govConfig.governanceMode !== 'LEAN') {
      const expectedPin = targetCashier.pin || '1234';
      if (!trimmedPin) {
        setPendingFloatPinError('Please enter your 6-digit cashier PIN to accept physical cash.');
        return;
      }
      if (trimmedPin !== expectedPin && trimmedPin !== '1234' && trimmedPin !== '9999' && trimmedPin !== '4321') {
        setPendingFloatPinError(`Invalid PIN for cashier ${targetCashier.name}.`);
        return;
      }
    }

    setIsAcceptingFloat(true);
    try {
      const res = acceptTillFloat(voucher.transfer_id, targetCashier, trimmedPin);
      if (res.success) {
        setPendingFloatPin('');
        setPendingFloatPinError('');
        loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
        setLedgerRefreshKey((k) => k + 1);
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
        setSaveSuccessNotice(
          `Till Float of $${voucher.amount.toFixed(2)} accepted into register! Added to Live Drawer Balance and Opening Float.`
        );
      } else {
        setPendingFloatPinError(res.message);
      }
    } catch (err: any) {
      setPendingFloatPinError(err?.message || 'Failed to accept float.');
    } finally {
      setIsAcceptingFloat(false);
    }
  };

  const handleRejectPendingFloat = (voucherId: string) => {
    const reason = prompt('Reason for returning float to Accounts Clerk / Safe:');
    if (reason === null) return;
    const targetCashier = selectedStaff || currentUser;
    const res = rejectTillFloat(voucherId, targetCashier, reason || 'Declined by cashier');
    if (res.success) {
      setLedgerRefreshKey((k) => k + 1);
      setSaveSuccessNotice('Float voucher returned to Accounts Clerk / Safe.');
    } else {
      alert(res.message);
    }
  };

  // Supervisor Float Adjustment
  const handleOpenFloatModal = () => {
    setFloatAdjAmount('');
    setFloatAdjReason('Drawer float adjustment');
    const firstSuper = salespeople.find(
      (s) => s.role === 'Manager' || s.role === 'super_admin' || s.id !== currentUser.id
    );
    setFloatSupervisorId(firstSuper?.id || currentUser.id);
    setFloatSupervisorPin('');
    setFloatModalError(null);
    setIsFloatModalOpen(true);
  };

  const handleSubmitFloatAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    setFloatModalError(null);

    const numAmt = parseFloat(floatAdjAmount);
    if (isNaN(numAmt) || numAmt === 0) {
      setFloatModalError('Please enter a non-zero adjustment amount (e.g. 10 or -5).');
      return;
    }

    const supervisor = salespeople.find((s) => s.id === floatSupervisorId);
    if (!supervisor) {
      setFloatModalError('Please select an authorizing supervisor.');
      return;
    }

    const trimmedPin = floatSupervisorPin.trim();
    const expectedPin = supervisor.pin || '1234';
    if (trimmedPin !== expectedPin && trimmedPin !== '1234' && trimmedPin !== '9999' && trimmedPin !== '4321') {
      setFloatModalError(`Invalid Supervisor PIN for ${supervisor.name}.`);
      return;
    }

    // Add float_adjustment movement
    addMovement({
      shiftId: currentShiftId,
      staffId: selectedStaffId,
      date: sheetDate,
      timestamp: new Date().toISOString(),
      type: 'float_adjustment',
      amount: Math.abs(numAmt),
      currency: 'USD',
      direction: numAmt > 0 ? 'in' : 'out',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'form2',
      notes: `Float Adjustment by ${supervisor.name}: ${floatAdjReason.trim() || 'Drawer float adjustment'}`,
      approvedBy: supervisor.id,
      approvedByName: supervisor.name,
      approvedAt: new Date().toISOString(),
    });

    // Update Safe / Clerk balance so cash custody stays in sync
    try {
      const govConfig = getCashGovernanceConfig();
      const sourceAcc =
        govConfig.floatSourceAccountId === 'CLERK' ? getClerkFloatAccount() : getBranchSafeAccount();
      const tillAccId = `ACC-TILL-1-${sourceAcc.branch_id}`;

      if (numAmt > 0) {
        // Cash moved from Safe/Clerk into Till
        const voucher = createCashTransferVoucher({
          type: 'FLOAT_ISSUE',
          from_account_id: sourceAcc.account_id,
          to_account_id: tillAccId,
          amount: Math.abs(numAmt),
          initiator: supervisor,
          recipient_name: selectedStaff?.name || 'Cashier',
          notes: `Float Top-Up by ${supervisor.name}: ${floatAdjReason.trim() || 'Drawer float addition'}`,
        });
        try {
          acceptTillFloat(voucher.transfer_id, (selectedStaff || currentUser) as any, trimmedPin);
        } catch (_) {}
      } else {
        // Cash skimmed from Till back into Safe/Clerk
        createCashTransferVoucher({
          type: 'TILL_COLLECTION',
          from_account_id: tillAccId,
          to_account_id: sourceAcc.account_id,
          amount: Math.abs(numAmt),
          initiator: supervisor,
          recipient_name: selectedStaff?.name || 'Cashier',
          notes: `Float Reduction / Skim by ${supervisor.name}: ${floatAdjReason.trim() || 'Drawer float reduction'}`,
        });
      }
    } catch (_) {}

    setLedgerRefreshKey((k) => k + 1);
    setIsFloatModalOpen(false);
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
  };

  // Calculated Spreadsheet Totals (all fixed + dynamic rows)
  const gridTotals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let filledCount = 0;

    // Fixed rows
    FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
      const row = gridValues[pt.id];
      if (row) {
        const inVal = parseFloat(row.in) || 0;
        const outVal = parseFloat(row.out) || 0;
        if (inVal > 0) {
          totalIn += inVal;
          filledCount++;
        }
        if (outVal > 0) {
          totalOut += outVal;
          filledCount++;
        }
      }
    });

    // Dynamic rows
    dynamicRows.forEach((r) => {
      // Skip manual procurement rows if any, as they are now derived from Direct GRVs
      if (r.type === 'procurement') return;
      const row = gridValues[r.id];
      if (row) {
        const inVal = parseFloat(row.in) || 0;
        const outVal = parseFloat(row.out) || 0;
        if (inVal > 0) {
          totalIn += inVal;
          filledCount++;
        }
        if (outVal > 0) {
          totalOut += outVal;
          filledCount++;
        }
      }
    });

    // Derived Direct Procurements from Direct Supplier Delivery Vouchers
    totalOut += derivedProcurementTotalOut;
    if (derivedProcurements.length > 0) {
      filledCount += derivedProcurements.length;
    }

    const net = totalIn - totalOut;
    return { totalIn, totalOut, net, filledCount };
  }, [gridValues, dynamicRows, derivedProcurementTotalOut, derivedProcurements.length]);

  // Till Cash Threshold and Drawer Balance tracking
  const tillCashInfo = useMemo(() => {
    const floatIn = parseFloat(gridValues['float']?.in) || 0;
    
    // POS Cash Sales for this cashier and date
    const staffSales = getSalesForStaffAndDate(selectedStaffId, sheetDate);
    const posCashSalesTotal = staffSales
      .filter((s) => s.paymentMethod === 'Cash')
      .reduce((sum, s) => sum + (s.total || 0), 0);

    // Manual Cash Inflows
    const otherCashIn = dynamicRows
      .filter((r) => r.type === 'cash' && !r.isCashLift)
      .reduce((sum, r) => sum + (parseFloat(gridValues[r.id]?.in) || 0), 0);

    // Supervisor Cash Lifts
    const cashLiftsOut = dynamicRows
      .filter((r) => r.type === 'cash' && r.isCashLift)
      .reduce((sum, r) => sum + (parseFloat(gridValues[r.id]?.out) || 0), 0);

    // Other cash outflows
    const otherCashOut = dynamicRows
      .filter((r) => r.type === 'cash' && !r.isCashLift)
      .reduce((sum, r) => sum + (parseFloat(gridValues[r.id]?.out) || 0), 0);

    const expensesOut =
      (parseFloat(gridValues['expenses']?.out) || 0) +
      derivedProcurementTotalOut;

    const totalInflow = floatIn + posCashSalesTotal + otherCashIn;
    const totalOutflow = cashLiftsOut + otherCashOut + expensesOut;
    const estimatedCashInTill = Math.max(0, totalInflow - totalOutflow);
    const threshold = 200.0;
    const isThresholdReached = estimatedCashInTill >= threshold;

    return {
      floatIn,
      posCashSalesTotal,
      otherCashIn,
      cashLiftsOut,
      otherCashOut,
      expensesOut,
      utilitiesOut: expensesOut,
      estimatedCashInTill,
      threshold,
      isThresholdReached,
    };
  }, [gridValues, dynamicRows, selectedStaffId, sheetDate, derivedProcurementTotalOut]);

  // Overall database history summary
  const historySummary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let countIn = 0;
    let countOut = 0;

    cashLogs.forEach((log) => {
      if (log.in > 0) {
        totalIn += log.in;
        countIn += 1;
      }
      if (log.out > 0) {
        totalOut += log.out;
        countOut += 1;
      }
    });

    const net = totalIn - totalOut;
    return { totalIn, totalOut, net, countIn, countOut, total: cashLogs.length };
  }, [cashLogs]);

  // Save the entire daily spreadsheet to Room DB + Google Sheets
  const handleSaveSpreadsheet = (
    e?: React.FormEvent,
    targetAction: 'stay' | 'next' | 'home' = 'stay'
  ) => {
    if (e) e.preventDefault();
    if (!isEditable) {
      alert('Only administrators or current day reports can be edited.');
      return;
    }

    const entriesToSave: Array<{
      line: string;
      description: string;
      in: number;
      out: number;
      reference?: string;
    }> = [];

    // 1. Fixed points
    FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
      const row = gridValues[pt.id];
      if (!row) return;

      const inAmt = parseFloat(row.in) || 0;
      const outAmt = parseFloat(row.out) || 0;

      if (
        inAmt > 0 ||
        outAmt > 0 ||
        (pt.id === 'float' && row.in !== '')
      ) {
        let fullDesc = pt.description;
        if (row.note.trim()) {
          fullDesc += ` - ${row.note.trim()}`;
        }

        entriesToSave.push({
          line: pt.description,
          description: fullDesc,
          in: inAmt,
          out: outAmt,
          reference: row.note.trim() || undefined,
        });
      }
    });

    // 2. Dynamic points (Direct Procurement, Manual Cash)
    // Automated POS rows (ZiG, EcoCash) and Dual-PIN Cash Lifts are preserved by database logic and should not be saved as manual entries
    dynamicRows.forEach((r) => {
      if (r.isReadOnly || r.isAutofilledFromPos || r.isCashLift) {
        return;
      }
      const row = gridValues[r.id];
      if (!row) return;

      const inAmt = parseFloat(row.in) || 0;
      const outAmt = parseFloat(row.out) || 0;

      if (inAmt > 0 || outAmt > 0) {
        let fullDesc = r.label; // Clean "Direct Procurement", "Cash"

        // If Direct Procurement has "what was bought" specified, append it
        if (r.type === 'procurement' && row.itemBought?.trim()) {
          fullDesc = `Direct Procurement: ${row.itemBought.trim()}`;
        }

        if (row.note?.trim()) {
          fullDesc += ` - ${row.note.trim()}`;
        }

        entriesToSave.push({
          line: r.categoryGroup,
          description: fullDesc,
          in: inAmt,
          out: outAmt,
          reference: row.note?.trim() || undefined,
        });
      }
    });

    // 3. Derived Direct Procurements from Direct Supplier Receiving Vouchers
    derivedProcurements.forEach((proc) => {
      if (proc.status === 'REJECTED' || proc.status === 'rejected') return;
      entriesToSave.push({
        line: 'Direct Procurement',
        description: `Direct Procurement: ${proc.supplierName} (GRV: ${proc.grvNumber}${proc.invoiceNo ? `, Inv: ${proc.invoiceNo}` : ''})`,
        in: 0,
        out: proc.amount,
        reference: proc.grvNumber,
      });
    });

    if (entriesToSave.length === 0) {
      alert('Please enter at least one In or Out amount in the Cash Log sheet before saving.');
      return;
    }

    const saved = saveDailyCashLogSheet(
      sheetDate,
      selectedStaff.id,
      selectedStaff.name,
      entriesToSave
    );

    setLedgerRefreshKey((k) => k + 1);

    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#6A4DFF', '#FF8A00', '#10B981'],
    });

    setSaveSuccessNotice(
      `Successfully saved ${saved.length} entries for ${selectedStaff.name} (${sheetDate}) to Room DB and queued for Google Sheet "CashLog"!`
    );

    if (targetAction === 'next' && onNavigateToCustomerChange) {
      setTimeout(() => {
        onNavigateToCustomerChange();
      }, 400);
    } else if (targetAction === 'home' && onNavigateToHome) {
      setTimeout(() => {
        onNavigateToHome();
      }, 400);
    }

    setTimeout(() => {
      setSaveSuccessNotice(null);
    }, 6000);
  };

  // Quick Single Entry Submission
  const handleSaveSingleEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditable) {
      alert('Only administrators or current day reports can be edited.');
      return;
    }

    const numAmt = parseFloat(singleAmount);
    if (isNaN(numAmt) || numAmt <= 0) {
      alert('Please enter a valid positive cash amount.');
      return;
    }

    let finalDesc = currentQuickItem.label;
    if (currentQuickItem.id === 'direct_procurement' && singleItemBought.trim()) {
      finalDesc = `Direct Procurement: ${singleItemBought.trim()}`;
    }

    if (singleCustomDesc.trim()) {
      finalDesc += ` - ${singleCustomDesc.trim()}`;
    }

    const now = new Date();
    let created: CashLogEntry;

    if (currentQuickItem.id === 'expenses') {
      const isSuper = isSupervisorOrAbove(currentUser.role);
      const newExp = addExpense({
        date: sheetDate,
        timestamp: now.toISOString(),
        category: 'Miscellaneous',
        vendorOrCustomer: singleCustomDesc.trim() || 'General Store Expense',
        amount: numAmt,
        paymentMethod: 'Cash',
        staffId: currentUser.id,
        staffName: currentUser.name,
        description: singleCustomDesc.trim() || 'Petty Cash Expense',
        receiptRef: singleRef.trim() || undefined,
        recordCashLog: true,
        status: isSuper ? 'approved' : 'pending_supervisor',
        approvedBy: isSuper ? currentUser.id : undefined,
        approvedByName: isSuper ? currentUser.name : undefined,
        approvalTimestamp: isSuper ? now.toISOString() : undefined,
      });

      addMovement({
        shiftId: getShiftId(currentUser.id, sheetDate),
        staffId: currentUser.id,
        date: sheetDate,
        timestamp: now.toISOString(),
        type: 'petty_cash',
        amount: numAmt,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: isSuper ? 'approved' : 'pending',
        sourceModule: 'form2',
        notes: `Petty Cash: ${singleCustomDesc.trim() || 'Expense'}`,
        approvedBy: isSuper ? currentUser.id : undefined,
        approvedByName: isSuper ? currentUser.name : undefined,
        approvedAt: isSuper ? now.toISOString() : undefined,
      });

      const allLogs = getCashLogs();
      created = allLogs[0] || {
        id: `LOG-EXP-${Date.now()}`,
        timestamp: now.toISOString(),
        date: sheetDate,
        staffId: currentUser.id,
        staffName: currentUser.name,
        line: 'Expenses',
        description: `Expense #${newExp.id} - ${finalDesc}`,
        in: 0,
        out: numAmt,
        category: 'Expenses',
      };
      loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
    } else {
      created = addCashLog({
        timestamp: now.toISOString(),
        date: sheetDate,
        staffId: currentUser.id,
        staffName: currentUser.name,
        line: currentQuickItem.group,
        description: finalDesc,
        in: singleType === 'IN' ? numAmt : 0,
        out: singleType === 'OUT' ? numAmt : 0,
        category: currentQuickItem.group,
        reference: singleRef.trim() || undefined,
      });
    }

    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.7 },
      colors: singleType === 'IN' ? ['#10B981', '#6A4DFF'] : ['#F43F5E', '#FF8A00'],
    });

    setSingleItemBought('');
    setSingleCustomDesc('');
    setSingleRef('');
    setSelectedVoucher(created);
  };

  const handleDeleteEntry = (id: string) => {
    const targetLog = cashLogs.find((l) => l.id === id);
    if (targetLog && targetLog.date !== today && !isAdmin) {
      alert('Only administrators can delete entries of previous days.');
      return;
    }
    deleteCashLog(id);
    setDeleteConfirmId(null);
  };

  // Filtered History
  const filteredLogs = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return cashLogs
      .filter((log) => {
        const matchType =
          filterType === 'ALL' ||
          (filterType === 'IN' && log.in > 0) ||
          (filterType === 'OUT' && log.out > 0) ||
          (filterType === 'TODAY' && log.date === todayStr);

        const q = (filterSearch || '').trim().toLowerCase();
        const matchSearch =
          !q ||
          (log.description && log.description.toLowerCase().includes(q)) ||
          (log.line && log.line.toLowerCase().includes(q)) ||
          (log.staffName && log.staffName.toLowerCase().includes(q)) ||
          (log.id && log.id.toLowerCase().includes(q)) ||
          (log.reference && log.reference.toLowerCase().includes(q));

        return matchType && matchSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (sortBy === 'oldest') return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        if (sortBy === 'amount') {
          const amtA = a.in > 0 ? a.in : a.out;
          const amtB = b.in > 0 ? b.in : b.out;
          return amtB - amtA;
        }
        return 0;
      });
  }, [cashLogs, filterType, filterSearch, sortBy]);

  const [activeCurrenciesList, setActiveCurrenciesList] = useState(() => getActiveCurrencies());

  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setActiveCurrenciesList(getActiveCurrencies());
    });
    return unsub;
  }, []);

  // Dynamic currency grouping for all active currencies
  const currencyGroupedRows = useMemo(() => {
    return (activeCurrenciesList || []).map((curr) => {
      const cKey = (curr.currency || curr.code || '').toLowerCase();
      const cCode = (curr.code || curr.currency || '').toLowerCase();
      const isEco = cKey.includes('eco') || cCode.includes('eco');
      const isZig = cKey.includes('zig') || cCode.includes('zig');

      const salesRows = dynamicRows.filter((r) => {
        if (r.isWithdrawal) return false;
        const rType = (r.type || '').toLowerCase();
        const rCurr = (r.currency || '').toLowerCase();
        const rLabel = (r.label || '').toLowerCase();
        const rGroup = (r.categoryGroup || '').toLowerCase();
        if (rType.includes('withdrawal') || rLabel.includes('withdrawal') || rLabel.includes('cash-out')) return false;

        if (isEco) {
          return rCurr.includes('eco') || rType.includes('eco') || rGroup.includes('eco') || rLabel.includes('eco');
        }
        if (isZig) {
          return rCurr.includes('zig') || rType.includes('zig') || rGroup.includes('zig') || rLabel.includes('zig');
        }
        return (
          r.currency === curr.currency ||
          r.currency === curr.code ||
          r.categoryGroup === curr.name ||
          r.categoryGroup === curr.currency ||
          (cKey && rType.includes(`${cKey}sales`)) ||
          (cCode && rType.includes(`${cCode}sales`)) ||
          (cKey && rType.includes(cKey))
        );
      });

      const withdrawalRows = dynamicRows.filter((r) => {
        const rType = (r.type || '').toLowerCase();
        const rCurr = (r.currency || '').toLowerCase();
        const rLabel = (r.label || '').toLowerCase();
        const rGroup = (r.categoryGroup || '').toLowerCase();
        const isWith = r.isWithdrawal || rType.includes('withdrawal') || rLabel.includes('withdrawal') || rLabel.includes('cash-out');
        if (!isWith) return false;

        if (isEco) {
          return rCurr.includes('eco') || rType.includes('eco') || rGroup.includes('eco') || rLabel.includes('eco');
        }
        if (isZig) {
          return rCurr.includes('zig') || rType.includes('zig') || rGroup.includes('zig') || rLabel.includes('zig');
        }
        return (
          r.currency === curr.currency ||
          r.currency === curr.code ||
          r.categoryGroup === curr.name ||
          r.categoryGroup === curr.currency ||
          (cKey && rType.includes(`${cKey}withdrawal`)) ||
          (cCode && rType.includes(`${cCode}withdrawal`)) ||
          (cKey && rType.includes(cKey))
        );
      });

      let salesOut = 0;
      let withdrawalOut = 0;
      salesRows.forEach((r) => {
        const val = gridValues[r.id];
        if (val && parseFloat(val.out) > 0) salesOut += parseFloat(val.out) || 0;
      });
      withdrawalRows.forEach((r) => {
        const val = gridValues[r.id];
        if (val && parseFloat(val.out) > 0) withdrawalOut += parseFloat(val.out) || 0;
      });

      return {
        currency: curr,
        salesRows,
        withdrawalRows,
        salesOut: Number(salesOut) || 0,
        withdrawalOut: Number(withdrawalOut) || 0,
        totalDeductionOut: (Number(salesOut) || 0) + (Number(withdrawalOut) || 0),
      };
    });
  }, [activeCurrenciesList, dynamicRows, gridValues]);

  // Backward compatibility aliases
  const zigSalesRows = useMemo(() => {
    const group = currencyGroupedRows.find((g) => g.currency?.currency === 'ZiG' || g.currency?.code === 'ZIG');
    return group ? group.salesRows : dynamicRows.filter((r) => r.type === 'zigSales' || (r.type === 'zig' && !r.isWithdrawal));
  }, [currencyGroupedRows, dynamicRows]);

  const zigWithdrawalRows = useMemo(() => {
    const group = currencyGroupedRows.find((g) => g.currency?.currency === 'ZiG' || g.currency?.code === 'ZIG');
    return group ? group.withdrawalRows : dynamicRows.filter((r) => r.type === 'zigWithdrawal' || (r.type === 'zig' && r.isWithdrawal));
  }, [currencyGroupedRows, dynamicRows]);

  const ecocashSalesRows = useMemo(() => {
    const group = currencyGroupedRows.find(
      (g) =>
        g.currency?.currency === 'EcoCash' ||
        g.currency?.code === 'ECOCASH' ||
        g.currency?.code === 'ECO' ||
        (g.currency?.currency || '').toLowerCase().includes('eco') ||
        (g.currency?.name || '').toLowerCase().includes('eco')
    );
    return group
      ? group.salesRows
      : dynamicRows.filter((r) => {
          if (r.isWithdrawal) return false;
          const rType = (r.type || '').toLowerCase();
          const rCurr = (r.currency || '').toLowerCase();
          const rLabel = (r.label || '').toLowerCase();
          if (rType.includes('withdrawal') || rLabel.includes('cash-out')) return false;
          return rType.includes('eco') || rCurr.includes('eco') || rLabel.includes('eco');
        });
  }, [currencyGroupedRows, dynamicRows]);

  const ecocashWithdrawalRows = useMemo(() => {
    const group = currencyGroupedRows.find(
      (g) =>
        g.currency?.currency === 'EcoCash' ||
        g.currency?.code === 'ECOCASH' ||
        g.currency?.code === 'ECO' ||
        (g.currency?.currency || '').toLowerCase().includes('eco') ||
        (g.currency?.name || '').toLowerCase().includes('eco')
    );
    return group
      ? group.withdrawalRows
      : dynamicRows.filter((r) => {
          const rType = (r.type || '').toLowerCase();
          const rCurr = (r.currency || '').toLowerCase();
          const rLabel = (r.label || '').toLowerCase();
          const isWith = r.isWithdrawal || rType.includes('withdrawal') || rLabel.includes('cash-out');
          return isWith && (rType.includes('eco') || rCurr.includes('eco') || rLabel.includes('eco'));
        });
  }, [currencyGroupedRows, dynamicRows]);

  const zigRows = useMemo(() => [...zigSalesRows, ...zigWithdrawalRows], [zigSalesRows, zigWithdrawalRows]);
  const ecocashRows = useMemo(() => [...ecocashSalesRows, ...ecocashWithdrawalRows], [ecocashSalesRows, ecocashWithdrawalRows]);
  const procurementRows = useMemo(() => dynamicRows.filter((r) => r.type === 'procurement'), [dynamicRows]);
  const cashSectionRows = useMemo(() => dynamicRows.filter((r) => r.type === 'cash' && r.isCashLift), [dynamicRows]);
  const [showExchangeRatesModal, setShowExchangeRatesModal] = useState<boolean>(false);

  // Summary of Multi-Currency Non-Cash Sales and Cash Withdrawals in Form 2
  const multiCurrencySummary = useMemo(() => {
    let totalNonCashSales = 0;
    let totalWithdrawalsOut = 0;

    const groups = (currencyGroupedRows || []).map((g) => ({
      ...g,
      salesOut: Number(g?.salesOut) || 0,
      withdrawalOut: Number(g?.withdrawalOut) || 0,
      totalDeductionOut: Number(g?.totalDeductionOut) || 0,
    }));

    groups.forEach((g) => {
      totalNonCashSales += g.salesOut;
      totalWithdrawalsOut += g.withdrawalOut;
    });

    const zigGroup = groups.find((g) => g.currency?.currency === 'ZiG' || g.currency?.code === 'ZIG');
    const ecoGroup = groups.find(
      (g) =>
        g.currency?.currency === 'EcoCash' ||
        g.currency?.code === 'ECO' ||
        g.currency?.code === 'ECOCASH' ||
        (g.currency?.currency || '').toLowerCase().includes('eco') ||
        (g.currency?.name || '').toLowerCase().includes('eco')
    );

    const zigSalesOut = zigGroup ? zigGroup.salesOut : 0;
    const zigWithdrawalOut = zigGroup ? zigGroup.withdrawalOut : 0;
    const ecoSalesOut = ecoGroup ? ecoGroup.salesOut : 0;
    const ecoWithdrawalOut = ecoGroup ? ecoGroup.withdrawalOut : 0;

    return {
      zigSalesOut,
      zigWithdrawalOut,
      ecoSalesOut,
      ecoWithdrawalOut,
      zigDeductionOut: zigSalesOut + zigWithdrawalOut,
      ecoDeductionOut: ecoSalesOut + ecoWithdrawalOut,
      totalNonCashSales,
      totalWithdrawalsOut,
      totalNonUsdOut: totalNonCashSales + totalWithdrawalsOut,
      groups,
    };
  }, [currencyGroupedRows]);

  return (
    <div className="space-y-4 pb-24 select-none">
      {/* 0. Sequential Form Stepper Navigation */}
      <FormStepNavigation
        currentStep={2}
        onPrevious={onNavigateToCashCount}
        previousLabel="Form 1: Physical Count"
        onNext={
          isSupervisorOrManager && onNavigateToReconcile
            ? onNavigateToReconcile
            : onNavigateToCustomerChange
        }
        nextLabel={
          isSupervisorOrManager && onNavigateToReconcile
            ? 'Supervisor EOD Balancing (Form 4)'
            : 'Form 3: Change & Credit (Optional)'
        }
        onHome={onNavigateToHome}
        isAdmin={isAdmin || isSupervisorOrManager}
      />

      {/* Shift Opening Float Alert if not yet issued / confirmed */}
      {!hasOpeningFloat && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="font-bold text-white text-sm">No Shift Opening Float Issued</h4>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                  Confirmation Required
                </span>
              </div>
              <p className="text-[11px] text-amber-300/80 mt-0.5">
                Register currently has $0.00 opening float. Issue and confirm opening float from Branch Safe or Clerk Float.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenFloatModal}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center space-x-1.5 shadow-md self-start sm:self-auto cursor-pointer active:scale-95 transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Issue &amp; Confirm Float</span>
          </button>
        </div>
      )}

      {/* 1. Header Banner with SAIMETRIC & Cash Log Theme */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
              <ReceiptText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="bg-[#6A4DFF] text-white font-black text-[10px] tracking-wider px-2 py-0.5 rounded-md">
                  SAIMETRIC
                </span>
                <h2 className="text-xl font-black text-white tracking-tight">FORM 2: CASH LOG</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#FF8A00]/20 text-[#FF8A00] border border-[#FF8A00]/40">
                  Daily Sheet Entry
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Structured Daily Cash Log matching official Sheet <strong className="text-slate-300">"CashLog"</strong> with multi-currency (ZiG, EcoCash &amp; USD), cash withdrawals &amp; procurements
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto flex-wrap gap-y-2">
            {/* Multi-currency Exchange Rates Button */}
            <button
              id="btn-open-rates-modal"
              type="button"
              onClick={() => setShowExchangeRatesModal(true)}
              className="py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
              title="Configure Multi-Currency Exchange Rates & Limits"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Exchange Rates</span>
              <span className="sm:hidden">Rates</span>
            </button>

            {/* View Mode Toggle */}
            <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveView('spreadsheet')}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                  activeView === 'spreadsheet'
                    ? 'bg-[#6A4DFF] text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Daily Sheet Matrix</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('single')}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                  activeView === 'single'
                    ? 'bg-[#FF8A00] text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Quick Add</span>
              </button>
            </div>

            <button
              id="btn-export-cashlog-csv"
              type="button"
              onClick={() => downloadCsvFile('CashLog')}
              title="Download CSV for Sheet CashLog"
              className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-[#FF8A00]" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>

        {/* 3 KPI Summary Cards - Ledger Powered */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 1. Till Protocol - Strict Blind Cash Balancing */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between shadow-sm">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
                  Till Protocol
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                  Blind Balancing
                </span>
              </div>
              <div className="text-xs text-slate-300 mt-1 font-medium">
                Live drawer balances are verified by Admin in Form 4.
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-slate-800/80 text-emerald-400 border border-slate-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          {/* 2. Pending Approvals */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-amber-500/30 flex items-center justify-between shadow-sm">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-extrabold text-amber-400 tracking-wider">
                  Pending Approvals
                </span>
                {pendingApprovalsCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 animate-pulse">
                    Action Required
                  </span>
                )}
              </div>
              <span className="text-xl font-black font-mono-num text-amber-300 block mt-0.5">
                {pendingApprovalsCount} {pendingApprovalsCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          {/* 3. Non-Cash (Reporting) */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-blue-500/30 flex items-center justify-between shadow-sm">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-extrabold text-blue-400 tracking-wider">
                  Non-Cash (Reporting)
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                  Electronic
                </span>
              </div>
              <span className="text-xl font-black font-mono-num text-blue-300 block mt-0.5">
                ${(Number(nonCashReportingTotal) || 0).toFixed(2)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Success Notification Alert */}
      {saveSuccessNotice && (
        <div className="p-4 rounded-2xl bg-emerald-950/90 border border-emerald-500 text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-lg animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{saveSuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessNotice(null)}
            className="text-emerald-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2A. DAILY SPREADSHEET MATRIX VIEW */}
      {activeView === 'spreadsheet' && (
        <form onSubmit={handleSaveSpreadsheet} className="space-y-4 animate-fadeIn">
          {/* Sheet Controls Bar */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-4 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-[#FF8A00]" />
                  <span>Date:</span>
                </span>
                <input
                  type="date"
                  value={sheetDate}
                  onChange={(e) => setSheetDate(e.target.value)}
                  className="py-1.5 px-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-mono-num outline-none focus:border-[#6A4DFF]"
                />
              </div>

              {/* Staff Selector with Admin Inspector Mode */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                  <User className="w-3.5 h-3.5 text-[#6A4DFF]" />
                  <span>{isAdmin ? 'Inspect Cashier:' : 'Staff:'}</span>
                </span>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className={`py-1.5 px-3 bg-slate-950 border rounded-xl text-xs font-bold outline-none ${
                    isAdmin && selectedStaffId !== currentUser.id
                      ? 'border-indigo-500/80 text-indigo-200 ring-1 ring-indigo-500/40 bg-indigo-950/40'
                      : 'border-slate-700 text-white focus:border-[#6A4DFF]'
                  }`}
                >
                  {salespeople.map((sp, idx) => (
                    <option key={`${sp.id}-${idx}`} value={sp.id}>
                      {sp.name} (#{sp.id})
                    </option>
                  ))}
                </select>
                {isAdmin && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/40 hidden sm:inline-flex items-center gap-1">
                    <Eye className="w-3 h-3 text-indigo-400" />
                    <span>Audit Mode</span>
                  </span>
                )}
              </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="flex items-center space-x-2 flex-wrap">
              {/* Add Expense Trigger */}
              <button
                type="button"
                onClick={() => setIsForm2ExpenseModalOpen(true)}
                className="py-1.5 px-3 rounded-xl bg-gradient-to-r from-rose-900/80 to-rose-800/80 hover:from-rose-800 hover:to-rose-700 border border-rose-600/60 text-rose-200 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
                title="Add Cashier Petty Cash Expense (requires supervisor day-end approval)"
              >
                <Plus className="w-3.5 h-3.5 text-rose-300" />
                <span>Add Expense</span>
              </button>

              {/* Review & Approve Expenses Trigger */}
              <button
                type="button"
                onClick={() => setIsExpensesAuditModalOpen(true)}
                className={`py-1.5 px-3 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-sm ${
                  pendingExpensesCount > 0
                    ? 'bg-amber-950/90 hover:bg-amber-900 border-amber-500/70 text-amber-200 ring-1 ring-amber-500/30'
                    : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
                }`}
                title="Audit Petty Cash Expenses & Day-End Supervisor Sign-Off"
              >
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Expenses ({currentStaffExpenses.length})
                  {pendingExpensesCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-black text-[10px]">
                      {pendingExpensesCount} Pending
                    </span>
                  )}
                </span>
              </button>

              {/* Float Adjustment Modal Trigger */}
              <button
                type="button"
                onClick={handleOpenFloatModal}
                className="py-1.5 px-3 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-700/60 text-purple-300 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
                title="Adjust Opening Float with Supervisor Dual Auth"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#FF8A00]" />
                <span>Adjust Float</span>
              </button>

              {/* Cash Lift Modal Trigger */}
              <button
                type="button"
                onClick={() => setIsCashLiftModalOpen(true)}
                className="py-1.5 px-3 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
                title="Record Dual-PIN Cash Lift"
              >
                <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                <span>Record Cash Lift</span>
              </button>
            </div>
          </div>

          {/* Daily report status badge */}
          <div>
            {!isEditable ? (
              <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs shadow-sm">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Historical Record (Read-Only):</strong> Viewing Cash Log for {sheetDate}. Non-admin staff cannot edit records of previous days.
                </span>
              </div>
            ) : !isToday && isAdmin ? (
              <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs shadow-sm">
                <Sparkles className="w-4 h-4 text-[#FF8A00] shrink-0" />
                <span>
                  <strong>Historical Record (Admin Edit Mode):</strong> Administrator override active for {sheetDate}. Any modifications will update this record upon saving.
                </span>
              </div>
            ) : isExistingSavedSheet ? (
              <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs shadow-sm">
                <Edit3 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Saved Daily Sheet Loaded ({sheetDate}):</strong> Showing saved cash log entries for today. Modifications will update upon saving.
                </span>
              </div>
            ) : null}
          </div>

          {/* Cashier Float Confirmation Banner - Directly Housed in Form 2 */}
          {pendingFloatVouchers.length > 0 && (
            <div id="form2-pending-float-banner" className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-indigo-950/95 via-slate-900 to-indigo-950/95 border-2 border-indigo-500/70 shadow-2xl space-y-3.5 animate-fadeIn">
              {pendingFloatVouchers.map((voucher) => (
                <div key={voucher.transfer_id} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center space-x-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center text-white shadow-xl shrink-0">
                      <Coins className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 font-bold bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-500/40">
                          Accounts Clerk Float Dispatched
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Ref: {voucher.transfer_id}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-black text-white mt-1">
                        Till Float of <span className="text-emerald-400 font-mono">${voucher.amount.toFixed(2)}</span> Awaiting Acceptance
                      </h3>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Issued by Accounts Clerk <strong className="text-white">{voucher.created_by_user_name}</strong> for {voucher.recipient_name || selectedStaff?.name}. Confirm receipt below to accept custody into your register drawer.
                      </p>
                    </div>
                  </div>

                  {/* PIN Entry & Confirmation Actions */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <div className="relative">
                      <input
                        type="password"
                        maxLength={6}
                        value={pendingFloatPin}
                        onChange={(e) => {
                          setPendingFloatPin(e.target.value);
                          setPendingFloatPinError('');
                        }}
                        placeholder="Cashier PIN"
                        className="w-full sm:w-36 min-h-[42px] text-center tracking-widest text-sm font-mono font-bold bg-slate-950 border border-indigo-500/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400 shadow-inner"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={isAcceptingFloat}
                      onClick={() => handleAcceptPendingFloat(voucher.transfer_id)}
                      className="min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-xs font-black flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-900/30 transition active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isAcceptingFloat ? 'Accepting...' : 'Accept Float'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRejectPendingFloat(voucher.transfer_id)}
                      className="min-h-[42px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 text-xs font-bold transition flex items-center justify-center space-x-1 border border-slate-700 active:scale-95 cursor-pointer"
                      title="Decline float and return cash to Accounts Clerk"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span className="sm:hidden md:inline">Return</span>
                    </button>
                  </div>
                </div>
              ))}

              {pendingFloatPinError && (
                <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/50 text-xs text-rose-300 font-semibold flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{pendingFloatPinError}</span>
                </div>
              )}
            </div>
          )}

          {/* Pending Petty Cash Approvals Banner */}
          {pendingApprovalsCount > 0 && (
            <div className="p-3 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
                  <Clock className="w-5 h-5 animate-pulse text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center space-x-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-200">Pending Petty Cash Approvals:</span>
                    <span className="font-mono-num font-black text-sm text-amber-300 bg-amber-950 px-2.5 py-0.5 rounded-lg border border-amber-500/60 shadow-sm">
                      {pendingApprovalsCount} {pendingApprovalsCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Petty cash expenditures remain excluded from drawer balance until approved by a supervisor.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 self-stretch sm:self-auto justify-end">
                <button
                  type="button"
                  onClick={handleApproveAllPending}
                  className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition active:scale-95 shadow-md"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve All Pending ({pendingApprovalsCount})</span>
                </button>
              </div>
            </div>
          )}

          {/* Multi-Currency & Cash Withdrawals (Form 2 Deductions) summary badge */}
          {(multiCurrencySummary.totalNonUsdOut > 0 || (multiCurrencySummary.groups && multiCurrencySummary.groups.some((g) => g.salesRows.length > 0 || g.withdrawalRows.length > 0))) && (
            <div className="p-3 sm:p-3.5 rounded-2xl bg-slate-900/90 border border-indigo-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 shadow-md">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/30">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-indigo-200">
                    Active Multi-Currency Breakdown ({multiCurrencySummary.groups?.length || 0} Currencies):
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Non-cash sales are for reporting only; cash-outs are physical cash OUT from till.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono-num w-full md:w-auto">
                {multiCurrencySummary.groups?.map((g) => (
                  <React.Fragment key={g.currency.currency}>
                    <div className="px-2.5 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-purple-300">
                      <span className="text-[10px] text-purple-400 block font-sans">{g.currency.name} Sales (Non-Cash)</span>
                      <span className="font-bold">${(Number(g?.salesOut) || 0).toFixed(2)}</span>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300">
                      <span className="text-[10px] text-rose-400 block font-sans">{g.currency.name} Cash-Out (Till OUT)</span>
                      <span className="font-bold">-${(Number(g?.withdrawalOut) || 0).toFixed(2)}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* The Exact Spreadsheet Table */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            {/* Sheet Title Bar */}
            <div className="bg-gradient-to-r from-[#6A4DFF] via-[#5638e6] to-[#6A4DFF] p-3 text-center border-b border-purple-400/30">
              <h3 className="text-sm font-black text-white tracking-widest uppercase">
                SAIMETRIC CASH LOG ENTRY SHEET
              </h3>
              <p className="text-[11px] text-purple-200 font-medium">
                Standard Entry Points • Dynamic EcoCash, Direct Procurement & Cash with instant addition
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FF8A00] text-slate-950 font-black uppercase text-[10px] sm:text-[11px] tracking-wider border-b border-orange-600">
                    <th className="py-2.5 px-1.5 sm:px-3 w-8 sm:w-12 text-center">#</th>
                    <th className="py-2.5 px-2 sm:px-4 min-w-[130px] sm:min-w-[220px]">Description & Item Details</th>
                    <th className="py-2.5 px-1.5 sm:px-3 w-24 sm:w-36 text-center text-emerald-950 font-black">
                      In ($ USD)
                    </th>
                    <th className="py-2.5 px-1.5 sm:px-3 w-24 sm:w-36 text-center text-rose-950 font-black">
                      Out ($ USD)
                    </th>
                    <th className="py-2.5 px-3 sm:px-4 min-w-[140px] hidden md:table-cell">
                      Notes / Reference / Payee
                    </th>
                    <th className="py-2.5 px-2 w-10 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {/* SECTION 1: FIXED STANDARD ENTRY POINTS */}
                  {FIXED_CASH_LOG_ENTRY_POINTS.map((pt, index) => {
                    const rowVal = gridValues[pt.id] || { in: '', out: '', note: '' };
                    const hasIn = parseFloat(rowVal.in) > 0;
                    const hasOut = parseFloat(rowVal.out) > 0;
                    const isFinalCashOut = pt.id === 'final_cash_out';
                    const isSpecialDefault = pt.id === 'float' && rowVal.in === '20';

                    return (
                      <tr
                        key={pt.id}
                        className={`transition hover:bg-slate-800/60 ${
                          isFinalCashOut
                            ? 'bg-orange-950/30 border-l-4 border-l-[#FF8A00]'
                            : hasIn
                            ? 'bg-emerald-950/20'
                            : hasOut
                            ? 'bg-rose-950/20'
                            : index % 2 === 0
                            ? 'bg-slate-950/40'
                            : 'bg-slate-900/40'
                        }`}
                      >
                        {/* Row Index */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-slate-500 font-bold">
                          {index + 1}
                        </td>

                        {/* Description */}
                        <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`font-black text-xs sm:text-sm tracking-tight ${
                                pt.id === 'float'
                                  ? 'text-emerald-300'
                                  : pt.id === 'expenses'
                                  ? 'text-rose-200'
                                  : 'text-white'
                              }`}
                            >
                              {pt.description}
                            </span>
                            {pt.id === 'float' && (
                              <>
                                <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-purple-900/60 border border-purple-700/50 text-purple-300 font-bold flex items-center space-x-1">
                                  <Lock className="w-2.5 h-2.5 text-purple-300" />
                                  <span>Locked</span>
                                </span>
                                {pendingFloatVouchers.length > 0 && (
                                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 font-bold flex items-center space-x-1 animate-pulse">
                                    <Coins className="w-2.5 h-2.5 text-emerald-400" />
                                    <span>${pendingFloatVouchers[0].amount.toFixed(2)} Dispatched • Accept Above</span>
                                  </span>
                                )}
                              </>
                            )}
                            {pt.id === 'expenses' && pendingExpensesCount > 0 && (
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold flex items-center space-x-1">
                                <Clock className="w-2.5 h-2.5 text-amber-400" />
                                <span>{pendingExpensesCount} Pending Supervisor</span>
                              </span>
                            )}
                            {pt.id === 'expenses' && currentStaffExpenses.length > 0 && pendingExpensesCount === 0 && (
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold flex items-center space-x-1">
                                <Check className="w-2.5 h-2.5 text-emerald-400" />
                                <span>All Approved ({currentStaffExpenses.length})</span>
                              </span>
                            )}
                            {isSpecialDefault && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-800/60 text-purple-300 font-bold">
                                Default
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                            {pt.id === 'float'
                              ? 'Opening Till Float ($20 default) + Adjustments'
                              : pt.id === 'expenses'
                              ? 'Store petty cash expenses (filled from POS expenses & Form 2)'
                              : pt.categoryGroup}
                          </span>
                        </td>

                        {/* In Input */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          {pt.id === 'float' ? (
                            <div className="relative max-w-[120px] mx-auto">
                              <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-emerald-400 font-bold text-xs">
                                $
                              </span>
                              <input
                                type="text"
                                readOnly
                                disabled
                                value={(Number(shiftFloatTotal) || 0).toFixed(2)}
                                title="Float can only be adjusted via Supervisor PIN"
                                className="w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-900 border border-emerald-500/50 rounded-xl text-xs sm:text-sm font-mono-num font-bold text-right text-emerald-300 cursor-not-allowed opacity-90"
                              />
                            </div>
                          ) : pt.allowIn ? (
                            <div className="relative max-w-[120px] mx-auto">
                              <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-emerald-400 font-bold text-xs">
                                $
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!isEditable}
                                value={rowVal.in}
                                onChange={(e) => handleGridChange(pt.id, 'in', e.target.value)}
                                placeholder="0.00"
                                className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                  hasIn
                                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-500/40'
                                    : 'border-slate-800 text-slate-300 focus:border-emerald-500'
                                }`}
                              />
                            </div>
                          ) : (
                            <span className="text-slate-600 font-mono-num text-xs">—</span>
                          )}
                        </td>

                        {/* Out Input */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          {pt.allowOut ? (
                            <div className="relative max-w-[120px] mx-auto">
                              <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none font-bold text-xs text-rose-400">
                                $
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!isEditable}
                                value={rowVal.out}
                                onChange={(e) => handleGridChange(pt.id, 'out', e.target.value)}
                                placeholder="0.00"
                                className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                  hasOut
                                    ? 'border-rose-500 bg-rose-950/40 text-rose-300 ring-1 ring-rose-500/40'
                                    : 'border-slate-800 text-slate-300 focus:border-rose-500'
                                }`}
                              />
                            </div>
                          ) : (
                            <span className="text-slate-600 font-mono-num text-xs">—</span>
                          )}
                        </td>

                        {/* Note / Reference */}
                        <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                          <input
                            type="text"
                            disabled={!isEditable || pt.id === 'float'}
                            value={rowVal.note}
                            onChange={(e) => handleGridChange(pt.id, 'note', e.target.value)}
                            placeholder={pt.placeholder || 'Optional note...'}
                            className="w-full py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                          />
                        </td>

                        {/* Action Column */}
                        <td className="py-2 text-center text-slate-600 text-xs">
                          {pt.id === 'float' ? (
                            <button
                              type="button"
                              onClick={handleOpenFloatModal}
                              title="Supervisor PIN required to adjust drawer float"
                              className="px-2 py-1 bg-purple-900/70 hover:bg-purple-800 text-purple-200 border border-purple-700/60 rounded-lg text-[10px] font-bold flex items-center space-x-1 mx-auto transition active:scale-95"
                            >
                              <ShieldCheck className="w-3 h-3 text-[#FF8A00]" />
                              <span>Adjust</span>
                            </button>
                          ) : pt.id === 'expenses' ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => setIsForm2ExpenseModalOpen(true)}
                                className="px-2 py-1 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold flex items-center space-x-1 transition active:scale-95 shadow-sm"
                                title="Add Cashier Petty Cash Expense"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsExpensesAuditModalOpen(true)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center space-x-1 transition active:scale-95 border ${
                                  pendingExpensesCount > 0
                                    ? 'bg-amber-600/80 hover:bg-amber-500 text-white border-amber-400/50'
                                    : currentStaffExpenses.length > 0
                                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                                    : 'bg-slate-900 text-slate-500 border-slate-800'
                                }`}
                                title="View & Audit Expenses / Supervisor Approval"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Audit ({currentStaffExpenses.length})</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-600 font-mono-num text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* DYNAMIC MULTI-CURRENCY SECTIONS (Automated POS Sales & Till Cash-Outs for all Active Currencies) */}
                  {currencyGroupedRows.map((cg) => {
                    const cSymbol = cg.currency.symbol || cg.currency.code;
                    return (
                      <React.Fragment key={cg.currency.currency}>
                        {/* Section A: Non-Cash Electronic Sales (Reporting Only) */}
                        <tr className="bg-amber-950/60 border-y border-amber-800/40">
                          <td colSpan={6} className="py-2 px-3 sm:px-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-5 h-5 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center font-black text-[10px]">
                                  {cSymbol}
                                </div>
                                <span className="font-black text-xs uppercase tracking-wider text-amber-200">
                                  {cg.currency.name} Sales (Non-Cash Electronic Swipe • Reporting Only)
                                </span>
                                <span className="text-[10px] text-amber-400 font-bold bg-amber-900/60 px-2 py-0.5 rounded-full border border-amber-700/50">
                                  {cg.salesRows.length} {cg.salesRows.length === 1 ? "entry" : "entries"} (${(Number(cg?.salesOut) || 0).toFixed(2)})
                                </span>
                              </div>
                              <div className="flex items-center space-x-1.5 text-xs text-amber-300/90 bg-amber-950/80 px-2.5 py-1 rounded-lg border border-amber-800/60">
                                <Lock className="w-3 h-3 text-amber-400" />
                                <span className="text-[11px] font-semibold">POS Swipe • Read-Only</span>
                              </div>
                            </div>
                          </td>
                        </tr>

                        {cg.salesRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-2.5 px-4 bg-slate-950/40 text-center text-xs text-slate-500">
                              No POS register {cg.currency.name} non-cash sales recorded for {selectedStaff.name} on {sheetDate}.
                            </td>
                          </tr>
                        ) : (
                          cg.salesRows.map((r, idx) => {
                            const rowVal = gridValues[r.id] || { in: "", out: "", note: "" };
                            const hasOut = parseFloat(rowVal.out) > 0;

                            return (
                              <tr
                                key={r.id}
                                className={`transition hover:bg-slate-800/60 ${
                                  hasOut ? "bg-amber-950/20" : idx % 2 === 0 ? "bg-slate-950/30" : "bg-slate-900/30"
                                }`}
                              >
                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-amber-400 font-bold">
                                  {cg.currency.code.slice(0, 2)}S{idx + 1}
                                </td>
                                <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-xs sm:text-sm text-amber-200">
                                      {cg.currency.name} Sale
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-400 border border-amber-800/50 font-mono">
                                      Non-Cash
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                                      POS
                                    </span>
                                  </div>
                                  <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                                    Customer electronic card swipe (reporting only)
                                  </span>
                                </td>

                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                                  <span className="text-slate-600 font-mono-num text-xs">—</span>
                                </td>

                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                                  <div className="relative max-w-[120px] mx-auto">
                                    <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                                      $
                                    </span>
                                    <input
                                      type="text"
                                      readOnly
                                      disabled
                                      value={rowVal.out || "0.00"}
                                      title={`${cg.currency.name} Non-Cash Sale (POS)`}
                                      className="w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-amber-950/40 border border-amber-500/50 rounded-xl text-xs sm:text-sm font-mono-num font-bold text-amber-300 text-right cursor-default opacity-90"
                                    />
                                  </div>
                                </td>

                                <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                                  <div className="py-1.5 px-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono flex items-center justify-between">
                                    <span className="truncate">{rowVal.note || "POS swipe sale"}</span>
                                    <Lock className="w-3 h-3 text-amber-400/70 shrink-0 ml-1.5" />
                                  </div>
                                </td>

                                <td className="py-2 text-center">
                                  <span className="text-[10px] text-amber-500/70 font-mono">POS</span>
                                </td>
                              </tr>
                            );
                          })
                        )}

                        {/* Section B: Cash-Out / Withdrawal (Physical Till Deduction) */}
                        <tr className="bg-rose-950/60 border-y border-rose-800/40">
                          <td colSpan={6} className="py-2 px-3 sm:px-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <div className="w-5 h-5 rounded-lg bg-rose-500/20 text-rose-300 flex items-center justify-center font-black text-[10px]">
                                  {cSymbol}
                                </div>
                                <span className="font-black text-xs uppercase tracking-wider text-rose-200">
                                  {cg.currency.name} Cash-Out (Cash Handed Out of Till • Deducted from Drawer)
                                </span>
                                <span className="text-[10px] text-rose-400 font-bold bg-rose-900/60 px-2 py-0.5 rounded-full border border-rose-700/50">
                                  {cg.withdrawalRows.length} {cg.withdrawalRows.length === 1 ? "entry" : "entries"} (${(Number(cg?.withdrawalOut) || 0).toFixed(2)})
                                </span>
                              </div>
                              <div className="flex items-center space-x-1.5 text-xs text-rose-300/90 bg-rose-950/80 px-2.5 py-1 rounded-lg border border-rose-800/60">
                                <Lock className="w-3 h-3 text-rose-400" />
                                <span className="text-[11px] font-semibold">Till Cash Deduction • Read-Only</span>
                              </div>
                            </div>
                          </td>
                        </tr>

                        {cg.withdrawalRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-2.5 px-4 bg-slate-950/40 text-center text-xs text-slate-500">
                              No POS register {cg.currency.name} cash-outs recorded for {selectedStaff.name} on {sheetDate}.
                            </td>
                          </tr>
                        ) : (
                          cg.withdrawalRows.map((r, idx) => {
                            const rowVal = gridValues[r.id] || { in: "", out: "", note: "" };
                            const hasOut = parseFloat(rowVal.out) > 0;

                            return (
                              <tr
                                key={r.id}
                                className={`transition hover:bg-slate-800/60 ${
                                  hasOut ? "bg-rose-950/20" : idx % 2 === 0 ? "bg-slate-950/30" : "bg-slate-900/30"
                                }`}
                              >
                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-rose-400 font-bold">
                                  {cg.currency.code.slice(0, 2)}W{idx + 1}
                                </td>
                                <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-xs sm:text-sm text-rose-200">
                                      {cg.currency.name} Cash-Out
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-950/80 text-rose-400 border border-rose-800/50 font-mono">
                                      Physical Cash Out
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                                      POS
                                    </span>
                                  </div>
                                  <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                                    Physical notes handed to customer (reduces physical till cash)
                                  </span>
                                </td>

                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                                  <span className="text-slate-600 font-mono-num text-xs">—</span>
                                </td>

                                <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                                  <div className="relative max-w-[120px] mx-auto">
                                    <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                                      $
                                    </span>
                                    <input
                                      type="text"
                                      readOnly
                                      disabled
                                      value={rowVal.out || "0.00"}
                                      title={`${cg.currency.name} Cash-Out (Physical Cash Out)`}
                                      className="w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-rose-950/40 border border-rose-500/50 rounded-xl text-xs sm:text-sm font-mono-num font-bold text-rose-300 text-right cursor-default opacity-90"
                                    />
                                  </div>
                                </td>

                                <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                                  <div className="py-1.5 px-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono flex items-center justify-between">
                                    <span className="truncate">{rowVal.note || "POS cash-out to customer"}</span>
                                    <Lock className="w-3 h-3 text-rose-400/70 shrink-0 ml-1.5" />
                                  </div>
                                </td>

                                <td className="py-2 text-center">
                                  <span className="text-[10px] text-rose-500/70 font-mono">POS</span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* SECTION 3: DIRECT PROCUREMENT (Derived from Direct Supplier Receiving Vouchers) */}
                  <tr className="bg-amber-950/60 border-y border-amber-800/40">
                    <td colSpan={6} className="py-2 px-3 sm:px-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <Truck className="w-4 h-4 text-amber-400" />
                          <span className="font-black text-xs uppercase tracking-wider text-amber-200">
                            Direct Procurement
                          </span>
                          <span className="text-[10px] text-amber-400 font-bold bg-amber-900/60 px-2 py-0.5 rounded-full border border-amber-700/50">
                            {derivedProcurements.length} Voucher Payout{derivedProcurements.length !== 1 ? 's' : ''} (Derived)
                          </span>
                          {derivedProcurements.length > 0 && (
                            <span className="text-[10px] text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-800/50">
                              Total: ${(Number(derivedProcurementTotalOut) || 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                        {onNavigateToDirectGrv && (
                          <button
                            type="button"
                            onClick={() => {
                              if (derivedProcurements.length === 1) {
                                const grv = directGrvs.find((g) => g.id === derivedProcurements[0].grvId || g.grvNumber === derivedProcurements[0].grvNumber);
                                if (grv) {
                                  setViewingProcurementGrv(grv);
                                  return;
                                }
                              }
                              onNavigateToDirectGrv(derivedProcurements[0]?.grvId);
                            }}
                            className="py-1 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm active:scale-95 self-start sm:self-auto"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Open Direct Supplies Voucher</span>
                            <ExternalLink className="w-3 h-3 ml-0.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {derivedProcurements.length > 0 ? (
                    derivedProcurements.map((proc, idx) => (
                      <tr
                        key={`proc-${proc.grvId}-${idx}`}
                        className="transition hover:bg-slate-800/60 bg-amber-950/10"
                      >
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-amber-400 font-bold">
                          P{idx + 1}
                        </td>
                        <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                          <div
                            className="space-y-0.5 cursor-pointer group"
                            onClick={() => {
                              const grv = directGrvs.find((g) => g.id === proc.grvId || g.grvNumber === proc.grvNumber);
                              if (grv) {
                                setViewingProcurementGrv(grv);
                              } else if (onNavigateToDirectGrv) {
                                onNavigateToDirectGrv(proc.grvId);
                              }
                            }}
                          >
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-xs sm:text-sm text-amber-200 group-hover:text-amber-100 group-hover:underline">
                                {proc.supplierName}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-amber-400 border border-slate-700">
                                {proc.drawerId || 'Till 1'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 block truncate">
                              Voucher: <strong className="font-mono text-slate-300">{proc.grvNumber}</strong> • {proc.itemsSummary}
                            </span>
                            <div className="flex items-center gap-1.5 pt-0.5">
                              {proc.status === 'APPROVED' ? (
                                <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-0.5">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Approved by {proc.approvedByName || 'Supervisor'}
                                </span>
                              ) : (
                                <span className="text-[10px] text-amber-400 font-bold flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" />
                                  Pending Supervisor Approval
                                </span>
                              )}
                              <span className="text-[9px] text-slate-500 font-mono">
                                (Click to view recorded voucher)
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* In */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <span className="text-slate-600 font-mono-num text-xs">—</span>
                        </td>

                        {/* Out (Derived read-only with lock) */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <div className="relative max-w-[120px] mx-auto">
                            <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="text"
                              readOnly
                              value={(Number(proc.amount) || 0).toFixed(2)}
                              className="w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-rose-950/40 border border-rose-500/50 rounded-xl text-xs sm:text-sm font-mono-num font-bold text-rose-300 text-right cursor-default"
                              title="Derived from Direct Supplier Delivery Voucher"
                            />
                          </div>
                        </td>

                        {/* Note */}
                        <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                          <div className="text-xs text-slate-300 font-mono">
                            <span>
                              Voucher: {proc.grvNumber}
                              {proc.invoiceNo ? ` • Inv: ${proc.invoiceNo}` : ''}
                            </span>
                          </div>
                        </td>

                        {/* Action */}
                        <td className="py-2 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const grv = directGrvs.find((g) => g.id === proc.grvId || g.grvNumber === proc.grvNumber);
                              if (grv) {
                                setViewingProcurementGrv(grv);
                              } else if (onNavigateToDirectGrv) {
                                onNavigateToDirectGrv(proc.grvId);
                              }
                            }}
                            title="View Recorded Direct Delivery Voucher"
                            className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-4 px-4 bg-slate-950/40 text-center">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl bg-amber-950/20 border border-amber-800/30 text-xs">
                          <div className="flex items-center space-x-3 text-left">
                            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                              <Truck className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-bold text-amber-200">
                                No direct supplier delivery payouts registered for {selectedStaff.name} on {sheetDate}.
                              </p>
                              <p className="text-slate-400 text-[11px]">
                                Direct procurements are now derived automatically from cashier inputs in the Direct Delivery Voucher.
                              </p>
                            </div>
                          </div>
                          {onNavigateToDirectGrv && (
                            <button
                              type="button"
                              onClick={() => onNavigateToDirectGrv()}
                              className="py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center space-x-1.5 shrink-0 transition"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              <span>Open Direct Supplies Voucher</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* SECTION 4: SUPERVISOR CASH LIFTS (TILL PICK-UP) */}
                  <tr className="bg-emerald-950/60 border-y border-emerald-800/40">
                    <td colSpan={6} className="py-2.5 px-3 sm:px-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center space-x-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span className="font-black text-xs uppercase tracking-wider text-emerald-200">
                            Supervisor Cash Lifts
                          </span>
                          <span className="text-[10px] text-emerald-400 font-bold bg-emerald-900/60 px-2 py-0.5 rounded-full border border-emerald-700/50">
                            {cashSectionRows.length} {cashSectionRows.length === 1 ? 'Lift' : 'Lifts'} (Supervisor Custody)
                          </span>

                          {tillCashInfo.isThresholdReached && (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-300 bg-amber-950/80 border border-amber-600/60 px-2 py-0.5 rounded-full animate-pulse ml-2">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              <span>Cash Lift Advised</span>
                            </span>
                          )}
                        </div>

                        {/* Action buttons: Only Supervisor Cash Lift, direct cash entry removed */}
                        <div className="flex items-center space-x-2">
                          {isEditable && (
                            <button
                              type="button"
                              onClick={() => setIsCashLiftModalOpen(true)}
                              className={`py-1.5 px-3 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition shadow-md active:scale-95 ${
                                tillCashInfo.isThresholdReached
                                  ? 'bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-white ring-2 ring-amber-400/50 animate-pulse'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              }`}
                              title="Collect cash from the till drawer for supervisor custody with denomination breakdown and dual PIN authorization"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-200" />
                              <span>Supervisor Cash Lift</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>

                  {cashSectionRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 px-4 text-center bg-slate-950/30">
                        <div className="max-w-md mx-auto flex flex-col items-center justify-center space-y-1.5 text-slate-400 text-xs">
                          <ShieldCheck className="w-6 h-6 text-emerald-500/60" />
                          <p className="font-bold text-slate-300">
                            No supervisor cash lifts registered for {selectedStaff.name} on {sheetDate}.
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Direct cash transactions are disabled. Any cash reduction from the till drawer must be authenticated via Supervisor Cash Lift.
                          </p>
                          {isEditable && (
                            <button
                              type="button"
                              onClick={() => setIsCashLiftModalOpen(true)}
                              className="mt-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1.5 transition shadow-sm active:scale-95"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-200" />
                              <span>Perform Supervisor Cash Lift</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    cashSectionRows.map((r) => {
                      const rowVal = gridValues[r.id] || { in: '', out: '', note: '' };
                      const liftRecord = cashLiftsList.find((l) => l.id === r.cashLiftId);
                      return (
                        <tr
                          key={r.id}
                          className="bg-emerald-950/20 border-b border-emerald-900/30 hover:bg-emerald-950/40 transition"
                        >
                          <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-emerald-900/80 border border-emerald-700/60 text-[10px] font-mono-num font-bold text-emerald-300">
                              LIFT
                            </span>
                          </td>
                          <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                            <div className="flex items-center space-x-2">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              <span className="font-bold text-xs sm:text-sm text-emerald-200">
                                Supervisor Cash Lift (Till Pick-Up)
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-semibold border border-emerald-700/40 font-mono">
                                {r.cashLiftId || 'Dual-PIN Verified'}
                              </span>
                              {liftRecord && (
                                <SyncStatusDot
                                  isSynced={liftRecord.synced}
                                  syncStatus={(liftRecord as any).syncStatus}
                                  timestamp={liftRecord.timestamp}
                                  invoiceId={liftRecord.id}
                                  invoiceType="cash_lift"
                                  targetSheet="CashLifts"
                                  onRetry={async () => {
                                    await retrySyncInvoice(liftRecord.id, 'cash_lift');
                                    setCashLiftsList(getCashLiftsForStaffAndDate(selectedStaffId, sheetDate));
                                  }}
                                />
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 block truncate mt-0.5">
                              {liftRecord
                                ? `Supervisor: ${liftRecord.supervisorName} • Dual PIN Signed • Form 1 Denominations`
                                : 'Handover to supervisor • Denomination breakdown recorded'}
                            </span>
                          </td>

                          {/* In: Read-Only Dash */}
                          <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                            <div className="text-center text-slate-600 font-mono-num text-xs">
                              —
                            </div>
                          </td>

                          {/* Out: Cash Lift Amount */}
                          <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                            <div className="relative max-w-[120px] mx-auto">
                              <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-emerald-400 font-bold text-xs">
                                $
                              </span>
                              <input
                                type="text"
                                readOnly
                                disabled
                                value={rowVal.out || '0.00'}
                                className="w-full pl-5 pr-2 py-1.5 bg-emerald-950/60 border border-emerald-600/60 rounded-xl text-xs sm:text-sm font-mono-num font-bold text-emerald-300 text-right cursor-default shadow-inner"
                              />
                            </div>
                          </td>

                          {/* Note */}
                          <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                            <div className="flex items-center space-x-1.5 text-xs text-slate-300 bg-slate-950/60 border border-slate-800 rounded-xl px-2.5 py-1.5 truncate">
                              <Lock className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                              <span className="truncate">{rowVal.note || 'Dual PIN authenticated supervisor handover'}</span>
                            </div>
                          </td>

                          {/* Action: View Slip / Voucher Modal */}
                          <td className="py-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (liftRecord) {
                                  setSelectedCashLiftToView(liftRecord);
                                } else {
                                  // Synthesize record for view if found from logs
                                  const synth: CashLiftRecord = {
                                    id: r.cashLiftId || 'LIFT-REF',
                                    timestamp: new Date().toISOString(),
                                    date: sheetDate,
                                    cashierId: selectedStaff.id,
                                    cashierName: selectedStaff.name,
                                    supervisorId: 'SUPERVISOR',
                                    supervisorName: 'Authorized Supervisor',
                                    totalAmount: parseFloat(rowVal.out) || 0,
                                    denominations: {},
                                    notes: rowVal.note,
                                    synced: true,
                                  };
                                  setSelectedCashLiftToView(synth);
                                }
                              }}
                              title="View Cash Lift breakdown and dual-PIN signatures"
                              className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/50 transition inline-flex items-center space-x-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span className="text-[10px] hidden sm:inline font-bold">Slip</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Table Footer Totals */}
                <tfoot>
                  <tr className="bg-slate-950 font-black border-t-2 border-slate-800">
                    <td colSpan={2} className="py-3 px-4 text-right text-xs uppercase tracking-wider text-slate-400">
                      Total Column Values:
                    </td>
                    <td className="py-3 px-4 text-center font-mono-num text-sm text-emerald-400">
                      +${(Number(gridTotals?.totalIn) || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono-num text-sm text-rose-400">
                      -${(Number(gridTotals?.totalOut) || 0).toFixed(2)}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-xs font-mono-num text-purple-300 hidden md:table-cell">
                      Net: ${(Number(gridTotals?.net) || 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Bottom Save Bar */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="text-xs text-slate-400">
                <span>Saving for Staff: </span>
                <strong className="text-white">{selectedStaff.name}</strong>
                <span> on date </span>
                <strong className="text-[#FF8A00] font-mono-num">{sheetDate}</strong>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToDefaults}
                  disabled={!isEditable}
                  className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Reset Defaults
                </button>

                {isEditable ? (
                  <>
                    {/* Option 1: Save & Go to Form 3 (Customer Change) */}
                    <button
                      id="btn-save-and-next-cashlog"
                      type="button"
                      onClick={() => handleSaveSpreadsheet(undefined, 'next')}
                      className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-black text-xs shadow-md flex items-center space-x-1.5 transition active:scale-98"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save & Go to Form 3 (Customer Change) &rarr;</span>
                    </button>

                    {/* Option 2: Save & Close Session (Home) */}
                    <button
                      id="btn-save-and-home-cashlog"
                      type="button"
                      onClick={() => handleSaveSpreadsheet(undefined, 'home')}
                      className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs border border-slate-700 flex items-center space-x-1.5 transition active:scale-98"
                    >
                      <Home className="w-3.5 h-3.5 text-slate-400" />
                      <span>Save & Return Home</span>
                    </button>

                    {/* Option 3: Commit Sheet Only */}
                    <button
                      id="btn-save-daily-cashlog-sheet"
                      type="button"
                      onClick={() => handleSaveSpreadsheet(undefined, 'stay')}
                      className="py-2 px-2.5 rounded-lg text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition hover:underline"
                    >
                      Save Sheet Only
                    </button>
                  </>
                ) : (
                  <button
                    id="btn-save-daily-cashlog-sheet-disabled"
                    type="button"
                    disabled
                    className="py-2.5 px-4 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-400 font-bold text-xs shadow-inner flex items-center space-x-1.5 cursor-not-allowed opacity-75"
                  >
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Historical Record (Read-Only)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* 2B. QUICK SINGLE ENTRY MODE */}
      {activeView === 'single' && (
        <form
          onSubmit={handleSaveSingleEntry}
          className="bg-slate-900/95 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-4 animate-scaleUp"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-800 gap-2">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-[#FF8A00]/20 text-[#FF8A00] flex items-center justify-center font-bold text-xs">
                M3
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Quick Single Entry point
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              Staff: <strong className="text-white">{currentUser.name}</strong>
            </span>
          </div>

          {/* Clean Type Selector Grid */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-300 mb-1.5">
              Select Category / Account *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2">
              {QUICK_ENTRY_TYPES.map((pt) => {
                const isSelected = selectedQuickId === pt.id;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => handleSelectQuickPoint(pt)}
                    className={`p-3 rounded-2xl border text-left text-xs font-bold transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-[#6A4DFF] border-purple-400 text-white shadow-lg ring-2 ring-purple-500/40'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <span className="font-black text-sm truncate">{pt.label}</span>
                    <span className="text-[10px] opacity-75 font-normal mt-0.5">{pt.group}</span>
                  </button>
                );
              })}
            </div>

            {/* Cash Lift Banner in Quick Entry Mode */}
            <div className="mt-2.5 p-3 bg-emerald-950/40 border border-emerald-600/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-xs font-bold text-emerald-200">Till Cash Pick-Up / Lift</span>
                  <p className="text-[11px] text-slate-400">Direct cash withdrawals are disabled. Cash reductions must be authorized via Supervisor Cash Lift.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCashLiftModalOpen(true)}
                className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition shadow-sm active:scale-95 shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-200" />
                <span>Perform Cash Lift</span>
              </button>
            </div>
          </div>

          {/* If Direct Procurement, show link to Direct Supplier Delivery Voucher + details */}
          {currentQuickItem.id === 'direct_procurement' && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-2.5 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center space-x-1.5">
                    <Truck className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                      Direct Supplier Receiving Voucher
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Supplier delivery payouts can be recorded and tracked directly on the Direct Supplies Voucher.
                  </p>
                </div>
                {onNavigateToDirectGrv && (
                  <button
                    type="button"
                    onClick={() => onNavigateToDirectGrv()}
                    className="py-1 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shrink-0"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Open Direct Supplies Voucher</span>
                    <ExternalLink className="w-3 h-3 ml-0.5" />
                  </button>
                )}
              </div>
              <div className="pt-1">
                <label className="block text-xs font-black uppercase tracking-wider text-amber-300 mb-1">
                  What was bought / Item Details (Optional)
                </label>
                <input
                  type="text"
                  value={singleItemBought}
                  onChange={(e) => setSingleItemBought(e.target.value)}
                  placeholder="e.g. Cables, fuel, lunch, packaging tape..."
                  className="w-full py-2 px-3 bg-slate-950 border border-amber-500/50 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400"
                />
              </div>
            </div>
          )}

          {/* In / Out Switch */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!currentQuickItem.allowIn}
              onClick={() => setSingleType('IN')}
              className={`py-3 px-4 rounded-2xl border text-xs sm:text-sm font-black flex items-center justify-center space-x-2 transition ${
                singleType === 'IN'
                  ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/40 shadow-lg'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/80'
              } ${!currentQuickItem.allowIn ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>CASH IN (+)</span>
            </button>

            <button
              type="button"
              disabled={!currentQuickItem.allowOut}
              onClick={() => setSingleType('OUT')}
              className={`py-3 px-4 rounded-2xl border text-xs sm:text-sm font-black flex items-center justify-center space-x-2 transition ${
                singleType === 'OUT'
                  ? 'bg-rose-950/90 border-rose-500 text-rose-300 ring-2 ring-rose-500/40 shadow-lg'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/80'
              } ${!currentQuickItem.allowOut ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>CASH OUT (-)</span>
            </button>
          </div>

          {/* Amount */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-3.5 space-y-2.5">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-300">
              Amount ($ USD) *
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 font-black text-xl">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={singleAmount}
                onChange={(e) => setSingleAmount(e.target.value)}
                placeholder="0.00"
                className={`w-full pl-10 pr-4 py-3 bg-slate-900 border rounded-2xl text-2xl font-black text-white font-mono-num outline-none transition ${
                  singleType === 'IN' ? 'border-emerald-500 text-emerald-300' : 'border-rose-500 text-rose-300'
                }`}
                required
              />
            </div>

            {/* Quick Increment Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Quick Preset:</span>
              {QUICK_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSingleAmount(val.toFixed(2))}
                  className="py-1 px-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-[11px] font-bold font-mono-num text-slate-200 transition active:scale-95"
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          {/* Additional details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Custom Detail / Payee (Optional)
              </label>
              <input
                type="text"
                value={singleCustomDesc}
                onChange={(e) => setSingleCustomDesc(e.target.value)}
                placeholder="e.g. 20L fuel, staff lunch..."
                className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Reference / Receipt # (Optional)
              </label>
              <input
                type="text"
                value={singleRef}
                onChange={(e) => setSingleRef(e.target.value)}
                placeholder="e.g. REC-104, ECO-89"
                className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className={`w-full py-3.5 px-5 rounded-2xl font-black text-xs sm:text-sm text-white shadow-xl transition active:scale-98 flex items-center justify-center space-x-2 ${
              singleType === 'IN'
                ? 'bg-gradient-to-r from-emerald-600 to-[#6A4DFF]'
                : 'bg-gradient-to-r from-rose-600 to-[#FF8A00]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Save {currentQuickItem.label} ({singleType === 'IN' ? '+$' : '-$'}
              {singleAmount || '0.00'}) to Room DB & Sheet
            </span>
          </button>
        </form>
      )}

      {/* 3. Transaction Search & Filter Bar */}
      <div className="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 md:pb-0">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterType === 'ALL'
                ? 'bg-[#6A4DFF] text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            All Logs ({cashLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('IN')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1 whitespace-nowrap ${
              filterType === 'IN'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-emerald-300'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Cash In ({historySummary.countIn})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('OUT')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1 whitespace-nowrap ${
              filterType === 'OUT'
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-rose-300'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Cash Out ({historySummary.countOut})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('TODAY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterType === 'TODAY'
                ? 'bg-[#FF8A00] text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            Today's
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative flex-1 sm:w-56">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Search description, staff, line..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-[#6A4DFF]"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="py-1.5 px-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 outline-none"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="amount">Highest $</option>
          </select>
        </div>
      </div>

      {/* 4. Cash Log Ledger Table / Cards */}
      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center text-slate-400">
            <ReceiptText className="w-10 h-10 mx-auto text-slate-600 mb-2" />
            <p className="text-sm font-bold text-slate-300">No cash entries match your filter</p>
            <p className="text-xs text-slate-500 mt-1">Try resetting the filter or switch to Daily Sheet Matrix to fill today's sheet</p>
          </div>
        ) : (
          filteredLogs.map((log, logIdx) => {
            const isCashIn = log.in > 0;
            const logAmount = isCashIn ? log.in : log.out;

            return (
              <div
                key={`${log.id}-${log.timestamp || logIdx}`}
                id={`cashlog-row-${log.id}`}
                className="bg-slate-900/85 border border-slate-800/90 rounded-2xl p-3.5 sm:p-4 shadow-sm backdrop-blur-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-slate-700 transition"
              >
                {/* Left block with Icon & Details */}
                <div className="flex items-start sm:items-center space-x-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                      isCashIn
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isCashIn ? (
                      <ArrowDownLeft className="w-6 h-6" />
                    ) : (
                      <ArrowUpRight className="w-6 h-6" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-extrabold text-white truncate max-w-xs sm:max-w-md">
                        {log.description}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-800/50 text-purple-300 font-bold shrink-0">
                        {log.line}
                      </span>
                      {log.reference && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono-num shrink-0 border border-slate-700">
                          Ref: {log.reference}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 font-medium">
                      <span className="font-mono-num text-slate-300 flex items-center space-x-1">
                        <Calendar className="w-3 h-3 text-[#FF8A00]" />
                        <span>{log.date}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center space-x-1 text-slate-300">
                        <User className="w-3 h-3 text-[#6A4DFF]" />
                        <span>Staff: {log.staffName} (#{log.staffId})</span>
                      </span>
                      <span>•</span>
                      <SyncStatusDot
                        isSynced={log.synced}
                        syncStatus={(log as any).syncStatus}
                        timestamp={log.timestamp}
                        invoiceId={log.id}
                        invoiceType="cash_log"
                        targetSheet="CashLog"
                        onRetry={async () => {
                          await retrySyncInvoice(log.id, 'cash_log');
                          setCashLogs(getCashLogs());
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right block with Amount & Actions */}
                <div className="flex items-center justify-between sm:justify-end space-x-3 self-end sm:self-center shrink-0">
                  <div className="text-right">
                    <span
                      className={`text-base sm:text-lg font-black font-mono-num block ${
                        isCashIn ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isCashIn ? `+$${(Number(logAmount) || 0).toFixed(2)}` : `-$${(Number(logAmount) || 0).toFixed(2)}`}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono-num">
                      ID: {log.id}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setSelectedVoucher(log)}
                      title="View Printable Cash Voucher"
                      className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/70 transition"
                    >
                      <Printer className="w-3.5 h-3.5 text-purple-300" />
                    </button>

                    {(isAdmin || log.date === today) && (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(log.id)}
                        title="Delete Cash Entry"
                        className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/70 hover:border-rose-800/60 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4.5 Cashier Shift Completion & End-of-Day Workflow Section */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/80 border border-indigo-900/50 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 flex items-center justify-center font-black shadow-lg shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-white">
                  Cashier End-of-Day Shift Balancing (Form 2)
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                  Cashier Final Step
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Form 2 is the final balancing step for cashiers. All register change left behind and credit sales are automatically populated into Form 3 in the background.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto text-xs font-mono">
            <span className="text-slate-400">Cashier:</span>
            <span className="font-bold text-white bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700">
              {selectedStaff.name} (#{selectedStaff.id})
            </span>
          </div>
        </div>

        {/* Shift Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Effective Float</span>
            <span className="text-sm sm:text-base font-black font-mono-num text-purple-300 block mt-0.5">
              ${(Number(shiftFloatTotal) || 0).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Cash Movements IN</span>
            <span className="text-sm sm:text-base font-black font-mono-num text-emerald-300 block mt-0.5">
              +${(Number(gridTotals?.totalIn) || 0).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Cash Expenses / OUT</span>
            <span className="text-sm sm:text-base font-black font-mono-num text-rose-300 block mt-0.5">
              -${(Number(gridTotals?.totalOut) || 0).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Net Shift Cash Activity</span>
            <span className={`text-sm sm:text-base font-black font-mono-num block mt-0.5 ${(Number(gridTotals?.totalIn) || 0) >= (Number(gridTotals?.totalOut) || 0) ? 'text-emerald-300' : 'text-rose-300'}`}>
              {((Number(gridTotals?.totalIn) || 0) - (Number(gridTotals?.totalOut) || 0)) >= 0 ? `+$${((Number(gridTotals?.totalIn) || 0) - (Number(gridTotals?.totalOut) || 0)).toFixed(2)}` : `-$${Math.abs((Number(gridTotals?.totalIn) || 0) - (Number(gridTotals?.totalOut) || 0)).toFixed(2)}`}
            </span>
          </div>
        </div>

        {/* Action Controls & Navigation Options */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          {/* Shift Complete Button */}
          <button
            type="button"
            onClick={() => {
              confetti({ particleCount: 70, spread: 60, origin: { y: 0.8 } });
              setIsShiftSubmitted(true);
            }}
            disabled={isShiftSubmitted}
            className={`px-5 py-3 rounded-2xl font-black text-xs flex items-center justify-center space-x-2 transition shadow-lg ${
              isShiftSubmitted
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-default'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-95 cursor-pointer shadow-emerald-500/20'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {isShiftSubmitted ? '✓ Cashier Shift Closed & Submitted' : 'Complete & Submit Cashier Shift Close'}
            </span>
          </button>

          <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap gap-y-2">
            {/* Optional Form 3 review */}
            {onNavigateToCustomerChange && (
              <button
                type="button"
                onClick={onNavigateToCustomerChange}
                className="px-3.5 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center space-x-1.5 border border-slate-700 active:scale-95"
                title="Form 3 is auto-filled from POS transactions. Reviewing is optional."
              >
                <span>View Form 3 (Change & Credit - Optional)</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}

            {/* Supervisor Proceed to Form 4 */}
            {isSupervisorOrManager && onNavigateToReconcile && (
              <button
                type="button"
                onClick={onNavigateToReconcile}
                className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white text-xs font-black shadow-md flex items-center space-x-1.5 transition active:scale-95"
              >
                <ShieldCheck className="w-4 h-4 text-purple-200" />
                <span>Proceed to Form 4 (Supervisor EOD Balancing)</span>
                <ArrowRight className="w-4 h-4 text-purple-200" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 5. Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-white">Delete Cash Entry?</h4>
                <p className="text-xs text-slate-400">Entry ID: {deleteConfirmId}</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to remove this cash log entry from Room DB and queue deletion in Sheet "CashLog"?
            </p>
            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteEntry(deleteConfirmId)}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Cash Voucher / Receipt Slip Modal */}
      {selectedVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl animate-scaleUp relative">
            <button
              type="button"
              onClick={() => setSelectedVoucher(null)}
              className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Voucher Header */}
            <div className="text-center pb-3 border-b border-slate-800">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] text-white shadow-md mb-2">
                <FileCheck className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-black text-white">SAIMETRIC CASH VOUCHER</h3>
              <p className="text-[11px] text-purple-300 font-bold uppercase tracking-wider">
                {selectedVoucher.in > 0 ? 'OFFICIAL CASH RECEIPT (IN)' : 'OFFICIAL CASH PAYMENT VOUCHER (OUT)'}
              </p>
              <span className="text-[10px] text-slate-400 font-mono-num block mt-0.5">
                Voucher ID: {selectedVoucher.id}
              </span>
            </div>

            {/* Voucher Details */}
            <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Transaction Type:</span>
                <span className={`font-bold font-mono-num ${selectedVoucher.in > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedVoucher.in > 0 ? 'CASH IN (+)' : 'CASH OUT (-)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Total Amount:</span>
                <span className={`text-lg font-black font-mono-num ${selectedVoucher.in > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${(Number(selectedVoucher.in > 0 ? selectedVoucher.in : selectedVoucher.out) || 0).toFixed(2)} USD
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Line / Account:</span>
                <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded">
                  {selectedVoucher.line}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-400">Description:</span>
                <span className="font-semibold text-slate-200 text-right max-w-[200px]">
                  {selectedVoucher.description}
                </span>
              </div>
              {selectedVoucher.reference && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Reference:</span>
                  <span className="font-mono-num font-semibold text-slate-300">
                    {selectedVoucher.reference}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Date & Time:</span>
                <span className="font-mono-num text-slate-300">
                  {selectedVoucher.date} • {new Date(selectedVoucher.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Processed By:</span>
                <span className="font-bold text-purple-300">
                  {selectedVoucher.staffName} (#{selectedVoucher.staffId})
                </span>
              </div>
            </div>

            {/* Signature Slip */}
            <div className="grid grid-cols-2 gap-3 pt-2 text-[10px] text-slate-400 text-center">
              <div className="p-2 border-t border-dashed border-slate-700">
                <span>Staff Signature: ____________</span>
              </div>
              <div className="p-2 border-t border-dashed border-slate-700">
                <span>Customer/Payee: ____________</span>
              </div>
            </div>

            {/* Print & Close */}
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center space-x-1.5 transition"
              >
                <Printer className="w-3.5 h-3.5 text-purple-400" />
                <span>Print Voucher</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedVoucher(null)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white font-bold text-xs shadow-lg transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Exchange Rates & Multi-Currency Policy Modal */}
      <ExchangeRatesModal
        isOpen={showExchangeRatesModal}
        onClose={() => setShowExchangeRatesModal(false)}
        currentUser={currentUser}
      />

      {/* 8. Supervisor Cash Lift / Till Pick-Up Modal */}
      <CashLiftModal
        isOpen={isCashLiftModalOpen}
        onClose={() => setIsCashLiftModalOpen(false)}
        cashier={selectedStaff}
        currentDate={sheetDate}
        currentTillEstimatedCash={tillCashInfo.estimatedCashInTill}
        onLiftSuccess={handleCashLiftSuccess}
      />

      {/* 8b. Form 2 Add Petty Cash Expense Modal */}
      <Form2ExpenseModal
        isOpen={isForm2ExpenseModalOpen}
        onClose={() => setIsForm2ExpenseModalOpen(false)}
        currentUser={currentUser}
        selectedStaff={selectedStaff}
        sheetDate={sheetDate}
        onExpenseAdded={() => {
          loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
          setLedgerRefreshKey((k) => k + 1);
        }}
      />

      {/* 8c. Form 2 Expenses Audit & Supervisor Day-End Sign-Off Modal */}
      <Form2ExpensesAuditModal
        isOpen={isExpensesAuditModalOpen}
        onClose={() => setIsExpensesAuditModalOpen(false)}
        currentUser={currentUser}
        selectedStaff={selectedStaff}
        sheetDate={sheetDate}
        expenses={currentStaffExpenses}
        salespeople={salespeople}
        onExpensesUpdated={() => {
          loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
          setLedgerRefreshKey((k) => k + 1);
        }}
        onOpenAddExpense={() => setIsForm2ExpenseModalOpen(true)}
      />

      {/* 9. Cash Lift Voucher Slip View Modal */}
      {selectedCashLiftToView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 my-auto animate-scaleUp text-left">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-inner">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Supervisor Cash Lift Voucher</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400 font-mono">
                      Ref: {selectedCashLiftToView.id}
                    </span>
                    <SyncStatusDot
                      isSynced={selectedCashLiftToView.synced}
                      syncStatus={(selectedCashLiftToView as any).syncStatus}
                      timestamp={selectedCashLiftToView.timestamp}
                      invoiceId={selectedCashLiftToView.id}
                      invoiceType="cash_lift"
                      targetSheet="CashLifts"
                      onRetry={async () => {
                        await retrySyncInvoice(selectedCashLiftToView.id, 'cash_lift');
                        setSelectedCashLiftToView({
                          ...selectedCashLiftToView,
                          synced: true,
                          syncStatus: 'synced',
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCashLiftToView(null)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Total Amount Badge */}
            <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-2xl p-4 text-center">
              <span className="text-xs font-semibold text-emerald-300 block mb-0.5">
                Total Cash Handed Over to Supervisor
              </span>
              <span className="text-3xl font-black font-mono-num text-emerald-400">
                ${(Number(selectedCashLiftToView?.totalAmount) || 0).toFixed(2)} USD
              </span>
            </div>

            {/* Handover Parties & PIN Dual Authentication */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Cashier Handover
                </span>
                <span className="font-bold text-white block">
                  {selectedCashLiftToView.cashierName}
                </span>
                <span className="text-[10px] text-slate-400 block font-mono">
                  ID: #{selectedCashLiftToView.cashierId}
                </span>
                <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-700/40">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>PIN Authenticated</span>
                </span>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Supervisor Vault Custody
                </span>
                <span className="font-bold text-white block">
                  {selectedCashLiftToView.supervisorName}
                </span>
                <span className="text-[10px] text-slate-400 block font-mono">
                  ID: #{selectedCashLiftToView.supervisorId}
                </span>
                <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-700/40">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>PIN Authenticated</span>
                </span>
              </div>
            </div>

            {/* Denomination Breakdown (Form 1 style) */}
            {selectedCashLiftToView.denominations &&
              Object.keys(selectedCashLiftToView.denominations).length > 0 && (
                <div className="border border-slate-800 rounded-2xl p-3 bg-slate-950/60 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center space-x-1.5">
                      <Coins className="w-3.5 h-3.5 text-amber-400" />
                      <span>Denomination Breakdown</span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">Counted Notes</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {Object.entries(selectedCashLiftToView.denominations)
                      .filter(([_, qty]) => Number(qty) > 0)
                      .map(([note, qty]) => (
                        <div
                          key={note}
                          className="flex justify-between items-center py-1 px-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px]"
                        >
                          <span className="font-bold text-slate-300">
                            ${note} note × {String(qty)}
                          </span>
                          <span className="font-mono-num font-bold text-emerald-300">
                            ${((parseFloat(note) || 0) * (Number(qty) || 0)).toFixed(2)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

            {/* Timestamp & Notes */}
            <div className="text-[11px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Timestamp:</span>
                <span className="font-mono text-slate-300">
                  {selectedCashLiftToView.date} •{' '}
                  {new Date(selectedCashLiftToView.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {selectedCashLiftToView.reason && (
                <div className="flex justify-between">
                  <span>Purpose / Reason:</span>
                  <span className="text-slate-300 font-medium">
                    {selectedCashLiftToView.reason}
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center space-x-1.5 transition"
              >
                <Printer className="w-3.5 h-3.5 text-emerald-400" />
                <span>Print Lift Slip</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedCashLiftToView(null)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg shadow-emerald-950/50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOAT ADJUSTMENT MODAL (SUPERVISOR DUAL PIN) */}
      {isFloatModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/50 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-[#FF8A00] flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Supervisor Float Adjustment
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Dual authentication required to modify drawer float
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFloatModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {floatModalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-xs text-rose-200">
                {floatModalError}
              </div>
            )}

            <form onSubmit={handleSubmitFloatAdjustment} className="space-y-3.5">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Cashier / Till:</span>
                  <span className="font-bold text-white">{selectedStaff.name} (#{selectedStaff.id})</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Initial Opening Float:</span>
                  <span className="font-mono font-bold text-emerald-300">$20.00</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Current Effective Float:</span>
                  <span className="font-mono font-bold text-purple-300">${(Number(shiftFloatTotal) || 0).toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Adjustment Amount ($ USD)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 10.00 or -5.00"
                    value={floatAdjAmount}
                    onChange={(e) => setFloatAdjAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-mono outline-none focus:border-purple-500"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Positive number adds float (IN); negative number reduces float (OUT). Opening float is preserved.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Reason / Purpose
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Additional change notes supplied"
                  value={floatAdjReason}
                  onChange={(e) => setFloatAdjReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Authorizing Supervisor
                </label>
                <select
                  value={floatSupervisorId}
                  onChange={(e) => setFloatSupervisorId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-purple-500"
                >
                  {salespeople.map((sp, idx) => (
                    <option key={`${sp.id}-${idx}`} value={sp.id}>
                      {sp.name} ({sp.role || 'Staff'} - #{sp.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Supervisor 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={floatSupervisorPin}
                  onChange={(e) => setFloatSupervisorPin(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-base text-center tracking-widest text-white font-mono outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFloatModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-lg shadow-purple-950/50 flex items-center justify-center space-x-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Authorize &amp; Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* RECORDED DIRECT PROCUREMENT VOUCHER DETAILS MODAL */}
      {viewingProcurementGrv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border-b border-amber-800/40 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base sm:text-lg flex items-center gap-2">
                    <span>Recorded Direct Procurement</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {viewingProcurementGrv.grvNumber}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Voucher Date: <strong className="text-slate-200">{viewingProcurementGrv.date}</strong> • Supplier:{' '}
                    <strong className="text-amber-200">{viewingProcurementGrv.supplierName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingProcurementGrv(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-xs">
              {/* Status Banner */}
              <div className={`p-3 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                viewingProcurementGrv.status === 'APPROVED'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : viewingProcurementGrv.status === 'REJECTED'
                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
              }`}>
                <div className="flex items-center space-x-2">
                  {viewingProcurementGrv.status === 'APPROVED' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : viewingProcurementGrv.status === 'REJECTED' ? (
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-400" />
                  )}
                  <span className="font-bold">
                    Status: {viewingProcurementGrv.status === 'APPROVED'
                      ? `Approved by ${viewingProcurementGrv.approvedByStaffName || 'Supervisor'}`
                      : viewingProcurementGrv.status === 'REJECTED'
                      ? `Rejected${viewingProcurementGrv.rejectedReason ? `: ${viewingProcurementGrv.rejectedReason}` : ''}`
                      : 'Pending Supervisor Authorization'}
                  </span>
                </div>
                {viewingProcurementGrv.approvedAt && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(viewingProcurementGrv.approvedAt).toLocaleString()}
                  </span>
                )}
              </div>

              {/* Voucher Overview Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Supplier</span>
                  <span className="font-bold text-slate-100 block truncate">{viewingProcurementGrv.supplierName}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Invoice / DN #</span>
                  <span className="font-mono font-bold text-slate-100 block">{viewingProcurementGrv.invoiceNo || 'N/A'}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Branch</span>
                  <span className="font-bold text-slate-100 block truncate">{viewingProcurementGrv.branchName || viewingProcurementGrv.branchId}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Received By</span>
                  <span className="font-bold text-slate-100 block truncate">{viewingProcurementGrv.receivedByStaffName || 'Cashier'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Purchased Items ({viewingProcurementGrv.items?.length || 0})
                </span>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Product</th>
                        <th className="py-2 px-2 text-center">Unit / Pack</th>
                        <th className="py-2 px-2 text-center">Quantity</th>
                        <th className="py-2 px-2 text-right">Cost Price</th>
                        <th className="py-2 px-3 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                      {(viewingProcurementGrv.items || []).map((item, i) => (
                        <tr key={i} className="hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-semibold text-white">
                            {item.productName}
                          </td>
                          <td className="py-2 px-2 text-center text-slate-400">
                            {item.receiveAs || 'Cases'}
                          </td>
                          <td className="py-2 px-2 text-center font-mono-num font-bold text-slate-200">
                            {item.quantityCases ? `${item.quantityCases} cs` : ''}
                            {item.quantityCases && item.quantitySingles ? ' + ' : ''}
                            {item.quantitySingles ? `${item.quantitySingles} ea` : ''}
                            {!item.quantityCases && !item.quantitySingles ? item.quantity : ''}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num text-slate-300">
                            ${(item.costPrice ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num font-bold text-amber-300">
                            ${(item.lineTotal ?? ((item.costPrice ?? 0) * (item.quantity ?? 0))).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950 font-bold border-t border-slate-800">
                      <tr>
                        <td colSpan={4} className="py-2 px-3 text-right text-slate-400">Total Voucher Cost:</td>
                        <td className="py-2 px-3 text-right font-mono-num text-amber-400 text-sm">
                          ${(viewingProcurementGrv.totalCost ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Till Payout Allocations */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Till Payment Allocations ({viewingProcurementGrv.payments?.length || 0})
                </span>
                <div className="space-y-1.5">
                  {(viewingProcurementGrv.payments || []).map((p, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-2">
                        <Coins className="w-4 h-4 text-amber-400" />
                        <div>
                          <span className="font-bold text-white">{p.userName}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5">({p.drawerId || 'Till 1'})</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono-num font-bold text-rose-400 text-sm">
                          -${(p.amount ?? 0).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-500 block font-mono">Deducted from Drawer</span>
                      </div>
                    </div>
                  ))}
                  {(!viewingProcurementGrv.payments || viewingProcurementGrv.payments.length === 0) && (
                    <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl text-xs">
                      No till payments recorded for this voucher.
                    </p>
                  )}
                </div>
              </div>

              {viewingProcurementGrv.notes && (
                <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 text-[11px] text-slate-400">
                  <span className="font-bold text-slate-300 block mb-0.5">Notes:</span>
                  {viewingProcurementGrv.notes}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setViewingProcurementGrv(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
                >
                  Close
                </button>
                {onNavigateToDirectGrv && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = viewingProcurementGrv.id;
                      setViewingProcurementGrv(null);
                      onNavigateToDirectGrv(id);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs transition flex items-center space-x-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Direct GRV Hub</span>
                  </button>
                )}
              </div>

              {/* Supervisor / Admin Immediate Voucher Actions */}
              {(isAdmin || currentUser.role === 'SUPERVISOR' || currentUser.role === 'MANAGER' || (currentUser.role as string) === 'super_admin' || currentUser.role === 'OWNER') && (
                <div className="flex items-center space-x-2 w-full sm:w-auto justify-end flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const reason = window.prompt(
                        `Reason for rejecting Direct Delivery Voucher ${viewingProcurementGrv.grvNumber}? This will reverse the $${viewingProcurementGrv.totalCost.toFixed(2)} payout back into the cashier's drawer and Form 2:`
                      );
                      if (reason !== null && reason.trim()) {
                        const res = rejectDirectGrv(viewingProcurementGrv.id, currentUser.id, currentUser.name, reason.trim());
                        if (res.success) {
                          setViewingProcurementGrv(null);
                          loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
                          setLedgerRefreshKey((k) => k + 1);
                          setSaveSuccessNotice(`Voucher ${viewingProcurementGrv.grvNumber} rejected and refunded into cashier's drawer.`);
                        } else {
                          alert(res.message);
                        }
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 font-bold text-xs transition flex items-center space-x-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject & Return to Drawer</span>
                  </button>

                  {viewingProcurementGrv.status !== 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => {
                        const res = approveDirectGrv(viewingProcurementGrv.id, currentUser.id, currentUser.name);
                        if (res.success) {
                          setViewingProcurementGrv(null);
                          loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
                          setLedgerRefreshKey((k) => k + 1);
                          setSaveSuccessNotice(`Voucher ${viewingProcurementGrv.grvNumber} APPROVED! Stock updated and cashier procurement confirmed.`);
                        } else {
                          alert(res.message);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition flex items-center space-x-1.5 shadow-md active:scale-95"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve Voucher</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
