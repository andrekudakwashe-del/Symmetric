import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Customer, Salesperson, CustomerChangeEntry, CreditSaleEntry } from '../../types';
import {
  getCustomers,
  addCustomer,
  getCustomerChanges,
  deleteCustomerChange,
  saveDailyCustomerChangeSheet,
  getCreditSales,
  deleteCreditSale,
  saveDailyCreditSalesSheet,
  getSalespeople,
  subscribeToDatabase,
  getTodayDateString,
  getCustomerChangesForStaffAndDate,
  getCreditSalesForStaffAndDate,
} from '../../db/roomDatabase';
import { downloadCsvFile } from '../../services/googleSheetsSync';
import {
  ArrowLeftRight,
  Plus,
  Trash2,
  Download,
  Calendar,
  User,
  CheckCircle2,
  Search,
  Sparkles,
  Printer,
  X,
  FileCheck,
  RefreshCw,
  Table,
  Save,
  ShoppingBag,
  CreditCard,
  UserPlus,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  FileText,
  Clock,
  History,
  AlertCircle,
  HelpCircle,
  Coins,
  ChevronDown,
  Check,
  Lock,
  Home,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';
import { CustomerAutocompleteInput } from '../common/CustomerAutocompleteInput';
import { CustomerChangeReport } from '../reports/CustomerChangeReport';
import { CustomerCreditReport } from '../reports/CustomerCreditReport';

interface Form3CustomerChangeProps {
  currentUser: Salesperson;
  preselectedCustomer?: Customer | string | null;
  onNavigateToCashLog?: () => void;
  onNavigateToHome?: () => void;
  onNavigateToReconcile?: () => void;
}

export interface CustomerChangeRowState {
  id: string;
  customerName: string;
  customerId?: string;
  in: string;
  out: string;
  notes: string;
  isDynamicExtra?: boolean;
}

export interface CreditSaleRowState {
  id: string;
  customerName: string;
  customerId?: string;
  amount: string;
  in: string;
  out: string;
  itemDescription: string;
  dueDate: string;
  notes: string;
  isDynamicExtra?: boolean;
}

// Generate 10 default rows for Customer Change
const createInitialChangeRows = (): CustomerChangeRowState[] => {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `chg_row_${i + 1}`,
    customerName: '',
    customerId: undefined,
    in: '',
    out: '',
    notes: '',
    isDynamicExtra: false,
  }));
};

// Generate 5 default rows for Credit Sales
const createInitialCreditRows = (): CreditSaleRowState[] => {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `credit_row_${i + 1}`,
    customerName: '',
    customerId: undefined,
    amount: '',
    in: '',
    out: '',
    itemDescription: '',
    dueDate: '',
    notes: '',
    isDynamicExtra: false,
  }));
};

const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200];

