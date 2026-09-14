import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, CashLogEntry } from '../../types';
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
} from '../../db/roomDatabase';
import { downloadCsvFile } from '../../services/googleSheetsSync';
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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';

interface Form2CashLogProps {
  currentUser: Salesperson;
  onNavigateToCashCount?: () => void;
  onNavigateToCustomerChange?: () => void;
  onNavigateToHome?: () => void;
}

export interface StandardFixedPoint {
  id: string;
  categoryGroup: 'Float & Closeout' | 'Daily Utilities & Home';
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
  type: 'ecocash' | 'procurement' | 'cash';
  categoryGroup: 'EcoCash' | 'Direct Procurement' | 'Cash';
  label: string; // Clean label: "EcoCash", "Direct Procurement", or "Cash"
  allowIn: boolean;
  allowOut: boolean;
  defaultIn?: number | '';
  defaultOut?: number | '';
  placeholder?: string;
}

export const FIXED_CASH_LOG_ENTRY_POINTS: StandardFixedPoint[] = [
  // 1. Float & Closeout
  {
    id: 'final_cash_out',
    categoryGroup: 'Float & Closeout',
    description: 'Final Cash Out',
    defaultIn: '',
    defaultOut: '',
    allowIn: false,
    allowOut: true,
    isAutofilledFromCashCount: true,
    placeholder: 'Autofilled from Form 1 Cash Count',
  },
  {
    id: 'float',
    categoryGroup: 'Float & Closeout',
    description: 'Float',
    defaultIn: 20.0,
    defaultOut: '',
    allowIn: true,
    allowOut: false,
    placeholder: 'Morning drawer float ($20.00)',
  },
  {
    id: 'after_hours',
    categoryGroup: 'Float & Closeout',
    description: 'After Hours',
    defaultIn: '',
    defaultOut: '',
    allowIn: true,
    allowOut: true,
    placeholder: 'After-hours sales / cash in-out',
  },

  // 2. Daily Utilities & Home
  {
    id: 'bread',
    categoryGroup: 'Daily Utilities & Home',
    description: 'Bread',
    defaultIn: '',
    defaultOut: 0.0,
    allowIn: false,
    allowOut: true,
    placeholder: 'Staff bread & tea supplies',
  },
  {
    id: 'airtime',
    categoryGroup: 'Daily Utilities & Home',
    description: 'Airtime',
    defaultIn: '',
    defaultOut: 0.0,
    allowIn: false,
    allowOut: true,
    placeholder: 'Business airtime & data vouchers',
  },
  {
    id: 'home_use',
    categoryGroup: 'Daily Utilities & Home',
    description: 'Home use:Meat & vegetables',
    defaultIn: '',
    defaultOut: '',
    allowIn: false,
    allowOut: true,
    placeholder: 'Groceries, meat & vegetables',
  },
];

// Initial 2 default entries for each dynamic category
export const INITIAL_DYNAMIC_ROWS: DynamicSectionRow[] = [
  // EcoCash (2 default entries)
  {
    id: 'ecocash_1',
    type: 'ecocash',
    categoryGroup: 'EcoCash',
    label: 'EcoCash',
    allowIn: true,
    allowOut: true,
    placeholder: 'EcoCash customer transfer / cashout note',
  },
  {
    id: 'ecocash_2',
    type: 'ecocash',
    categoryGroup: 'EcoCash',
    label: 'EcoCash',
    allowIn: true,
    allowOut: true,
    placeholder: 'EcoCash transaction note',
  },

  // Direct Procurement (2 default entries)
  {
    id: 'proc_1',
    type: 'procurement',
    categoryGroup: 'Direct Procurement',
    label: 'Direct Procurement',
    allowIn: false,
    allowOut: true,
    placeholder: 'Direct procurement / supplier note',
  },
  {
    id: 'proc_2',
    type: 'procurement',
    categoryGroup: 'Direct Procurement',
    label: 'Direct Procurement',
    allowIn: false,
    allowOut: true,
    placeholder: 'Direct procurement / supplier note',
  },

  // Cash (2 default entries)
  {
    id: 'cash_1',
    type: 'cash',
    categoryGroup: 'Cash',
    label: 'Cash',
    allowIn: true,
    allowOut: true,
    placeholder: 'Cash transaction note',
  },
  {
    id: 'cash_2',
    type: 'cash',
    categoryGroup: 'Cash',
    label: 'Cash',
    allowIn: true,
    allowOut: true,
    placeholder: 'Cash transaction note',
  },
];

const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200];

export interface QuickEntryType {
  id: string;
  label: string;
  group: 'Float & Closeout' | 'Daily Utilities & Home' | 'EcoCash' | 'Direct Procurement' | 'Cash';
  allowIn: boolean;
  allowOut: boolean;
  defaultIn?: number | '';
  defaultOut?: number | '';
}