export const Form3CustomerChange: React.FC<Form3CustomerChangeProps> = ({
  currentUser,
  preselectedCustomer = null,
  onNavigateToCashLog,
  onNavigateToHome,
  onNavigateToReconcile,
}) => {
  const today = getTodayDateString();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(currentUser.id);
  const [viewMode, setViewMode] = useState<'sheet' | 'single' | 'history' | 'change_report' | 'credit_report'>('sheet');
  const [searchFilter, setSearchFilter] = useState<string>('');

  const isToday = selectedDate === today;
  const isAdmin = currentUser.role === 'Admin';
  const isEditable = isAdmin || isToday; // Staff can only edit today; Admins can edit any day

  // DB Data
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers());
  const [salespeople, setSalespeople] = useState<Salesperson[]>(() => getSalespeople());
  const [historyChangeLogs, setHistoryChangeLogs] = useState<CustomerChangeEntry[]>(() =>
    getCustomerChanges()
  );
  const [historyCreditLogs, setHistoryCreditLogs] = useState<CreditSaleEntry[]>(() =>
    getCreditSales()
  );

  // Check if existing saved entries exist for this staff & date
  const isExistingSavedSheet = useMemo(() => {
    const chg = getCustomerChangesForStaffAndDate(selectedStaffId, selectedDate);
    const cred = getCreditSalesForStaffAndDate(selectedStaffId, selectedDate);
    return chg.length > 0 || cred.length > 0;
  }, [selectedStaffId, selectedDate, historyChangeLogs, historyCreditLogs]);

  const getPreselectedName = (cust: Customer | string | null | undefined): string => {
    if (!cust) return '';
    if (typeof cust === 'string') return cust;
    return cust.name || '';
  };

  const getPreselectedId = (cust: Customer | string | null | undefined): string | undefined => {
    if (!cust) return undefined;
    if (typeof cust === 'object') return cust.customerId;
    const target = cust.trim().toLowerCase();
    const match = customers.find((c) => ((c.name || '').toLowerCase() === target) || ((c.customerId || '').toLowerCase() === target));
    return match ? match.customerId : undefined;
  };

  // Main Rows State
  const [changeRows, setChangeRows] = useState<CustomerChangeRowState[]>(() => {
    const initial = createInitialChangeRows();
    const preName = getPreselectedName(preselectedCustomer);
    if (preName) {
      initial[0].customerName = preName;
      initial[0].customerId = getPreselectedId(preselectedCustomer);
    }
    return initial;
  });

  const [creditRows, setCreditRows] = useState<CreditSaleRowState[]>(() => {
    return createInitialCreditRows();
  });

  // Load existing saved sheet entries when date or staff changes
  useEffect(() => {
    const savedChanges = getCustomerChangesForStaffAndDate(selectedStaffId, selectedDate);
    const savedCredits = getCreditSalesForStaffAndDate(selectedStaffId, selectedDate);

    if (savedChanges.length > 0) {
      const loadedChangeRows: CustomerChangeRowState[] = savedChanges.map((c, idx) => ({
        id: c.id || `saved_chg_${idx}_${Date.now()}`,
        customerName: c.customerName || '',
        customerId: c.customerId,
        in: c.in > 0 ? String(c.in) : '',
        out: c.out > 0 ? String(c.out) : '',
        notes: c.notes || '',
        isDynamicExtra: idx >= 10,
      }));
      // Pad to at least 10 rows if needed
      while (loadedChangeRows.length < 10) {
        const idx = loadedChangeRows.length + 1;
        loadedChangeRows.push({
          id: `chg_pad_${idx}_${Date.now()}`,
          customerName: '',
          in: '',
          out: '',
          notes: '',
          isDynamicExtra: false,
        });
      }
      setChangeRows(loadedChangeRows);
    } else {
      const initial = createInitialChangeRows();
      const preName = getPreselectedName(preselectedCustomer);
      if (preName && isToday) {
        initial[0].customerName = preName;
        initial[0].customerId = getPreselectedId(preselectedCustomer);
      }
      setChangeRows(initial);
    }

    if (savedCredits.length > 0) {
      const loadedCreditRows: CreditSaleRowState[] = savedCredits.map((cr, idx) => ({
        id: cr.id || `saved_cred_${idx}_${Date.now()}`,
        customerName: cr.customerName || '',
        customerId: cr.customerId,
        amount: cr.amount > 0 ? String(cr.amount) : '',
        in: cr.in > 0 ? String(cr.in) : '',
        out: cr.out > 0 ? String(cr.out) : (cr.amount > 0 ? String(cr.amount) : ''),
        itemDescription: cr.itemDescription || '',
        dueDate: cr.dueDate || '',
        notes: cr.notes || '',
        isDynamicExtra: idx >= 5,
      }));
      while (loadedCreditRows.length < 5) {
        const idx = loadedCreditRows.length + 1;
        loadedCreditRows.push({
          id: `cred_pad_${idx}_${Date.now()}`,
          customerName: '',
          amount: '',
          in: '',
          out: '',
          itemDescription: '',
          dueDate: '',
          notes: '',
          isDynamicExtra: false,
        });
      }
      setCreditRows(loadedCreditRows);
    } else {
      setCreditRows(createInitialCreditRows());
    }
  }, [selectedDate, selectedStaffId]);

  // Sync preselected customer when prop updates
  useEffect(() => {
    const preName = getPreselectedName(preselectedCustomer);
    if (preName) {
      const preId = getPreselectedId(preselectedCustomer);
      setChangeRows((prev) => {
        const emptyIdx = prev.findIndex((r) => !(r.customerName || '').trim());
        const targetIdx = emptyIdx !== -1 ? emptyIdx : 0;
        const updated = [...prev];
        updated[targetIdx] = {
          ...updated[targetIdx],
          customerName: preName,
          customerId: preId,
        };
        return updated;
      });
      setCreditRows((prev) => {
        const emptyIdx = prev.findIndex((r) => !(r.customerName || '').trim());
        const targetIdx = emptyIdx !== -1 ? emptyIdx : 0;
        const updated = [...prev];
        updated[targetIdx] = {
          ...updated[targetIdx],
          customerName: preName,
          customerId: preId,
        };
        return updated;
      });
    }
  }, [preselectedCustomer]);

  // Active Dropdown for Typeahead Autocomplete
  const [activeDropdownRowId, setActiveDropdownRowId] = useState<string | null>(null);

  // Single Quick Entry Mode State
  const [singleSection, setSingleSection] = useState<'change' | 'credit'>('change');
  const [singleCustomerName, setSingleCustomerName] = useState('');
  const [singleCustomerId, setSingleCustomerId] = useState<string | undefined>(undefined);
  const [singleChangeType, setSingleChangeType] = useState<'IN' | 'OUT'>('OUT');
  const [singleAmount, setSingleAmount] = useState('');
  const [singleDescription, setSingleDescription] = useState('');
  const [singleDueDate, setSingleDueDate] = useState('');
  const [singleNotes, setSingleNotes] = useState('');

  // Confirmation / Feedback
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [quickSavedCustomer, setQuickSavedCustomer] = useState<string | null>(null);

  // Print Voucher Modal
  const [voucherData, setVoucherData] = useState<{
    type: 'Customer Change' | 'Credit Sale';
    customerName: string;
    customerId?: string;
    amountIn?: number;
    amountOut?: number;
    amount?: number;
    description?: string;
    date: string;
    time: string;
    staffName: string;
    ref: string;
  } | null>(null);

  // Quick Register Modal State
  const [registerModalData, setRegisterModalData] = useState<{
    isOpen: boolean;
    name: string;
    phone: string;
    address: string;
    targetRowId?: string;
    targetSection?: 'change' | 'credit' | 'single';
  }>({
    isOpen: false,
    name: '',
    phone: '',
    address: '',
  });

  // Subscribe to DB updates
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setCustomers(getCustomers());
      setSalespeople(getSalespeople());
      setHistoryChangeLogs(getCustomerChanges());
      setHistoryCreditLogs(getCreditSales());
    });
    return () => unsub();
  }, []);

  const selectedStaff = useMemo(() => {
    return salespeople.find((s) => s.id === selectedStaffId) || currentUser;
  }, [salespeople, selectedStaffId, currentUser]);

  // Helper to check if customer is in database
  const getCustomerMatch = (name?: string | null): Customer | undefined => {
    if (!name || typeof name !== 'string') return undefined;
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return undefined;
    return customers.find(
      (c) => ((c.name || '').toLowerCase() === trimmed) || ((c.customerId || '').toLowerCase() === trimmed)
    );
  };

  // ==================== ROW MANIPULATION ====================
  const handleUpdateChangeRow = (id: string, updates: Partial<CustomerChangeRowState>) => {
    if (!isEditable) return;
    setChangeRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...updates };
        if (updates.customerName !== undefined) {
          const match = getCustomerMatch(updates.customerName);
          if (match) {
            updated.customerId = match.customerId;
          } else {
            updated.customerId = undefined;
          }
        }
        return updated;
      })
    );
  };

  const handleSelectCustomerForChangeRow = (rowId: string, customer: Customer) => {
    if (!isEditable) return;
    setChangeRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, customerName: customer.name, customerId: customer.customerId } : r))
    );
    setActiveDropdownRowId(null);
  };

  const handleAddChangeRow = () => {
    if (!isEditable) return;
    const newRow: CustomerChangeRowState = {
      id: `chg_row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      customerName: '',
      customerId: undefined,
      in: '',
      out: '',
      notes: '',
      isDynamicExtra: true,
    };
    setChangeRows((prev) => [...prev, newRow]);
  };

  const handleDeleteChangeRow = (id: string) => {
    if (!isEditable) return;
    setChangeRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearChangeRow = (id: string) => {
    if (!isEditable) return;
    setChangeRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, customerName: '', customerId: undefined, in: '', out: '', notes: '' } : r
      )
    );
  };

  // Credit rows handlers
  const handleUpdateCreditRow = (id: string, updates: Partial<CreditSaleRowState>) => {
    if (!isEditable) return;
    setCreditRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...updates };
        if (updates.customerName !== undefined) {
          const match = getCustomerMatch(updates.customerName);
          if (match) {
            updated.customerId = match.customerId;
          } else {
            updated.customerId = undefined;
          }
        }
        return updated;
      })
    );
  };

  const handleSelectCustomerForCreditRow = (rowId: string, customer: Customer) => {
    if (!isEditable) return;
    setCreditRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, customerName: customer.name, customerId: customer.customerId } : r))
    );
    setActiveDropdownRowId(null);
  };

  const handleAddCreditRow = () => {
    if (!isEditable) return;
    const newRow: CreditSaleRowState = {
      id: `credit_row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      customerName: '',
      customerId: undefined,
      amount: '',
      in: '',
      out: '',
      itemDescription: '',
      dueDate: '',
      notes: '',
      isDynamicExtra: true,
    };
    setCreditRows((prev) => [...prev, newRow]);
  };

  const handleDeleteCreditRow = (id: string) => {
    if (!isEditable) return;
    setCreditRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearCreditRow = (id: string) => {
    if (!isEditable) return;
    setCreditRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              customerName: '',
              customerId: undefined,
              amount: '',
              in: '',
              out: '',
              itemDescription: '',
              dueDate: '',
              notes: '',
            }
          : r
      )
    );
  };

  // ==================== INLINE CUSTOMER REGISTRATION ====================
  const handleOpenRegisterModal = (
    name: string,
    targetRowId?: string,
    targetSection?: 'change' | 'credit' | 'single'
  ) => {
    setRegisterModalData({
      isOpen: true,
      name: name.trim(),
      phone: '',
      address: '',
      targetRowId,
      targetSection,
    });
  };

  const handleQuickRegisterCustomer = (
    name: string,
    targetRowId?: string,
    targetSection?: 'change' | 'credit' | 'single'
  ) => {
    if (!isEditable) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const newCust = addCustomer({
      name: trimmed,
      createdBy: selectedStaff.id,
      phone: '',
      address: '',
    });

    if (targetSection === 'change' && targetRowId) {
      handleSelectCustomerForChangeRow(targetRowId, newCust);
    } else if (targetSection === 'credit' && targetRowId) {
      handleSelectCustomerForCreditRow(targetRowId, newCust);
    } else if (targetSection === 'single') {
      setSingleCustomerName(newCust.name);
      setSingleCustomerId(newCust.customerId);
    }

    setQuickSavedCustomer(newCust.name);
    setTimeout(() => setQuickSavedCustomer(null), 3500);
  };

  const handleSaveModalCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerModalData.name.trim()) return;

    const newCust = addCustomer({
      name: registerModalData.name.trim(),
      phone: registerModalData.phone.trim(),
      address: registerModalData.address.trim(),
      createdBy: selectedStaff.id,
    });

    if (registerModalData.targetSection === 'change' && registerModalData.targetRowId) {
      handleSelectCustomerForChangeRow(registerModalData.targetRowId, newCust);
    } else if (registerModalData.targetSection === 'credit' && registerModalData.targetRowId) {
      handleSelectCustomerForCreditRow(registerModalData.targetRowId, newCust);
    } else if (registerModalData.targetSection === 'single') {
      setSingleCustomerName(newCust.name);
      setSingleCustomerId(newCust.customerId);
    }

    setRegisterModalData({ isOpen: false, name: '', phone: '', address: '' });
    setQuickSavedCustomer(newCust.name);
    setTimeout(() => setQuickSavedCustomer(null), 3500);
  };

  // ==================== CALCULATIONS & TOTALS ====================
  const changeTotals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let validCount = 0;
    let newCustomersCount = 0;

    changeRows.forEach((r) => {
      const inVal = parseFloat(r.in) || 0;
      const outVal = parseFloat(r.out) || 0;
      const cName = (r.customerName || '').trim();
      if (cName && (inVal > 0 || outVal > 0)) {
        totalIn += inVal;
        totalOut += outVal;
        validCount++;
        if (!getCustomerMatch(cName)) {
          newCustomersCount++;
        }
      }
    });

    return { totalIn, totalOut, net: totalIn - totalOut, validCount, newCustomersCount };
  }, [changeRows, customers]);

  const creditTotals = useMemo(() => {
    let totalAmount = 0;
    let totalIn = 0;
    let totalOut = 0;
    let validCount = 0;
    let newCustomersCount = 0;

    creditRows.forEach((r) => {
      const inVal = parseFloat(r.in) || 0;
      const outVal = parseFloat(r.out) || 0;
      const amtVal = outVal > 0 ? outVal : (inVal > 0 ? inVal : (parseFloat(r.amount) || 0));
      const cName = (r.customerName || '').trim();
      if (cName && (inVal > 0 || outVal > 0 || amtVal > 0)) {
        totalAmount += amtVal;
        totalIn += inVal;
        totalOut += outVal;
        validCount++;
        if (!getCustomerMatch(cName)) {
          newCustomersCount++;
        }
      }
    });

    return { totalAmount, totalIn, totalOut, net: totalIn - totalOut, validCount, newCustomersCount };
  }, [creditRows, customers]);

  const totalEntriesToSave = changeTotals.validCount + creditTotals.validCount;
  const totalNewCustomersToRegister = changeTotals.newCustomersCount + creditTotals.newCustomersCount;

  // ==================== SAVE SPREADSHEET BATCH ====================
  const handleSaveAllSheet = (targetAction: 'stay' | 'next' | 'home' = 'stay') => {
    if (!isEditable) {
      alert('Permission Denied: Non-admin staff cannot edit or save forms from previous days.');
      return;
    }

    if (totalEntriesToSave === 0) {
      alert('Please fill in at least one valid Customer Change or Credit Sales entry with a Customer Name and Amount.');
      return;
    }

    // 1. Save Customer Changes
    const changeEntriesToSave = changeRows
      .filter((r) => (r.customerName || '').trim() !== '' && ((parseFloat(r.in) || 0) > 0 || (parseFloat(r.out) || 0) > 0))
      .map((r) => ({
        customerName: (r.customerName || '').trim(),
        customerId: r.customerId,
        in: parseFloat(r.in) || 0,
        out: parseFloat(r.out) || 0,
        notes: (r.notes || '').trim(),
      }));

    if (changeEntriesToSave.length > 0) {
      saveDailyCustomerChangeSheet(
        selectedDate,
        selectedStaff.id,
        selectedStaff.name,
        changeEntriesToSave
      );
    }

    // 2. Save Credit Sales
    const creditEntriesToSave = creditRows
      .filter(
        (r) =>
          (r.customerName || '').trim() !== '' &&
          ((parseFloat(r.amount) || 0) > 0 || (parseFloat(r.out) || 0) > 0 || (parseFloat(r.in) || 0) > 0)
      )
      .map((r) => {
        const inVal = parseFloat(r.in) || 0;
        const outVal = parseFloat(r.out) || 0;
        const effectiveAmount = outVal > 0 ? outVal : (inVal > 0 ? inVal : (parseFloat(r.amount) || 0));
        return {
          customerName: (r.customerName || '').trim(),
          customerId: r.customerId,
          amount: effectiveAmount,
          in: inVal,
          out: outVal > 0 ? outVal : effectiveAmount,
          itemDescription: (r.itemDescription || '').trim() || 'Credit Sale Items',
          dueDate: r.dueDate || '',
          notes: (r.notes || '').trim(),
        };
      });

    if (creditEntriesToSave.length > 0) {
      saveDailyCreditSalesSheet(
        selectedDate,
        selectedStaff.id,
        selectedStaff.name,
        creditEntriesToSave
      );
    }

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.65 },
      colors: ['#6A4DFF', '#FF8A00', '#10B981', '#38BDF8'],
    });

    setSaveSuccessMsg(
      `Successfully saved ${totalEntriesToSave} entries (${changeEntriesToSave.length} Customer Change, ${creditEntriesToSave.length} Credit Sales)!`
    );

    // Reset rows to clean state with 10 change & 5 credit
    setChangeRows(createInitialChangeRows());
    setCreditRows(createInitialCreditRows());

    if (targetAction === 'next') {
      if (isAdmin && onNavigateToReconcile) {
        setTimeout(() => onNavigateToReconcile(), 400);
      } else if (onNavigateToHome) {
        setTimeout(() => onNavigateToHome(), 400);
      }
    } else if (targetAction === 'home' && onNavigateToHome) {
      setTimeout(() => onNavigateToHome(), 400);
    }

    setTimeout(() => {
      setSaveSuccessMsg(null);
    }, 4500);
  };

  // ==================== SAVE SINGLE QUICK ENTRY ====================
  const handleSaveSingleEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditable) {
      alert('Permission Denied: Non-admin staff cannot save records for previous days.');
      return;
    }
    const custName = singleCustomerName.trim();
    if (!custName) {
      alert('Please enter or select a customer name.');
      return;
    }

    const amt = parseFloat(singleAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Please enter a valid positive dollar amount.');
      return;
    }

    if (singleSection === 'change') {
      const inVal = singleChangeType === 'IN' ? amt : 0;
      const outVal = singleChangeType === 'OUT' ? amt : 0;

      saveDailyCustomerChangeSheet(
        selectedDate,
        selectedStaff.id,
        selectedStaff.name,
        [
          {
            customerName: custName,
            customerId: singleCustomerId,
            in: inVal,
            out: outVal,
            notes: singleNotes.trim(),
          },
        ]
      );
    } else {
      saveDailyCreditSalesSheet(
        selectedDate,
        selectedStaff.id,
        selectedStaff.name,
        [
          {
            customerName: custName,
            customerId: singleCustomerId,
            amount: amt,
            in: 0,
            out: amt,
            itemDescription: singleDescription.trim() || 'Goods on Credit',
            dueDate: singleDueDate,
            notes: singleNotes.trim(),
          },
        ]
      );
    }

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#6A4DFF', '#FF8A00', '#10B981'],
    });

    setSaveSuccessMsg(`Saved single ${singleSection === 'change' ? 'Customer Change' : 'Credit Sale'} for ${custName}!`);

    // Reset single form
    setSingleCustomerName('');
    setSingleCustomerId(undefined);
    setSingleAmount('');
    setSingleDescription('');
    setSingleNotes('');

    setTimeout(() => {
      setSaveSuccessMsg(null);
    }, 4000);
  };

  // Filtered History
  const filteredChangeHistory = useMemo(() => {
    return historyChangeLogs.filter((c) => {
      if (searchFilter) {
        const q = (searchFilter || '').trim().toLowerCase();
        return (
          (c.customerName && c.customerName.toLowerCase().includes(q)) ||
          (c.staffName && c.staffName.toLowerCase().includes(q)) ||
          (c.notes && c.notes.toLowerCase().includes(q)) ||
          (c.date && String(c.date).includes(q))
        );
      }
      return c.date === selectedDate;
    });
  }, [historyChangeLogs, searchFilter, selectedDate]);

  const filteredCreditHistory = useMemo(() => {
    return historyCreditLogs.filter((cr) => {
      if (searchFilter) {
        const q = (searchFilter || '').trim().toLowerCase();
        return (
          (cr.customerName && cr.customerName.toLowerCase().includes(q)) ||
          (cr.staffName && cr.staffName.toLowerCase().includes(q)) ||
          (cr.itemDescription && cr.itemDescription.toLowerCase().includes(q)) ||
          (cr.date && String(cr.date).includes(q))
        );
      }
      return cr.date === selectedDate;
    });
  }, [historyCreditLogs, searchFilter, selectedDate]);

  return (
    <div className="space-y-5 pb-16 text-slate-100 animate-fadeIn">
      {/* 0. Sequential Form Stepper Navigation */}
      <FormStepNavigation
        currentStep={3}
        onPrevious={onNavigateToCashLog}
        previousLabel="Form 2: Cash Log"
        onNext={isAdmin && onNavigateToReconcile ? onNavigateToReconcile : onNavigateToHome}
        nextLabel={isAdmin && onNavigateToReconcile ? 'Next: Form 4 (Admin Balancing)' : 'Finish & Go Home'}
        onHome={onNavigateToHome}
        isAdmin={isAdmin}
      />

      {/* 1. Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-purple-950/40 to-slate-900 border border-purple-500/30 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="absolute top-0 right-0 transform translate-x-12 -translate-y-8 w-48 h-48 bg-gradient-to-br from-[#6A4DFF]/20 to-[#FF8A00]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center shadow-lg shadow-purple-900/30 text-white shrink-0">
              <ArrowLeftRight className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="text-[11px] font-black tracking-wider uppercase bg-purple-500/20 border border-purple-500/40 text-purple-300 px-2.5 py-0.5 rounded-full">
                  FORM 3 • CUSTOMER CHANGE & CREDIT
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  Room DB + Google Sheets Sync
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
                Customer Change & Credit Sales
              </h1>
            </div>
          </div>

          {/* Quick Top Actions & Save */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {viewMode === 'sheet' && (
              isEditable ? (
                <button
                  type="button"
                  id="btn-top-save-customer-change-credit"
                  onClick={handleSaveAllSheet}
                  disabled={totalEntriesToSave === 0}
                  className={`px-4 py-2 rounded-xl text-xs font-black flex items-center space-x-1.5 transition active:scale-95 shadow-lg ${
                    totalEntriesToSave > 0
                      ? 'bg-gradient-to-r from-[#6A4DFF] via-purple-600 to-[#FF8A00] text-white hover:brightness-110 shadow-purple-900/40 ring-1 ring-white/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
                  }`}
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Sheet {totalEntriesToSave > 0 ? `(${totalEntriesToSave})` : ''}</span>
                </button>
              ) : (
                <div className="px-3.5 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center space-x-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Historical Record (Read-Only)</span>
                </div>
              )
            )}

            <button
              type="button"
              onClick={() => handleOpenRegisterModal('')}
              className="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>New Customer</span>
            </button>

            <button
              type="button"
              onClick={() => downloadCsvFile('CustomerChange')}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95"
              title="Export Customer Change CSV"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" />
              <span>Change CSV</span>
            </button>

            <button
              type="button"
              onClick={() => downloadCsvFile('CreditSales')}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95"
              title="Export Credit Sales CSV"
            >
              <Download className="w-3.5 h-3.5 text-orange-400" />
              <span>Credit CSV</span>
            </button>
          </div>
        </div>

        {/* View Switch Tabs */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex p-1 bg-slate-950/70 border border-slate-800 rounded-2xl flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setViewMode('sheet')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'sheet'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Matrix Sheet (Default 10 & 5)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'single'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Quick Single Entry</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('history')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'history'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Change & Credit History</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('change_report')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'change_report'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                  : 'text-emerald-400 hover:text-emerald-200 hover:bg-emerald-950/40 border border-emerald-500/30'
              }`}
            >
              <Coins className="w-3.5 h-3.5 text-emerald-300" />
              <span>📊 Change Report (Owed & Aging)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('credit_report')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'credit_report'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-950'
                  : 'text-orange-400 hover:text-orange-200 hover:bg-orange-950/40 border border-orange-500/30'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5 text-orange-300" />
              <span>💳 Credit Debt Report</span>
            </button>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Customer DB auto-linking active</span>
          </div>
        </div>
      </div>

      {/* Daily report permission & status banner */}
      <div>
        {!isEditable ? (
          <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs shadow-sm">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Historical Record (Read-Only):</strong> Viewing Customer Change & Credit records for {selectedDate}. Non-admin staff cannot edit forms of previous days.
            </span>
          </div>
        ) : !isToday && isAdmin ? (
          <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs shadow-sm">
            <Sparkles className="w-4 h-4 text-[#FF8A00] shrink-0" />
            <span>
              <strong>Historical Record (Admin Edit Mode):</strong> Administrator override active for {selectedDate}. Any modifications will update upon saving.
            </span>
          </div>
        ) : isExistingSavedSheet ? (
          <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Saved Daily Sheet Loaded ({selectedDate}):</strong> Showing saved customer change and credit entries for today. Modifications will update upon saving.
            </span>
          </div>
        ) : null}
      </div>

      {/* 2. Feedback Toasts */}
      {saveSuccessMsg && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-2xl flex items-center justify-between text-emerald-200 text-sm shadow-xl animate-scaleUp">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-semibold">{saveSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMsg(null)}
            className="p-1 hover:bg-emerald-900/50 rounded-lg text-emerald-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {quickSavedCustomer && (
        <div className="p-3.5 bg-purple-950/80 border border-purple-500/50 rounded-2xl flex items-center justify-between text-purple-200 text-xs shadow-lg animate-scaleUp">
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-4 h-4 text-purple-300 shrink-0" />
            <span>
              Customer <strong>{quickSavedCustomer}</strong> was successfully registered in the Customer Database!
            </span>
          </div>
        </div>
      )}

      {/* 3. Global Sheet Bar (Date, Staff & Filter) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker */}
          <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300">
            <Calendar className="w-4 h-4 text-[#FF8A00]" />
            <span className="text-slate-400 font-medium">Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-white font-mono-num font-bold outline-none cursor-pointer"
            />
          </div>

          {/* Salesperson Selector */}
          <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300">
            <User className="w-4 h-4 text-[#6A4DFF]" />
            <span className="text-slate-400 font-medium">Salesperson:</span>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="bg-transparent text-white font-semibold outline-none cursor-pointer"
            >
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id} className="bg-slate-900 text-white">
                  {sp.name} (#{sp.id}) {sp.role === 'Admin' ? '★' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Real-time KPI summary badges */}
        <div className="flex items-center space-x-3 flex-wrap gap-y-2 text-xs">
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 font-semibold">
            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
            <span>Change In: ${changeTotals.totalIn.toFixed(2)}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-300 font-semibold">
            <ArrowUpRight className="w-3.5 h-3.5 text-rose-400" />
            <span>Change Out: ${changeTotals.totalOut.toFixed(2)}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-orange-950/60 border border-orange-500/30 text-orange-300 font-semibold">
            <CreditCard className="w-3.5 h-3.5 text-orange-400" />
            <span>Credit Total: ${creditTotals.totalAmount.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ==================== SPREADSHEET MATRIX VIEW ==================== */}
      {viewMode === 'sheet' && (
        <div className="space-y-8">
          {/* SECTION 1: CUSTOMER CHANGE (DEFAULT 10 ENTRIES) */}
          <div className="bg-slate-900/90 border border-purple-500/30 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#6A4DFF] to-purple-600 flex items-center justify-center text-white shadow-md">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-black tracking-tight text-white">CUSTOMER CHANGE</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold font-mono-num">
                      {changeRows.length} Rows
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Record customer cash in & out change transactions. Auto-suggests from Customer DB with 1-click registration.
                  </p>
                </div>
              </div>
            </div>

            {/* Change Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 select-none">
                    <th className="py-3 px-3 w-10 text-center font-mono-num">#</th>
                    <th className="py-3 px-3 min-w-[220px]">Customer Name</th>
                    <th className="py-3 px-3 w-32 text-right">Cash IN ($)</th>
                    <th className="py-3 px-3 w-32 text-right">Cash OUT ($)</th>
                    <th className="py-3 px-3 min-w-[180px]">Change Reason / Notes (Optional)</th>
                    <th className="py-3 px-2 w-16 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {changeRows.map((row, idx) => {
                    const match = getCustomerMatch(row.customerName);
                    const isFilled = row.customerName.trim() !== '';
                    const isNewCust = isFilled && !match;

                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-slate-900/60 transition-colors ${
                          row.isDynamicExtra ? 'bg-purple-950/10' : ''
                        }`}
                      >
                        {/* 1. Index # */}
                        <td className="py-2.5 px-3 text-center text-slate-500 font-mono-num font-bold">
                          {idx + 1}
                        </td>

                        {/* 2. Customer Name with Smart Typeahead Autocomplete */}
                        <td className="py-2 px-2 relative min-w-[210px]">
                          <CustomerAutocompleteInput
                            value={row.customerName}
                            disabled={!isEditable}
                            theme="purple"
                            placeholder={isEditable ? "Type name (e.g. Givemore)..." : "No customer"}
                            onChange={(name, cust) => {
                              handleUpdateChangeRow(row.id, {
                                customerName: name,
                                customerId: cust ? cust.customerId : undefined,
                              });
                            }}
                            onSelectCustomer={(cust) => {
                              handleSelectCustomerForChangeRow(row.id, cust);
                            }}
                            onRegisterNew={(typedName) => {
                              handleOpenRegisterModal(typedName, row.id, 'change');
                            }}
                            showBalances={true}
                          />
                        </td>

                        {/* 3. Cash IN */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="relative flex items-center w-full min-w-[95px]">
                            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none select-none text-emerald-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              disabled={!isEditable}
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={row.in}
                              onChange={(e) => handleUpdateChangeRow(row.id, { in: e.target.value })}
                              placeholder="0.00"
                              className={`w-full pl-6 pr-2 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 text-right font-mono-num text-xs font-bold text-emerald-300 placeholder-slate-600 outline-none transition ${
                                !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                              }`}
                            />
                          </div>
                        </td>

                        {/* 4. Cash OUT */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="relative flex items-center w-full min-w-[95px]">
                            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none select-none text-rose-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              disabled={!isEditable}
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={row.out}
                              onChange={(e) => handleUpdateChangeRow(row.id, { out: e.target.value })}
                              placeholder="0.00"
                              className={`w-full pl-6 pr-2 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 text-right font-mono-num text-xs font-bold text-rose-300 placeholder-slate-600 outline-none transition ${
                                !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                              }`}
                            />
                          </div>
                        </td>

                        {/* 5. Notes / Reason */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={row.notes}
                            onChange={(e) => handleUpdateChangeRow(row.id, { notes: e.target.value })}
                            placeholder={isEditable ? "e.g. Change for $100 bill, Tuckshop cashout" : "—"}
                            className={`w-full px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-purple-500 text-xs text-slate-300 placeholder-slate-600 outline-none transition ${
                              !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                            }`}
                          />
                        </td>

                        {/* 6. Row Action */}
                        <td className="py-2.5 px-2 text-center">
                          {isEditable ? (
                            row.isDynamicExtra ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteChangeRow(row.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition"
                                title="Delete extra row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleClearChangeRow(row.id)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition"
                                title="Clear row values"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ADD MORE ENTRY BUTTON (BELOW THE LAST ENTRY) */}
            {isEditable && (
              <div className="flex items-center justify-start pt-1">
                <button
                  type="button"
                  id="btn-add-more-change-entry-bottom"
                  onClick={handleAddChangeRow}
                  className="px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-purple-950/60 border border-purple-500/40 hover:border-purple-400 text-purple-200 text-xs font-bold flex items-center space-x-2 shadow-md transition active:scale-95 group"
                >
                  <div className="w-5 h-5 rounded-lg bg-[#6A4DFF]/30 text-purple-300 flex items-center justify-center group-hover:bg-[#6A4DFF] group-hover:text-white transition">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                  <span>+ Add More Customer Change Entry</span>
                </button>
              </div>
            )}

            {/* Change Subtotals */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 text-xs bg-slate-950/40 p-3 rounded-2xl border border-slate-800">
              <div className="text-slate-400">
                <span>Active Change Entries: </span>
                <strong className="text-white font-mono-num">{changeTotals.validCount}</strong>
                {changeTotals.newCustomersCount > 0 && (
                  <span className="ml-2 text-purple-300 font-semibold">
                    ({changeTotals.newCustomersCount} new customers detected)
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-4">
                <div>
                  <span className="text-slate-400 mr-1.5">Total IN:</span>
                  <strong className="text-emerald-300 font-mono-num font-bold text-sm">
                    ${changeTotals.totalIn.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">Total OUT:</span>
                  <strong className="text-rose-300 font-mono-num font-bold text-sm">
                    ${changeTotals.totalOut.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">Net Change:</span>
                  <strong
                    className={`font-mono-num font-black text-sm ${
                      changeTotals.net >= 0 ? 'text-purple-300' : 'text-rose-400'
                    }`}
                  >
                    ${changeTotals.net.toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: CREDIT SALES (SAME IN & OUT DESIGN LINKED TO CUSTOMER DB) */}
          <div className="bg-slate-900/90 border border-orange-500/30 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FF8A00] to-orange-600 flex items-center justify-center text-white shadow-md">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-black tracking-tight text-white">CREDIT SALES</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-bold font-mono-num">
                      {creditRows.length} Rows
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Track customer credit in & out, receivables, and item descriptions. Fully linked to Customer DB with 1-click registration.
                  </p>
                </div>
              </div>
            </div>

            {/* Credit Table with Same IN & OUT Design as Change */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 select-none">
                    <th className="py-3 px-3 w-10 text-center font-mono-num">#</th>
                    <th className="py-3 px-3 min-w-[220px]">Customer Name</th>
                    <th className="py-3 px-3 w-32 text-right">Credit IN ($)</th>
                    <th className="py-3 px-3 w-32 text-right">Credit OUT ($)</th>
                    <th className="py-3 px-3 min-w-[180px]">Goods / Item Description</th>
                    <th className="py-3 px-3 w-32">Payment Due Date</th>
                    <th className="py-3 px-3 min-w-[150px]">Notes</th>
                    <th className="py-3 px-2 w-16 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {creditRows.map((row, idx) => {
                    const match = getCustomerMatch(row.customerName);
                    const isFilled = row.customerName.trim() !== '';
                    const isNewCust = isFilled && !match;

                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-slate-900/60 transition-colors ${
                          row.isDynamicExtra ? 'bg-orange-950/10' : ''
                        }`}
                      >
                        {/* 1. Index # */}
                        <td className="py-2.5 px-3 text-center text-slate-500 font-mono-num font-bold">
                          {idx + 1}
                        </td>

                        {/* 2. Customer Name with Typeahead Autocomplete */}
                        <td className="py-2 px-2 relative min-w-[210px]">
                          <CustomerAutocompleteInput
                            value={row.customerName}
                            disabled={!isEditable}
                            theme="orange"
                            placeholder={isEditable ? "Type name (e.g. Givemore)..." : "No customer"}
                            onChange={(name, cust) => {
                              handleUpdateCreditRow(row.id, {
                                customerName: name,
                                customerId: cust ? cust.customerId : undefined,
                              });
                            }}
                            onSelectCustomer={(cust) => {
                              handleSelectCustomerForCreditRow(row.id, cust);
                            }}
                            onRegisterNew={(typedName) => {
                              handleOpenRegisterModal(typedName, row.id, 'credit');
                            }}
                            showBalances={true}
                          />
                        </td>

                        {/* 3. Credit IN (Payment Received) */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="relative flex items-center w-full min-w-[95px]">
                            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none select-none text-emerald-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              disabled={!isEditable}
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={row.in}
                              onChange={(e) => handleUpdateCreditRow(row.id, { in: e.target.value })}
                              placeholder="0.00"
                              className={`w-full pl-6 pr-2 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 text-right font-mono-num text-xs font-bold text-emerald-300 placeholder-slate-600 outline-none transition ${
                                !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                              }`}
                            />
                          </div>
                        </td>

                        {/* 4. Credit OUT (Credit Given / Goods Delivered) */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="relative flex items-center w-full min-w-[95px]">
                            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none select-none text-orange-400 font-bold text-xs">
                              $
                            </span>
                            <input
                              type="number"
                              disabled={!isEditable}
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={row.out || row.amount}
                              onChange={(e) =>
                                handleUpdateCreditRow(row.id, {
                                  out: e.target.value,
                                  amount: e.target.value,
                                })
                              }
                              placeholder="0.00"
                              className={`w-full pl-6 pr-2 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-[#FF8A00] focus:ring-1 focus:ring-orange-500/30 text-right font-mono-num text-xs font-bold text-orange-300 placeholder-slate-600 outline-none transition ${
                                !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                              }`}
                            />
                          </div>
                        </td>

                        {/* 5. Goods / Description */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={row.itemDescription}
                            onChange={(e) => handleUpdateCreditRow(row.id, { itemDescription: e.target.value })}
                            placeholder={isEditable ? "e.g. 2x 585W Solar Panels, 1x Inverter" : "—"}
                            className={`w-full px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-[#FF8A00] text-xs text-slate-200 placeholder-slate-600 outline-none transition ${
                              !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                            }`}
                          />
                        </td>

                        {/* 6. Payment Due Date */}
                        <td className="py-2.5 px-3">
                          <input
                            type="date"
                            disabled={!isEditable}
                            value={row.dueDate}
                            onChange={(e) => handleUpdateCreditRow(row.id, { dueDate: e.target.value })}
                            className={`w-full px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-[#FF8A00] text-xs text-slate-300 font-mono-num outline-none transition ${
                              !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : 'cursor-pointer'
                            }`}
                          />
                        </td>

                        {/* 7. Notes */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            disabled={!isEditable}
                            value={row.notes}
                            onChange={(e) => handleUpdateCreditRow(row.id, { notes: e.target.value })}
                            placeholder={isEditable ? "Terms / notes" : "—"}
                            className={`w-full px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-slate-500 text-xs text-slate-400 placeholder-slate-600 outline-none transition ${
                              !isEditable ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800' : ''
                            }`}
                          />
                        </td>

                        {/* 8. Action */}
                        <td className="py-2.5 px-2 text-center">
                          {isEditable ? (
                            row.isDynamicExtra ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteCreditRow(row.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition"
                                title="Delete extra row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleClearCreditRow(row.id)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition"
                                title="Clear row values"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ADD MORE CREDIT SALES ENTRY BUTTON (BELOW THE LAST ENTRY) */}
            {isEditable && (
              <div className="flex items-center justify-start pt-1">
                <button
                  type="button"
                  id="btn-add-more-credit-entry-bottom"
                  onClick={handleAddCreditRow}
                  className="px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-orange-950/60 border border-orange-500/40 hover:border-orange-400 text-orange-200 text-xs font-bold flex items-center space-x-2 shadow-md transition active:scale-95 group"
                >
                  <div className="w-5 h-5 rounded-lg bg-[#FF8A00]/30 text-orange-300 flex items-center justify-center group-hover:bg-[#FF8A00] group-hover:text-white transition">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                  <span>+ Add More Credit Sales Entry</span>
                </button>
              </div>
            )}

            {/* Credit Subtotals */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 text-xs bg-slate-950/40 p-3 rounded-2xl border border-slate-800">
              <div className="text-slate-400">
                <span>Active Credit Entries: </span>
                <strong className="text-white font-mono-num">{creditTotals.validCount}</strong>
                {creditTotals.newCustomersCount > 0 && (
                  <span className="ml-2 text-orange-300 font-semibold">
                    ({creditTotals.newCustomersCount} new customers detected)
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-4">
                <div>
                  <span className="text-slate-400 mr-1.5">Credit IN:</span>
                  <strong className="text-emerald-300 font-mono-num font-bold text-sm">
                    ${creditTotals.totalIn.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">Credit OUT:</span>
                  <strong className="text-orange-300 font-mono-num font-bold text-sm">
                    ${creditTotals.totalOut.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">Net Credit:</span>
                  <strong
                    className={`font-mono-num font-black text-sm ${
                      creditTotals.net >= 0 ? 'text-emerald-300' : 'text-rose-400'
                    }`}
                  >
                    ${creditTotals.net.toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* In-Flow Bottom Save Action Bar (Matching Form 2 Clean UX - Never Blocks Screen on Mobile) */}
          <div className="bg-slate-900/95 border border-purple-500/30 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center justify-center font-black font-mono-num text-sm shadow-inner shrink-0">
                  {totalEntriesToSave}
                </div>
                <div>
                  <div className="text-white font-black text-sm sm:text-base flex items-center space-x-2">
                    <span>
                      {totalEntriesToSave === 0
                        ? 'No active entries yet'
                        : `${totalEntriesToSave} Total Entries Ready to Save`}
                    </span>
                    {totalEntriesToSave > 0 && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                        Ready
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {totalNewCustomersToRegister > 0
                      ? `✨ ${totalNewCustomersToRegister} new customers will be registered in Customer DB & synced`
                      : 'All change & credit transactions will sync to Room DB & Google Sheets'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {isEditable ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setChangeRows(createInitialChangeRows());
                        setCreditRows(createInitialCreditRows());
                      }}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-bold text-xs transition active:scale-95 border border-slate-700/60"
                    >
                      Reset Rows
                    </button>

                    {/* Option 1: Save & Finish (or Form 4 if Admin) */}
                    <button
                      type="button"
                      id="btn-save-and-finish-form3"
                      onClick={() => handleSaveAllSheet('next')}
                      disabled={totalEntriesToSave === 0}
                      className={`px-4 py-2.5 rounded-xl font-black text-xs flex items-center space-x-1.5 transition-all shadow-md ${
                        totalEntriesToSave > 0
                          ? 'bg-gradient-to-r from-[#6A4DFF] via-purple-600 to-[#FF8A00] text-white hover:brightness-110 active:scale-95 shadow-purple-900/40 ring-1 ring-white/20'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      }`}
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {isAdmin && onNavigateToReconcile
                          ? 'Save & Go to Form 4 (Admin Balancing) \u2192'
                          : 'Save & Finish Session (Return Home) \u2192'}
                      </span>
                    </button>

                    {/* Option 2: Save & Close Session (Home) */}
                    <button
                      type="button"
                      id="btn-save-and-home-form3"
                      onClick={() => handleSaveAllSheet('home')}
                      disabled={totalEntriesToSave === 0}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs border border-slate-700 flex items-center space-x-1.5 transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Home className="w-3.5 h-3.5 text-slate-400" />
                      <span>Save & Return Home</span>
                    </button>

                    {/* Option 3: Commit Sheet Only */}
                    <button
                      type="button"
                      id="btn-save-daily-change-credit-sheet"
                      onClick={() => handleSaveAllSheet('stay')}
                      disabled={totalEntriesToSave === 0}
                      className="py-2 px-2.5 rounded-lg text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Sheet Only
                    </button>
                  </>
                ) : (
                  <div className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Historical Form Locked (Read-Only)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== QUICK SINGLE ENTRY MODE ==================== */}
      {viewMode === 'single' && (
        <div className="max-w-2xl mx-auto bg-slate-900/90 border border-purple-500/30 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-black text-white">Quick Single Entry Mode</h2>
              <p className="text-xs text-slate-400">Ideal for instant single transactions on mobile devices.</p>
            </div>

            {/* Section Switch */}
            <div className="inline-flex p-1 bg-slate-950 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => setSingleSection('change')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  singleSection === 'change'
                    ? 'bg-[#6A4DFF] text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Customer Change
              </button>
              <button
                type="button"
                onClick={() => setSingleSection('credit')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  singleSection === 'credit'
                    ? 'bg-[#FF8A00] text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Credit Sale
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveSingleEntry} className="space-y-4">
            {/* Customer Name with Substring & Prefix Autocomplete */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                Customer Name <span className="text-rose-400">*</span>
              </label>
              <CustomerAutocompleteInput
                value={singleCustomerName}
                theme={singleSection === 'credit' ? 'orange' : 'purple'}
                placeholder="Type customer name (e.g. Givemore)..."
                onChange={(name, cust) => {
                  setSingleCustomerName(name);
                  setSingleCustomerId(cust ? cust.customerId : undefined);
                }}
                onSelectCustomer={(cust) => {
                  setSingleCustomerName(cust.name);
                  setSingleCustomerId(cust.customerId);
                }}
                onRegisterNew={(typedName) => {
                  handleOpenRegisterModal(typedName, undefined, 'single');
                }}
                showBalances={true}
                inputClassName="py-2.5 text-sm"
              />

              {/* Quick Customer Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {customers.slice(0, 4).map((c) => (
                  <button
                    key={c.customerId}
                    type="button"
                    onClick={() => {
                      setSingleCustomerName(c.name);
                      setSingleCustomerId(c.customerId);
                    }}
                    className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-purple-950 border border-slate-800 text-[11px] text-slate-300 font-semibold transition"
                  >
                    {c.name} ({c.customerId})
                  </button>
                ))}
              </div>
            </div>

            {/* Change Direction (if Customer Change) */}
            {singleSection === 'change' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">Transaction Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSingleChangeType('OUT')}
                    className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center space-x-2 border transition ${
                      singleChangeType === 'OUT'
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-rose-400" />
                    <span>Cash OUT (Change Given)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSingleChangeType('IN')}
                    className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center space-x-2 border transition ${
                      singleChangeType === 'IN'
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                    <span>Cash IN (Customer Paid Note)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                Amount ($ USD) <span className="text-rose-400">*</span>
              </label>
              <div className="relative flex items-center">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none select-none text-slate-400 font-bold text-base">
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={singleAmount}
                  onChange={(e) => setSingleAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] text-lg font-mono-num font-bold text-white placeholder-slate-600 outline-none transition"
                  required
                />
              </div>

              {/* Quick Amount Chips */}
              <div className="flex flex-wrap gap-2 pt-1">
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setSingleAmount(String(amt))}
                    className="px-3 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono-num font-bold text-slate-300 hover:text-white transition active:scale-95"
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* If Credit Sale: Item Description & Due Date */}
            {singleSection === 'credit' && (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-300">Goods / Item Description</label>
                  <input
                    type="text"
                    value={singleDescription}
                    onChange={(e) => setSingleDescription(e.target.value)}
                    placeholder="e.g. 5x 585W Solar Panels, 1x Lithium Battery"
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#FF8A00] text-sm text-white placeholder-slate-500 outline-none transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-300">Payment Due Date (Optional)</label>
                  <input
                    type="date"
                    value={singleDueDate}
                    onChange={(e) => setSingleDueDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#FF8A00] text-sm text-white font-mono-num outline-none transition cursor-pointer"
                  />
                </div>
              </>
            )}

            {/* Notes / Reason */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">Notes / Reference (Optional)</label>
              <input
                type="text"
                value={singleNotes}
                onChange={(e) => setSingleNotes(e.target.value)}
                placeholder="e.g. Handed $15 change for $50 bill"
                className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] text-sm text-white placeholder-slate-500 outline-none transition"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:brightness-110 text-white font-black text-sm shadow-xl shadow-purple-900/30 transition active:scale-95 flex items-center justify-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>
                Save {singleSection === 'change' ? 'Customer Change' : 'Credit Sale'} Transaction
              </span>
            </button>
          </form>
        </div>
      )}

      {/* ==================== HISTORY & LOG DRAWER ==================== */}
      {viewMode === 'history' && (
        <div className="space-y-6">
          {/* History Search & Filter */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search history by customer, staff, or notes..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 outline-none focus:border-[#6A4DFF]"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="text-xs text-slate-400">
              Showing records for{' '}
              <strong className="text-white font-mono-num">
                {searchFilter ? 'All Dates (Filtered)' : selectedDate}
              </strong>
            </div>
          </div>

          {/* Customer Change History Table */}
          <div className="bg-slate-900/90 border border-purple-500/30 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <ArrowLeftRight className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-white text-sm">Customer Change History Log</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono-num font-semibold">
                {filteredChangeHistory.length} Records
              </span>
            </div>

            {filteredChangeHistory.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No customer change logs recorded for this date.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3 text-right">In ($)</th>
                      <th className="py-2.5 px-3 text-right">Out ($)</th>
                      <th className="py-2.5 px-3">Salesperson</th>
                      <th className="py-2.5 px-3">Notes</th>
                      <th className="py-2.5 px-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredChangeHistory.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-900/60">
                        <td className="py-2 px-3 font-mono-num text-slate-400">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 px-3 font-semibold text-white">
                          {log.customerName}{' '}
                          {log.customerId && (
                            <span className="text-[10px] text-purple-300 font-mono-num">
                              [{log.customerId}]
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-bold text-emerald-400">
                          {log.in > 0 ? `$${log.in.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-bold text-rose-400">
                          {log.out > 0 ? `$${log.out.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-300">{log.staffName}</td>
                        <td className="py-2 px-3 text-slate-400">{log.notes || '—'}</td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              type="button"
                              onClick={() =>
                                setVoucherData({
                                  type: 'Customer Change',
                                  customerName: log.customerName,
                                  customerId: log.customerId,
                                  amountIn: log.in,
                                  amountOut: log.out,
                                  date: log.date,
                                  time: new Date(log.timestamp).toLocaleTimeString(),
                                  staffName: log.staffName,
                                  ref: log.id,
                                })
                              }
                              className="p-1 rounded text-slate-400 hover:text-purple-300 hover:bg-slate-800"
                              title="Print Slip"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {isEditable && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isEditable) {
                                    alert('Editing and deleting previous days records is restricted to Admins.');
                                    return;
                                  }
                                  if (confirm(`Delete change log #${log.id}?`)) {
                                    deleteCustomerChange(log.id);
                                  }
                                }}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Credit Sales History Table */}
          <div className="bg-slate-900/90 border border-orange-500/30 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <CreditCard className="w-4 h-4 text-orange-400" />
                <h3 className="font-bold text-white text-sm">Credit Sales History Log</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono-num font-semibold">
                {filteredCreditHistory.length} Records
              </span>
            </div>

            {filteredCreditHistory.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No credit sales recorded for this date.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3 text-right">Amount ($)</th>
                      <th className="py-2.5 px-3">Goods / Items</th>
                      <th className="py-2.5 px-3">Due Date</th>
                      <th className="py-2.5 px-3">Salesperson</th>
                      <th className="py-2.5 px-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredCreditHistory.map((cr) => (
                      <tr key={cr.id} className="hover:bg-slate-900/60">
                        <td className="py-2 px-3 font-mono-num text-slate-400">
                          {new Date(cr.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 px-3 font-semibold text-white">
                          {cr.customerName}{' '}
                          {cr.customerId && (
                            <span className="text-[10px] text-orange-300 font-mono-num">
                              [{cr.customerId}]
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-black text-orange-400">
                          ${cr.amount.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-slate-200">{cr.itemDescription}</td>
                        <td className="py-2 px-3 text-slate-400 font-mono-num">{cr.dueDate || '—'}</td>
                        <td className="py-2 px-3 text-slate-300">{cr.staffName}</td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              type="button"
                              onClick={() =>
                                setVoucherData({
                                  type: 'Credit Sale',
                                  customerName: cr.customerName,
                                  customerId: cr.customerId,
                                  amount: cr.amount,
                                  description: cr.itemDescription,
                                  date: cr.date,
                                  time: new Date(cr.timestamp).toLocaleTimeString(),
                                  staffName: cr.staffName,
                                  ref: cr.id,
                                })
                              }
                              className="p-1 rounded text-slate-400 hover:text-orange-300 hover:bg-slate-800"
                              title="Print Slip"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {isEditable && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isEditable) {
                                    alert('Editing and deleting previous days records is restricted to Admins.');
                                    return;
                                  }
                                  if (confirm(`Delete credit sale #${cr.id}?`)) {
                                    deleteCreditSale(cr.id);
                                  }
                                }}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== CUSTOMER CHANGE REPORT (OWED & AGING) ==================== */}
      {viewMode === 'change_report' && (
        <div className="space-y-4">
          <CustomerChangeReport
            currentUser={currentUser}
            onNavigateToForm3={(customerName) => {
              setViewMode('sheet');
              if (customerName) {
                const match = getCustomerMatch(customerName);
                setChangeRows((prev) => {
                  const emptyIdx = prev.findIndex((r) => !(r.customerName || '').trim());
                  if (emptyIdx !== -1) {
                    const updated = [...prev];
                    updated[emptyIdx] = {
                      ...updated[emptyIdx],
                      customerName,
                      customerId: match ? match.customerId : undefined,
                    };
                    return updated;
                  } else {
                    return [
                      ...prev,
                      {
                        id: `chg_row_${Date.now()}`,
                        customerName,
                        customerId: match ? match.customerId : undefined,
                        in: '',
                        out: '',
                        notes: '',
                        isDynamicExtra: true,
                      },
                    ];
                  }
                });
              }
            }}
            onClose={() => setViewMode('sheet')}
          />
        </div>
      )}

      {/* ==================== CUSTOMER CREDIT REPORT ==================== */}
      {viewMode === 'credit_report' && (
        <div className="space-y-4">
          <CustomerCreditReport
            currentUser={currentUser}
            onNavigateToForm3={(customerName) => {
              setViewMode('sheet');
              if (customerName) {
                const match = getCustomerMatch(customerName);
                setCreditRows((prev) => {
                  const emptyIdx = prev.findIndex((r) => !(r.customerName || '').trim());
                  if (emptyIdx !== -1) {
                    const updated = [...prev];
                    updated[emptyIdx] = {
                      ...updated[emptyIdx],
                      customerName,
                      customerId: match ? match.customerId : undefined,
                    };
                    return updated;
                  } else {
                    return [
                      ...prev,
                      {
                        id: `crd_row_${Date.now()}`,
                        customerName,
                        customerId: match ? match.customerId : undefined,
                        creditIn: '',
                        repaidOut: '',
                        itemDescription: '',
                        dueDate: '',
                        isDynamicExtra: true,
                      },
                    ];
                  }
                });
              }
            }}
            onClose={() => setViewMode('sheet')}
          />
        </div>
      )}

      {/* ==================== QUICK CUSTOMER REGISTRATION MODAL ==================== */}
      {registerModalData.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-purple-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/30 text-purple-300 flex items-center justify-center">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Register New Customer</h3>
                  <p className="text-xs text-slate-400">Save to Customer Database (Sheet &quot;Customers&quot;)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalData({ isOpen: false, name: '', phone: '', address: '' })}
                className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModalCustomer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Customer / Business Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={registerModalData.name}
                  onChange={(e) => setRegisterModalData({ ...registerModalData, name: e.target.value })}
                  placeholder="e.g. Farai Masango or Mufakose Mart"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white outline-none focus:border-[#6A4DFF]"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  value={registerModalData.phone}
                  onChange={(e) => setRegisterModalData({ ...registerModalData, phone: e.target.value })}
                  placeholder="+263 77 123 4567"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Physical Address / City (Optional)</label>
                <input
                  type="text"
                  value={registerModalData.address}
                  onChange={(e) => setRegisterModalData({ ...registerModalData, address: e.target.value })}
                  placeholder="e.g. Stand 104, Harare CBD"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRegisterModalData({ isOpen: false, name: '', phone: '', address: '' })}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-purple-600 hover:brightness-110 text-white text-xs font-bold shadow-lg"
                >
                  Save & Link Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== PRINT VOUCHER SLIP MODAL ==================== */}
      {voucherData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-sm bg-white text-slate-900 rounded-3xl p-6 shadow-2xl font-mono text-xs space-y-4 animate-scaleUp border border-slate-300">
            <div className="text-center border-b border-dashed border-slate-400 pb-3">
              <h2 className="font-black text-sm tracking-tight text-slate-950 uppercase">
                SAIMETRIC ENERGY SYSTEMS
              </h2>
              <p className="text-[10px] text-slate-600">Customer Transaction Voucher</p>
              <div className="mt-1 text-[11px] font-bold bg-slate-100 py-0.5 rounded">
                {voucherData.type.toUpperCase()}
              </div>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-600">Date/Time:</span>
                <span>{voucherData.date} {voucherData.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Ref #:</span>
                <span className="font-bold">{voucherData.ref}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Salesperson:</span>
                <span>{voucherData.staffName}</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-slate-300 pt-1.5">
                <span className="text-slate-600">Customer:</span>
                <span className="font-bold">{voucherData.customerName}</span>
              </div>
              {voucherData.customerId && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Customer ID:</span>
                  <span>{voucherData.customerId}</span>
                </div>
              )}
            </div>

            <div className="border-t border-b border-dashed border-slate-400 py-3 space-y-1.5 text-xs">
              {voucherData.amountIn !== undefined && voucherData.amountIn > 0 && (
                <div className="flex justify-between font-bold text-emerald-700">
                  <span>Cash IN:</span>
                  <span>${voucherData.amountIn.toFixed(2)}</span>
                </div>
              )}
              {voucherData.amountOut !== undefined && voucherData.amountOut > 0 && (
                <div className="flex justify-between font-bold text-rose-700">
                  <span>Cash OUT:</span>
                  <span>${voucherData.amountOut.toFixed(2)}</span>
                </div>
              )}
              {voucherData.amount !== undefined && (
                <div className="flex justify-between font-black text-sm text-slate-950">
                  <span>Credit Total:</span>
                  <span>${voucherData.amount.toFixed(2)}</span>
                </div>
              )}
              {voucherData.description && (
                <div className="text-[10px] text-slate-600 pt-1">
                  Items: {voucherData.description}
                </div>
              )}
            </div>

            <div className="text-center text-[10px] text-slate-500 pt-1 space-y-1">
              <p>Thank you for your business!</p>
              <p>*** System Verified Record ***</p>
            </div>

            <div className="pt-2 flex items-center justify-between no-print gap-2">
              <button
                type="button"
                onClick={() => setVoucherData(null)}
                className="w-1/2 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="w-1/2 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center justify-center space-x-1"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