// Clean types for Quick Add single mode
const QUICK_ENTRY_TYPES: QuickEntryType[] = [
  { id: 'final_cash_out', label: 'Final Cash Out', group: 'Float & Closeout', allowIn: false, allowOut: true, defaultOut: '' },
  { id: 'float', label: 'Float', group: 'Float & Closeout', allowIn: true, allowOut: false, defaultIn: 20.0 },
  { id: 'after_hours', label: 'After Hours', group: 'Float & Closeout', allowIn: true, allowOut: true },
  { id: 'bread', label: 'Bread', group: 'Daily Utilities & Home', allowIn: false, allowOut: true, defaultOut: 0.0 },
  { id: 'airtime', label: 'Airtime', group: 'Daily Utilities & Home', allowIn: false, allowOut: true, defaultOut: 0.0 },
  { id: 'home_use', label: 'Home use:Meat & vegetables', group: 'Daily Utilities & Home', allowIn: false, allowOut: true },
  { id: 'ecocash', label: 'EcoCash', group: 'EcoCash', allowIn: true, allowOut: true },
  { id: 'direct_procurement', label: 'Direct Procurement', group: 'Direct Procurement', allowIn: false, allowOut: true },
  { id: 'cash', label: 'Cash', group: 'Cash', allowIn: true, allowOut: true },
];

export const Form2CashLog: React.FC<Form2CashLogProps> = ({
  currentUser,
  onNavigateToCashCount,
  onNavigateToCustomerChange,
  onNavigateToHome,
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
  const [isExistingSavedSheet, setIsExistingSavedSheet] = useState(false);

  const isToday = sheetDate === today;
  const isAdmin = currentUser.role === 'Admin';
  const isEditable = isAdmin || isToday; // Staff can only edit today; Admins can edit any day

  // Dynamic rows state (starts with 2 EcoCash, 2 Direct Procurement, 2 Cash)
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

  // Subscribe to Room DB changes
  useEffect(() => {
    const unsubscribe = subscribeToDatabase(() => {
      setCashCounts(getCashCounts());
      setCashLogs(getCashLogs());
    });
    return unsubscribe;
  }, []);

  // Find active cash count record for autofilling Final Cash Out
  const activeCashCount = useMemo(() => {
    if (!cashCounts || cashCounts.length === 0) return null;
    const exact = cashCounts.find((c) => c.date === sheetDate && c.staffId === selectedStaffId);
    if (exact) return exact;
    const staffMatch = cashCounts.find((c) => c.staffId === selectedStaffId);
    if (staffMatch) return staffMatch;
    const dateMatch = cashCounts.find((c) => c.date === sheetDate);
    if (dateMatch) return dateMatch;
    return cashCounts[0] || null;
  }, [cashCounts, sheetDate, selectedStaffId]);

  const activeCashCountId = activeCashCount?.id || '';
  const activeCashCountTotal = activeCashCount ? activeCashCount.finalCashOutTotal.toFixed(2) : '';

  // Core function to load saved daily sheet or initialize blank for staff + date
  const loadSheetDataForStaffAndDate = (targetDate: string, targetStaffId: string) => {
    const savedLogs = getCashLogsForStaffAndDate(targetStaffId, targetDate);
    const countForDate = getCashCountForStaffAndDate(targetStaffId, targetDate);

    if (savedLogs.length > 0) {
      setIsExistingSavedSheet(true);
      const newGrid: Record<string, { in: string; out: string; note: string; itemBought?: string }> = {};

      // Match Fixed points
      FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
        let matchLog: CashLogEntry | undefined;
        if (pt.id === 'final_cash_out') {
          matchLog = savedLogs.find(
            (l) => l.line === 'Final Cash Out' || (l.description && l.description.toLowerCase().includes('final cash out'))
          );
        } else if (pt.id === 'float') {
          matchLog = savedLogs.find(
            (l) => l.line === 'Float' || l.line === 'Opening Float' || (l.description && l.description.toLowerCase().startsWith('float'))
          );
        } else if (pt.id === 'after_hours') {
          matchLog = savedLogs.find((l) => (l.description || '').toLowerCase().includes('after hours'));
        } else if (pt.id === 'bread') {
          matchLog = savedLogs.find((l) => (l.description || '').toLowerCase().includes('bread'));
        } else if (pt.id === 'airtime') {
          matchLog = savedLogs.find((l) => (l.description || '').toLowerCase().includes('airtime'));
        } else if (pt.id === 'home_use') {
          matchLog = savedLogs.find(
            (l) => {
              const desc = (l.description || '').toLowerCase();
              return desc.includes('home use') || desc.includes('meat');
            }
          );
        }

        if (matchLog) {
          newGrid[pt.id] = {
            in: matchLog.in > 0 ? String(matchLog.in) : '',
            out: matchLog.out > 0 ? String(matchLog.out) : '',
            note: matchLog.reference || '',
          };
        } else {
          // Default fallback
          let initialOut = pt.defaultOut !== '' ? String(pt.defaultOut) : '';
          let initialNote = '';
          if (pt.id === 'final_cash_out' && countForDate) {
            initialOut = countForDate.finalCashOutTotal.toFixed(2);
            initialNote = `Autofilled from Cash Count (${countForDate.id})`;
          }
          newGrid[pt.id] = {
            in: pt.defaultIn !== '' ? String(pt.defaultIn) : '',
            out: initialOut,
            note: initialNote,
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
            !desc.includes('after hours') &&
            !desc.includes('bread') &&
            !desc.includes('airtime') &&
            !desc.includes('home use')
          );
        }
      );

      const ecoLogs = remainingDynamicLogs.filter(
        (l) => l.line === 'EcoCash' || l.category === 'EcoCash' || (l.description && l.description.toLowerCase().includes('ecocash'))
      );
      const procLogs = remainingDynamicLogs.filter(
        (l) =>
          l.line === 'Direct Procurement' ||
          l.category === 'Direct Procurement' ||
          (l.description && l.description.toLowerCase().includes('procurement'))
      );
      const cashLogsList = remainingDynamicLogs.filter(
        (l) =>
          (l.line === 'Cash' || l.category === 'Cash' || (l.description && l.description.toLowerCase().includes('cash'))) &&
          !ecoLogs.includes(l) &&
          !procLogs.includes(l)
      );

      const newDynamicRows: DynamicSectionRow[] = [];

      // Add EcoCash rows (at least 2)
      const ecoCount = Math.max(ecoLogs.length, 2);
      for (let i = 0; i < ecoCount; i++) {
        const id = `ecocash_dyn_${i}_${Date.now()}`;
        const log = ecoLogs[i];
        newDynamicRows.push({
          id,
          type: 'ecocash',
          categoryGroup: 'EcoCash',
          label: 'EcoCash',
          allowIn: true,
          allowOut: true,
          placeholder: 'EcoCash reference / payee...',
        });
        newGrid[id] = {
          in: log && log.in > 0 ? String(log.in) : '',
          out: log && log.out > 0 ? String(log.out) : '',
          note: log ? log.reference || log.description.replace(/^EcoCash(\s*-\s*)?/i, '') : '',
        };
      }

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

      // Add Cash rows (at least 2)
      const cashCount = Math.max(cashLogsList.length, 2);
      for (let i = 0; i < cashCount; i++) {
        const id = `cash_dyn_${i}_${Date.now()}`;
        const log = cashLogsList[i];
        newDynamicRows.push({
          id,
          type: 'cash',
          categoryGroup: 'Cash',
          label: 'Cash',
          allowIn: true,
          allowOut: true,
          placeholder: 'Cash reference / note...',
        });
        newGrid[id] = {
          in: log && log.in > 0 ? String(log.in) : '',
          out: log && log.out > 0 ? String(log.out) : '',
          note: log ? log.reference || log.description.replace(/^Cash(\s*-\s*)?/i, '') : '',
        };
      }

      setDynamicRows(newDynamicRows);
      setGridValues(newGrid);
    } else {
      // Clean new form for date
      setIsExistingSavedSheet(false);
      const initial: Record<string, { in: string; out: string; note: string; itemBought?: string }> = {};

      FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
        let initialOut = pt.defaultOut !== '' ? String(pt.defaultOut) : '';
        let initialNote = '';
        if (pt.id === 'final_cash_out' && countForDate) {
          initialOut = countForDate.finalCashOutTotal.toFixed(2);
          initialNote = `Autofilled from Cash Count (${countForDate.id})`;
        }

        initial[pt.id] = {
          in: pt.defaultIn !== '' ? String(pt.defaultIn) : '',
          out: initialOut,
          note: initialNote,
        };
      });

      INITIAL_DYNAMIC_ROWS.forEach((row) => {
        initial[row.id] = {
          in: '',
          out: '',
          note: '',
          itemBought: '',
        };
      });

      setDynamicRows(INITIAL_DYNAMIC_ROWS);
      setGridValues(initial);
    }
  };

  // Load whenever sheetDate or selectedStaffId changes
  useEffect(() => {
    loadSheetDataForStaffAndDate(sheetDate, selectedStaffId);
  }, [sheetDate, selectedStaffId]);

  // Handler to add a new dynamic entry row (appended at bottom of section)
  const handleAddDynamicRow = (type: 'ecocash' | 'procurement' | 'cash') => {
    if (!isEditable) return;
    const newId = `${type}_${Date.now()}`;
    const categoryGroup =
      type === 'ecocash' ? 'EcoCash' : type === 'procurement' ? 'Direct Procurement' : 'Cash';
    const label = categoryGroup;
    const allowIn = type !== 'procurement';
    const allowOut = true;

    const newRow: DynamicSectionRow = {
      id: newId,
      type,
      categoryGroup,
      label,
      allowIn,
      allowOut,
      placeholder:
        type === 'procurement'
          ? 'Supplier / store note'
          : type === 'ecocash'
          ? 'EcoCash reference / payee...'
          : 'Cash reference / note...',
    };

    setDynamicRows((prev) => [...prev, newRow]);
    setGridValues((prev) => ({
      ...prev,
      [newId]: { in: '', out: '', note: '', itemBought: '' },
    }));
  };

  // Handler to remove a dynamic entry row
  const handleRemoveDynamicRow = (id: string) => {
    if (!isEditable) return;
    setDynamicRows((prev) => prev.filter((r) => r.id !== id));
    setGridValues((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  // Single Quick Add Form State
  const [selectedQuickId, setSelectedQuickId] = useState<string>('final_cash_out');
  const [singleType, setSingleType] = useState<'IN' | 'OUT'>('OUT');
  const [singleAmount, setSingleAmount] = useState<string>(() => {
    return activeCashCount ? activeCashCount.finalCashOutTotal.toFixed(2) : '20.00';
  });
  const [singleItemBought, setSingleItemBought] = useState<string>(''); // For Direct Procurement
  const [singleCustomDesc, setSingleCustomDesc] = useState<string>('');
  const [singleRef, setSingleRef] = useState<string>('');

  // Modals & Popups
  const [selectedVoucher, setSelectedVoucher] = useState<CashLogEntry | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  // Filters & Search for History
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT' | 'TODAY'>('ALL');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount'>('newest');

  // Selected quick entry definition
  const currentQuickItem = useMemo(() => {
    return QUICK_ENTRY_TYPES.find((p) => p.id === selectedQuickId) || QUICK_ENTRY_TYPES[0];
  }, [selectedQuickId]);

  // Handle selecting quick add point
  const handleSelectQuickPoint = (pt: QuickEntryType) => {
    setSelectedQuickId(pt.id);
    if (pt.id === 'final_cash_out') {
      setSingleType('OUT');
      setSingleAmount(activeCashCount ? activeCashCount.finalCashOutTotal.toFixed(2) : '0.00');
      setSingleRef(activeCashCount ? activeCashCount.id : '');
    } else {
      if (pt.allowIn && !pt.allowOut) setSingleType('IN');
      else if (!pt.allowIn && pt.allowOut) setSingleType('OUT');
      if (typeof pt.defaultIn === 'number') setSingleAmount(String(pt.defaultIn));
      else if (typeof pt.defaultOut === 'number') setSingleAmount(String(pt.defaultOut));
    }
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
    setDynamicRows(INITIAL_DYNAMIC_ROWS);
    const initial: Record<string, { in: string; out: string; note: string; itemBought?: string }> = {};

    FIXED_CASH_LOG_ENTRY_POINTS.forEach((pt) => {
      let initialOut = pt.defaultOut !== '' ? String(pt.defaultOut) : '';
      let initialNote = '';
      if (pt.id === 'final_cash_out' && activeCashCount) {
        initialOut = activeCashCount.finalCashOutTotal.toFixed(2);
        initialNote = `Autofilled from Cash Count (${activeCashCount.id})`;
      }

      initial[pt.id] = {
        in: pt.defaultIn !== '' ? String(pt.defaultIn) : '',
        out: initialOut,
        note: initialNote,
      };
    });

    INITIAL_DYNAMIC_ROWS.forEach((row) => {
      initial[row.id] = {
        in: '',
        out: '',
        note: '',
        itemBought: '',
      };
    });

    setGridValues(initial);
  };

  // Force re-sync Final Cash Out from Form 1 (Cash Count)
  const handleReSyncCashCount = () => {
    if (!isEditable) return;
    if (activeCashCount) {
      setGridValues((prev) => ({
        ...prev,
        final_cash_out: {
          ...prev.final_cash_out,
          out: activeCashCount.finalCashOutTotal.toFixed(2),
          note: `Autofilled from Cash Count (${activeCashCount.id})`,
        },
      }));
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.7 } });
    } else {
      alert('No Form 1 Cash Count records found yet. Please record a Cash Count first.');
    }
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

    const net = totalIn - totalOut;
    return { totalIn, totalOut, net, filledCount };
  }, [gridValues, dynamicRows]);

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
        (pt.id === 'float' && row.in !== '') ||
        (pt.id === 'final_cash_out' && row.out !== '')
      ) {
        let fullDesc = pt.description;
        if (row.note.trim()) {
          fullDesc += ` - ${row.note.trim()}`;
        }

        entriesToSave.push({
          line: pt.categoryGroup,
          description: fullDesc,
          in: inAmt,
          out: outAmt,
          reference: row.note.trim() || undefined,
        });
      }
    });

    // 2. Dynamic points (EcoCash, Direct Procurement, Cash)
    dynamicRows.forEach((r) => {
      const row = gridValues[r.id];
      if (!row) return;

      const inAmt = parseFloat(row.in) || 0;
      const outAmt = parseFloat(row.out) || 0;

      if (inAmt > 0 || outAmt > 0) {
        let fullDesc = r.label; // Clean "EcoCash", "Direct Procurement", "Cash"

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
    const created = addCashLog({
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

  // Group dynamic rows by type for structured spreadsheet presentation
  const ecocashRows = useMemo(() => dynamicRows.filter((r) => r.type === 'ecocash'), [dynamicRows]);
  const procurementRows = useMemo(() => dynamicRows.filter((r) => r.type === 'procurement'), [dynamicRows]);
  const cashSectionRows = useMemo(() => dynamicRows.filter((r) => r.type === 'cash'), [dynamicRows]);

  return (
    <div className="space-y-4 pb-24 select-none">
      {/* 0. Sequential Form Stepper Navigation */}
      <FormStepNavigation
        currentStep={2}
        onPrevious={onNavigateToCashCount}
        previousLabel="Form 1: Cash Count"
        onNext={onNavigateToCustomerChange}
        nextLabel="Next: Form 3 (Customer Change)"
        onHome={onNavigateToHome}
        isAdmin={currentUser.role === 'Admin'}
      />

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
                Structured Daily Cash Log matching official Sheet <strong className="text-slate-300">"CashLog"</strong> with dynamic EcoCash, Direct Procurement & Cash entries
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
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

        {/* 3 KPI Summary Cards */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Total Cash In */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-emerald-500/25 flex items-center justify-between shadow-sm">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-extrabold text-emerald-400 tracking-wider">
                  Total Cash In
                </span>
                <span className="text-[10px] text-emerald-500/70 font-mono-num font-semibold">
                  (Today: ${gridTotals.totalIn.toFixed(2)})
                </span>
              </div>
              <span className="text-xl font-black font-mono-num text-emerald-300 block mt-0.5">
                +${activeView === 'spreadsheet' ? gridTotals.totalIn.toFixed(2) : historySummary.totalIn.toFixed(2)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>

          {/* Total Cash Out */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-rose-500/25 flex items-center justify-between shadow-sm">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-extrabold text-rose-400 tracking-wider">
                  Total Cash Out
                </span>
                <span className="text-[10px] text-rose-500/70 font-mono-num font-semibold">
                  (Today: ${gridTotals.totalOut.toFixed(2)})
                </span>
              </div>
              <span className="text-xl font-black font-mono-num text-rose-300 block mt-0.5">
                -${activeView === 'spreadsheet' ? gridTotals.totalOut.toFixed(2) : historySummary.totalOut.toFixed(2)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>

          {/* Net Drawer Balance */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-slate-950 border border-purple-500/40 flex items-center justify-between shadow-sm">
            <div>
              <span className="text-[10px] uppercase font-extrabold text-purple-300 tracking-wider block">
                Net Shift Cash Flow
              </span>
              <span
                className={`text-xl font-black font-mono-num block mt-0.5 ${
                  (activeView === 'spreadsheet' ? gridTotals.net : historySummary.net) >= 0
                    ? 'text-white'
                    : 'text-rose-400'
                }`}
              >
                ${(activeView === 'spreadsheet' ? gridTotals.net : historySummary.net).toFixed(2)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-[#FF8A00] border border-purple-500/40 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
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

              {/* Staff Selector */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                  <User className="w-3.5 h-3.5 text-[#6A4DFF]" />
                  <span>Staff:</span>
                </span>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="py-1.5 px-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-bold outline-none focus:border-[#6A4DFF]"
                >
                  {salespeople.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} (#{sp.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Actions & Final Cash Out Status */}
            <div className="flex items-center space-x-2 flex-wrap">
              {activeCashCount ? (
                <div className="py-1 px-3 rounded-xl bg-orange-950/80 border border-orange-500/50 text-[#FF8A00] text-xs font-bold flex items-center space-x-1.5 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-[#FF8A00] animate-pulse" />
                  <span>
                    Cash Count: <strong className="text-white font-mono-num">${activeCashCount.finalCashOutTotal.toFixed(2)}</strong>
                  </span>
                </div>
              ) : (
                <div className="py-1 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs font-medium">
                  No Cash Count recorded for date
                </div>
              )}

              <button
                type="button"
                onClick={handleReSyncCashCount}
                disabled={!isEditable}
                title="Re-sync Final Cash Out from Form 1 Cash Count"
                className="py-1.5 px-3 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-700/60 text-purple-300 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#FF8A00]" />
                <span>Re-sync Cash Count</span>
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

          {/* Cash Count Autofill Link Alert */}
          <div className="p-3 sm:p-4 rounded-2xl bg-gradient-to-r from-orange-950/80 via-slate-900 to-purple-950/80 border border-orange-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-orange-400 shrink-0 shadow-inner">
                <Sparkles className="w-5 h-5 animate-pulse text-[#FF8A00]" />
              </div>
              <div>
                <div className="flex items-center space-x-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-200">Form 1 Cash Count:</span>
                  {activeCashCount ? (
                    <span className="font-mono-num font-black text-sm text-[#FF8A00] bg-orange-950 px-2.5 py-0.5 rounded-lg border border-orange-500/60 shadow-sm">
                      ${activeCashCountTotal} OUT
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-500/40">
                      No Cash Count Recorded Yet
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {activeCashCount
                    ? `Autofilled on Row 1 (Final Cash Out) for ${selectedStaff.name} (${sheetDate})`
                    : 'Complete Form 1: Cash Count to autofill Final Cash Out'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 self-stretch sm:self-auto justify-end">
              {activeCashCount && (
                <button
                  type="button"
                  onClick={handleReSyncCashCount}
                  className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/60 text-orange-300 hover:text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#FF8A00]" />
                  <span>Re-sync (${activeCashCountTotal})</span>
                </button>
              )}
              {onNavigateToCashCount && (
                <button
                  type="button"
                  onClick={onNavigateToCashCount}
                  className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center justify-center space-x-1 transition shadow-md active:scale-95"
                >
                  <span>Form 1: Cash Count &rarr;</span>
                </button>
              )}
            </div>
          </div>

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
                    const isSpecialDefault =
                      (pt.id === 'float' && rowVal.in === '20') ||
                      (pt.id === 'bread' && rowVal.out === '0') ||
                      (pt.id === 'airtime' && rowVal.out === '0');

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
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`font-black text-xs sm:text-sm tracking-tight ${
                                isFinalCashOut
                                  ? 'text-[#FF8A00]'
                                  : pt.id === 'float'
                                  ? 'text-emerald-300'
                                  : 'text-white'
                              }`}
                            >
                              {pt.description}
                            </span>
                            {isFinalCashOut && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-orange-500/20 border border-orange-500/40 text-orange-300 font-extrabold flex items-center space-x-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                <span>Autofilled</span>
                              </span>
                            )}
                            {isSpecialDefault && !isFinalCashOut && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-800/60 text-purple-300 font-bold">
                                Default
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                            {isFinalCashOut ? (
                              <span className="text-orange-400 font-semibold font-mono-num">
                                Auto Cash Count: ${rowVal.out || activeCashCountTotal || '0.00'} OUT
                              </span>
                            ) : (
                              pt.categoryGroup
                            )}
                          </span>
                        </td>

                        {/* In Input */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          {pt.allowIn ? (
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
                          ) : isFinalCashOut ? (
                            <span className="text-[10px] text-orange-400/90 font-bold bg-orange-950/60 border border-orange-500/30 px-1 py-0.5 rounded inline-block whitespace-nowrap">
                              &rarr; In OUT
                            </span>
                          ) : (
                            <span className="text-slate-600 font-mono-num text-xs">—</span>
                          )}
                        </td>

                        {/* Out Input */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          {pt.allowOut ? (
                            <div className="relative max-w-[120px] mx-auto">
                              <span
                                className={`absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none font-bold text-xs ${
                                  isFinalCashOut ? 'text-orange-400' : 'text-rose-400'
                                }`}
                              >
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
                                  isFinalCashOut
                                    ? 'border-orange-500 bg-orange-950/60 text-[#FF8A00] font-black ring-1 ring-orange-500/60'
                                    : hasOut
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
                            disabled={!isEditable}
                            value={rowVal.note}
                            onChange={(e) => handleGridChange(pt.id, 'note', e.target.value)}
                            placeholder={pt.placeholder || 'Optional note...'}
                            className="w-full py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                          />
                        </td>

                        {/* Action Column */}
                        <td className="py-2 text-center text-slate-600 text-xs">
                          —
                        </td>
                      </tr>
                    );
                  })}

                  {/* SECTION 2: ECOCASH (Group Header & Dynamic Rows) */}
                  <tr className="bg-purple-950/60 border-y border-purple-800/40">
                    <td colSpan={6} className="py-2 px-3 sm:px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Smartphone className="w-4 h-4 text-purple-400" />
                          <span className="font-black text-xs uppercase tracking-wider text-purple-200">
                            EcoCash Transactions
                          </span>
                          <span className="text-[10px] text-purple-400 font-bold bg-purple-900/60 px-2 py-0.5 rounded-full border border-purple-700/50">
                            {ecocashRows.length} entries
                          </span>
                        </div>
                        {isEditable && (
                          <button
                            type="button"
                            onClick={() => handleAddDynamicRow('ecocash')}
                            className="py-1 px-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center space-x-1 transition shadow-sm active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add EcoCash Entry</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {ecocashRows.map((r, idx) => {
                    const rowVal = gridValues[r.id] || { in: '', out: '', note: '' };
                    const hasIn = parseFloat(rowVal.in) > 0;
                    const hasOut = parseFloat(rowVal.out) > 0;

                    return (
                      <tr
                        key={r.id}
                        className={`transition hover:bg-slate-800/60 ${
                          hasIn
                            ? 'bg-emerald-950/20'
                            : hasOut
                            ? 'bg-rose-950/20'
                            : idx % 2 === 0
                            ? 'bg-slate-950/30'
                            : 'bg-slate-900/30'
                        }`}
                      >
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-purple-400 font-bold">
                          E{idx + 1}
                        </td>
                        <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-xs sm:text-sm text-purple-200">
                              EcoCash
                            </span>
                          </div>
                          <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                            Mobile Money Entry
                          </span>
                        </td>

                        {/* In */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
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
                              onChange={(e) => handleGridChange(r.id, 'in', e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                hasIn
                                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-500/40'
                                  : 'border-slate-800 text-slate-300 focus:border-emerald-500'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Out */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <div className="relative max-w-[120px] mx-auto">
                            <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isEditable}
                              value={rowVal.out}
                              onChange={(e) => handleGridChange(r.id, 'out', e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                hasOut
                                  ? 'border-rose-500 bg-rose-950/40 text-rose-300 ring-1 ring-rose-500/40'
                                  : 'border-slate-800 text-slate-300 focus:border-rose-500'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Note */}
                        <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={rowVal.note}
                            onChange={(e) => handleGridChange(r.id, 'note', e.target.value)}
                            placeholder={r.placeholder || 'EcoCash reference / payee...'}
                            className="w-full py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                          />
                        </td>

                        {/* Action Delete */}
                        <td className="py-2 text-center">
                          {isEditable && ecocashRows.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveDynamicRow(r.id)}
                              title="Remove this extra entry"
                              className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* SECTION 3: DIRECT PROCUREMENT (Group Header & Dynamic Rows with Description Option) */}
                  <tr className="bg-amber-950/60 border-y border-amber-800/40">
                    <td colSpan={6} className="py-2 px-3 sm:px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <ShoppingBag className="w-4 h-4 text-amber-400" />
                          <span className="font-black text-xs uppercase tracking-wider text-amber-200">
                            Direct Procurement
                          </span>
                          <span className="text-[10px] text-amber-400 font-bold bg-amber-900/60 px-2 py-0.5 rounded-full border border-amber-700/50">
                            {procurementRows.length} entries
                          </span>
                        </div>
                        {isEditable && (
                          <button
                            type="button"
                            onClick={() => handleAddDynamicRow('procurement')}
                            className="py-1 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs flex items-center space-x-1 transition shadow-sm active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Procurement Entry</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {procurementRows.map((r, idx) => {
                    const rowVal = gridValues[r.id] || { in: '', out: '', note: '', itemBought: '' };
                    const hasOut = parseFloat(rowVal.out) > 0;

                    return (
                      <tr
                        key={r.id}
                        className={`transition hover:bg-slate-800/60 ${
                          hasOut ? 'bg-rose-950/20' : idx % 2 === 0 ? 'bg-slate-950/30' : 'bg-slate-900/30'
                        }`}
                      >
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-amber-400 font-bold">
                          P{idx + 1}
                        </td>
                        <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                          <div className="space-y-1">
                            <span className="font-bold text-xs sm:text-sm text-amber-200 block">
                              Direct Procurement
                            </span>
                            {/* What was bought field (optional description) */}
                            <input
                              type="text"
                              disabled={!isEditable}
                              value={rowVal.itemBought || ''}
                              onChange={(e) => handleGridChange(r.id, 'itemBought', e.target.value)}
                              placeholder="What was bought (optional, e.g. Cables, fuel, lunch)..."
                              className="w-full py-1 px-2 bg-slate-950/90 border border-amber-500/30 rounded-lg text-xs text-amber-100 placeholder-slate-500 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                            />
                          </div>
                        </td>

                        {/* In (Disabled for procurement) */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <span className="text-slate-600 font-mono-num text-xs">—</span>
                        </td>

                        {/* Out */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <div className="relative max-w-[120px] mx-auto">
                            <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isEditable}
                              value={rowVal.out}
                              onChange={(e) => handleGridChange(r.id, 'out', e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                hasOut
                                  ? 'border-rose-500 bg-rose-950/40 text-rose-300 ring-1 ring-rose-500/40'
                                  : 'border-slate-800 text-slate-300 focus:border-rose-500'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Note */}
                        <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={rowVal.note}
                            onChange={(e) => handleGridChange(r.id, 'note', e.target.value)}
                            placeholder={r.placeholder || 'Supplier / receipt #...'}
                            className="w-full py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                          />
                        </td>

                        {/* Action Delete */}
                        <td className="py-2 text-center">
                          {isEditable && procurementRows.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveDynamicRow(r.id)}
                              title="Remove this extra entry"
                              className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* SECTION 4: CASH ENTRIES (Group Header & Dynamic Rows) */}
                  <tr className="bg-emerald-950/60 border-y border-emerald-800/40">
                    <td colSpan={6} className="py-2 px-3 sm:px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Banknote className="w-4 h-4 text-emerald-400" />
                          <span className="font-black text-xs uppercase tracking-wider text-emerald-200">
                            Cash Entries
                          </span>
                          <span className="text-[10px] text-emerald-400 font-bold bg-emerald-900/60 px-2 py-0.5 rounded-full border border-emerald-700/50">
                            {cashSectionRows.length} entries
                          </span>
                        </div>
                        {isEditable && (
                          <button
                            type="button"
                            onClick={() => handleAddDynamicRow('cash')}
                            className="py-1 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1 transition shadow-sm active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Cash Entry</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {cashSectionRows.map((r, idx) => {
                    const rowVal = gridValues[r.id] || { in: '', out: '', note: '' };
                    const hasIn = parseFloat(rowVal.in) > 0;
                    const hasOut = parseFloat(rowVal.out) > 0;

                    return (
                      <tr
                        key={r.id}
                        className={`transition hover:bg-slate-800/60 ${
                          hasIn
                            ? 'bg-emerald-950/20'
                            : hasOut
                            ? 'bg-rose-950/20'
                            : idx % 2 === 0
                            ? 'bg-slate-950/30'
                            : 'bg-slate-900/30'
                        }`}
                      >
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center text-[10px] sm:text-[11px] font-mono-num text-emerald-400 font-bold">
                          C{idx + 1}
                        </td>
                        <td className="py-2 sm:py-2.5 px-2 sm:px-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-xs sm:text-sm text-emerald-200">
                              Cash
                            </span>
                          </div>
                          <span className="text-[9px] sm:text-[10px] text-slate-500 block truncate">
                            Direct Cash Transaction
                          </span>
                        </td>

                        {/* In */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
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
                              onChange={(e) => handleGridChange(r.id, 'in', e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                hasIn
                                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-500/40'
                                  : 'border-slate-800 text-slate-300 focus:border-emerald-500'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Out */}
                        <td className="py-2 sm:py-2.5 px-1 sm:px-3 text-center">
                          <div className="relative max-w-[120px] mx-auto">
                            <span className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-rose-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isEditable}
                              value={rowVal.out}
                              onChange={(e) => handleGridChange(r.id, 'out', e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-5 pr-1 sm:pl-6 sm:pr-2 py-1.5 bg-slate-950 border rounded-xl text-xs sm:text-sm font-mono-num font-bold outline-none text-right transition disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60 ${
                                hasOut
                                  ? 'border-rose-500 bg-rose-950/40 text-rose-300 ring-1 ring-rose-500/40'
                                  : 'border-slate-800 text-slate-300 focus:border-rose-500'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Note */}
                        <td className="py-2 sm:py-2.5 px-3 sm:px-4 hidden md:table-cell">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={rowVal.note}
                            onChange={(e) => handleGridChange(r.id, 'note', e.target.value)}
                            placeholder={r.placeholder || 'Cash reference / note...'}
                            className="w-full py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-75 disabled:bg-slate-900/60"
                          />
                        </td>

                        {/* Action Delete */}
                        <td className="py-2 text-center">
                          {isEditable && cashSectionRows.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveDynamicRow(r.id)}
                              title="Remove this extra entry"
                              className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Table Footer Totals */}
                <tfoot>
                  <tr className="bg-slate-950 font-black border-t-2 border-slate-800">
                    <td colSpan={2} className="py-3 px-4 text-right text-xs uppercase tracking-wider text-slate-400">
                      Total Column Values:
                    </td>
                    <td className="py-3 px-4 text-center font-mono-num text-sm text-emerald-400">
                      +${gridTotals.totalIn.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono-num text-sm text-rose-400">
                      -${gridTotals.totalOut.toFixed(2)}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-xs font-mono-num text-purple-300 hidden md:table-cell">
                      Net: ${gridTotals.net.toFixed(2)}
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
          </div>

          {/* If Direct Procurement, show explicit "What was bought" field */}
          {currentQuickItem.id === 'direct_procurement' && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-1.5 animate-fadeIn">
              <label className="block text-xs font-black uppercase tracking-wider text-amber-300">
                What was bought / Item Details (Optional)
              </label>
              <input
                type="text"
                value={singleItemBought}
                onChange={(e) => setSingleItemBought(e.target.value)}
                placeholder="e.g. Cables, fuel, lunch, packaging tape..."
                className="w-full py-2 px-3 bg-slate-950 border border-amber-500/50 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400"
              />
              <p className="text-[10px] text-amber-400/80">
                Optional description of the purchase (e.g. hardware, refreshments, generator fuel)
              </p>
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
                      <span className="text-emerald-400/90 text-[10px] font-semibold flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Sheet "CashLog"</span>
                      </span>
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
                      {isCashIn ? `+$${logAmount.toFixed(2)}` : `-$${logAmount.toFixed(2)}`}
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
                  ${(selectedVoucher.in > 0 ? selectedVoucher.in : selectedVoucher.out).toFixed(2)} USD
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
    </div>
  );
};
