import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  RefreshCw,
  DollarSign,
  Smartphone,
  Coins,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRightLeft,
  Lock,
  Unlock,
  KeyRound,
  Sparkles,
  TrendingUp,
  UserCheck,
  Plus,
  Trash2,
  Globe,
  Settings,
} from 'lucide-react';
import { MultiCurrencyConfig, Salesperson } from '../../types';
import {
  getMultiCurrencyConfig,
  saveMultiCurrencyConfig,
  subscribeToDatabase,
  getSalespeople,
  logManagerOverride,
} from '../../db/roomDatabase';

interface ExchangeRatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: Salesperson | null;
}

const COMMON_BASE_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P' },
  { code: 'ZiG', name: 'Zimbabwe Gold', symbol: 'ZiG' },
  { code: 'EcoCash', name: 'EcoCash Mobile Money', symbol: 'EcoCash' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'K' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
];

export const ExchangeRatesModal: React.FC<ExchangeRatesModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [config, setConfig] = useState<MultiCurrencyConfig>(() => getMultiCurrencyConfig());
  const [baseCurrency, setBaseCurrency] = useState<string>(() => config.baseCurrency || 'USD');
  
  // Dynamic rates state: code -> { rate: string, allowCashWithdrawal: boolean, customPercent: string, name: string, symbol: string }
  const [ratesState, setRatesState] = useState<
    Record<
      string,
      {
        code: string;
        name: string;
        symbol: string;
        rate: string;
        allowCashWithdrawal: boolean;
        customPercent: string;
      }
    >
  >({});

  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState<boolean>(() => config.cashWithdrawalPolicy.enabled);
  const [withdrawalRule, setWithdrawalRule] = useState<'EQUAL_TO_SALE' | 'CUSTOM_PERCENT'>(
    () => config.cashWithdrawalPolicy.maxWithdrawalRule || 'EQUAL_TO_SALE'
  );
  const [customPercent, setCustomPercent] = useState<string>(
    () => String(config.cashWithdrawalPolicy.customPercent || 100)
  );

  // New Currency Form State
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSymbol, setNewSymbol] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newAllowWithdrawal, setNewAllowWithdrawal] = useState(false);

  // Conversion test calculator
  const [testBaseAmt, setTestBaseAmt] = useState<string>('10');
  const [calcTargetCurr, setCalcTargetCurr] = useState<string>('ZiG');
  const [testTargetAmt, setTestTargetAmt] = useState<string>('265');
  const [activeCalculatorTab, setActiveCalculatorTab] = useState<'base_to_local' | 'local_to_base'>('base_to_local');

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Owner Authorization & Explicit Permission Verification
  const isOwner =
    currentUser?.role === 'OWNER' ||
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const hasExplicitPermission = Boolean(currentUser?.permissions?.canEditExchangeRate);
  const [overrideAuthorized, setOverrideAuthorized] = useState<boolean>(false);
  const [authorizedByStaff, setAuthorizedByStaff] = useState<string | null>(null);

  const canEdit = isOwner || hasExplicitPermission || overrideAuthorized;

  // PIN Override Dialog State
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState<boolean>(false);

  // Populate ratesState from config
  const populateRatesFromConfig = (liveConfig: MultiCurrencyConfig) => {
    const state: Record<string, any> = {};
    const base = (liveConfig.baseCurrency || 'USD').toUpperCase();
    const rates = liveConfig.rates || {};

    Object.keys(rates).forEach((key) => {
      const item = rates[key];
      if (!item) return;
      const rateVal = item.rateToBase !== undefined ? item.rateToBase : (item.rateToUsd !== undefined ? item.rateToUsd : 0);
      state[key] = {
        code: item.code || key,
        name: item.name || key,
        symbol: item.symbol || key,
        rate: rateVal !== undefined ? String(rateVal) : '0',
        allowCashWithdrawal: item.allowCashWithdrawal ?? true,
        customPercent: String(item.customPercent || 100),
      };
    });

    setRatesState(state);
    setBaseCurrency(liveConfig.baseCurrency || 'USD');
    setWithdrawalsEnabled(liveConfig.cashWithdrawalPolicy.enabled);
    setWithdrawalRule(liveConfig.cashWithdrawalPolicy.maxWithdrawalRule || 'EQUAL_TO_SALE');
    setCustomPercent(String(liveConfig.cashWithdrawalPolicy.customPercent || 100));

    // Set default target for test calculator to first active currency
    const activeKeys = Object.keys(rates).filter((k) => {
      if (k.toUpperCase() === base) return false;
      const r = rates[k].rateToBase !== undefined ? rates[k].rateToBase : rates[k].rateToUsd;
      return Number(r) > 0;
    });
    if (activeKeys.length > 0 && !rates[calcTargetCurr]) {
      setCalcTargetCurr(activeKeys[0]);
    }
  };

  // Re-sync when modal opens or DB updates
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      const live = getMultiCurrencyConfig();
      setConfig(live);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isOpen) {
      const live = getMultiCurrencyConfig();
      setConfig(live);
      populateRatesFromConfig(live);
      setSavedSuccess(false);
      setValidationError(null);
      setOverrideAuthorized(false);
      setAuthorizedByStaff(null);
      setShowPinModal(false);
      setPinInput('');
      setPinError(null);
      setShowAddCurrency(false);
    }
  }, [isOpen]);

  // List of foreign currencies (excluding the selected base currency)
  const foreignCurrencies = useMemo(() => {
    const base = baseCurrency.toUpperCase();
    return Object.keys(ratesState).filter((key) => key.toUpperCase() !== base);
  }, [ratesState, baseCurrency]);

  if (!isOpen) return null;

  const handleVerifyOwnerPin = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!pinInput || pinInput.length < 4) {
      setPinError('Please enter a valid 4-digit PIN.');
      return;
    }

    setIsVerifyingPin(true);
    const activeStaff = getSalespeople().filter((s) => s.active === 'Y');
    const matched = activeStaff.find((s) => s.pin === pinInput);

    if (!matched) {
      setPinError('Invalid PIN. No active staff member found with this PIN.');
      setPinInput('');
      setIsVerifyingPin(false);
      return;
    }

    const isMatchOwner =
      matched.role === 'OWNER' ||
      matched.role === 'SUPER_ADMIN' ||
      (matched.role as string) === 'super_admin' ||
      matched.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

    const matchHasPerm = Boolean(matched.permissions?.canEditExchangeRate);

    if (!isMatchOwner && !matchHasPerm) {
      setPinError(
        `PIN belongs to ${matched.name} (${matched.role}). Exchange rate management requires Owner authorization or explicit assignment.`
      );
      setPinInput('');
      setIsVerifyingPin(false);
      return;
    }

    // Successfully authorized
    setOverrideAuthorized(true);
    setAuthorizedByStaff(`${matched.name} (${matched.role})`);
    setShowPinModal(false);
    setPinInput('');
    setIsVerifyingPin(false);

    // Audit log
    logManagerOverride({
      action: 'DISCOUNT_OVERRIDE',
      manager: matched,
      cashier: currentUser,
      details: `Owner PIN authorization to edit multi-currency exchange rates and withdrawal policy by ${matched.role} ${matched.name}`,
      referenceId: 'MULTI_CURRENCY',
    });
  };

  const handleRateChange = (key: string, val: string) => {
    setRatesState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        rate: val,
      },
    }));
  };

  const handleWithdrawalToggle = (key: string, checked: boolean) => {
    setRatesState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        allowCashWithdrawal: checked,
      },
    }));
  };

  const handleAddNewCurrency = () => {
    const code = newCode.trim().toUpperCase();
    if (!code) {
      setValidationError('Please enter a valid Currency Code (e.g. ZAR, BWP, EUR).');
      return;
    }
    if (code === baseCurrency.toUpperCase()) {
      setValidationError('Currency code cannot be identical to the Base Currency.');
      return;
    }

    const name = newName.trim() || code;
    const symbol = newSymbol.trim() || code;
    const rateNum = parseFloat(newRate) || 0;

    setRatesState((prev) => ({
      ...prev,
      [code]: {
        code,
        name,
        symbol,
        rate: String(rateNum),
        allowCashWithdrawal: newAllowWithdrawal,
        customPercent: '100',
      },
    }));

    setNewCode('');
    setNewName('');
    setNewSymbol('');
    setNewRate('');
    setNewAllowWithdrawal(false);
    setShowAddCurrency(false);
    setValidationError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setShowPinModal(true);
      return;
    }

    const numPct = parseFloat(customPercent);
    if (withdrawalRule === 'CUSTOM_PERCENT' && (isNaN(numPct) || numPct <= 0)) {
      setValidationError('Please enter a valid percentage for withdrawal limit.');
      return;
    }

    const updaterName = authorizedByStaff
      ? `${currentUser?.name || 'User'} (Authorized by ${authorizedByStaff})`
      : currentUser?.name || 'Owner';

    // Build updated rates dictionary
    const updatedRates: Record<string, any> = {};
    Object.keys(ratesState).forEach((key) => {
      const cur = ratesState[key];
      const parsedRate = Math.max(0, parseFloat(cur.rate) || 0);
      updatedRates[key] = {
        currency: cur.code,
        code: cur.code,
        name: cur.name,
        symbol: cur.symbol,
        rateToBase: parsedRate,
        rateToUsd: parsedRate, // legacy backward compatibility
        allowCashWithdrawal: cur.allowCashWithdrawal,
        maxWithdrawalRule: withdrawalRule,
        customPercent: numPct,
      };
    });

    const updated = saveMultiCurrencyConfig(
      {
        baseCurrency: baseCurrency.toUpperCase(),
        rates: updatedRates,
        cashWithdrawalPolicy: {
          enabled: withdrawalsEnabled,
          maxWithdrawalRule: withdrawalRule,
          customPercent: numPct,
        },
      },
      updaterName
    );

    setConfig(updated);
    populateRatesFromConfig(updated);
    setValidationError(null);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  // Calculator conversions
  const selectedCalcRate = parseFloat(ratesState[calcTargetCurr]?.rate || '0') || 1;
  const parsedTestBase = parseFloat(testBaseAmt) || 0;
  const parsedTestTarget = parseFloat(testTargetAmt) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] text-white relative">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] p-4 sm:p-5 flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-white font-black shadow-inner">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="bg-white/20 text-white font-black text-[10px] tracking-wider px-2 py-0.5 rounded-md">
                  INTERNATIONAL POS
                </span>
                <h3 className="text-lg font-black text-white">Multi-Currency &amp; Exchange Rates</h3>
              </div>
              <p className="text-xs text-white/80 mt-0.5">
                Configure Base Currency, local exchange rates, and Cash Balancing (Form 2 &amp; 4) rules
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Security & Access Control Banner */}
          {!canEdit ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white flex items-center space-x-2">
                    <span>Owner-Restricted Function</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-mono font-bold uppercase">
                      Read-Only
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Exchange rates and cash withdrawal rules are governed by Company Owners. Other staff cannot alter rates without explicit permission or Owner PIN authorization.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPinInput('');
                  setPinError(null);
                  setShowPinModal(true);
                }}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs shadow flex items-center justify-center space-x-1.5 transition active:scale-95 shrink-0"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Unlock with Owner PIN</span>
              </button>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-2.5 px-3.5 flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-bold text-white">
                  Owner Authorized:
                  <span className="font-normal text-emerald-300 ml-1.5">
                    {isOwner
                      ? `Company Owner Privileges (${currentUser?.name || 'Owner'})`
                      : overrideAuthorized
                      ? `Unlocked via Owner PIN Override (${authorizedByStaff})`
                      : `Explicit Permission Assigned (${currentUser?.name || 'Staff'})`}
                  </span>
                </span>
              </div>
              <span className="text-[10px] uppercase font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-bold">
                Editing Active
              </span>
            </div>
          )}

          {/* 1. Base Operating Currency Selection */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-300 block">Base Operating Currency</span>
                  <span className="text-[11px] text-slate-400">
                    Primary currency used for prices, drawer cash balancing, and financial reports
                  </span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <select
                  disabled={!canEdit}
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-emerald-400 font-mono font-bold text-xs rounded-xl px-3 py-1.5 focus:border-emerald-500 outline-none disabled:opacity-60"
                >
                  {COMMON_BASE_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.name})
                    </option>
                  ))}
                  {/* Any custom code entered that isn't in common list */}
                  {!COMMON_BASE_CURRENCIES.some((c) => c.code === baseCurrency) && (
                    <option value={baseCurrency}>{baseCurrency} (Custom Base)</option>
                  )}
                </select>
                <span className="text-[10px] font-bold text-emerald-400 uppercase bg-emerald-950/60 border border-emerald-800/40 px-2 py-1 rounded-xl">
                  Base = 1.00
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
              💡 <strong>International Region Rule:</strong> Any currency with a set exchange rate (rate &gt; 0) is considered active in your region and will automatically appear in the POS register and Cash Balancing Forms. Currencies with no rate (or 0) are automatically hidden.
            </p>
          </div>

          {/* Validation Notice */}
          {validationError && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-2xl flex items-start space-x-2 text-xs text-rose-300 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* 2. Dynamic Currency Rates List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
                <Coins className="w-4 h-4 text-amber-400" />
                <span>Regional Currency Exchange Rates (vs 1 {baseCurrency})</span>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowAddCurrency((prev) => !prev)}
                  className="px-3 py-1.5 rounded-xl bg-purple-900/40 hover:bg-purple-900/70 border border-purple-700/50 text-purple-200 text-xs font-bold flex items-center space-x-1.5 transition active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAddCurrency ? 'Cancel' : 'Add Currency'}</span>
                </button>
              )}
            </div>

            {/* Quick Add Currency Inline Panel */}
            {showAddCurrency && (
              <div className="p-4 bg-purple-950/30 border border-purple-500/40 rounded-2xl space-y-3 animate-fadeIn">
                <div className="font-bold text-xs text-purple-200 flex items-center space-x-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Add New Currency to System</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[10px] text-slate-300 font-bold mb-1">Code (e.g. ZAR, EUR)</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder="e.g. ZAR"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-mono font-bold uppercase focus:border-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 font-bold mb-1">Currency Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="South African Rand"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white focus:border-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 font-bold mb-1">Symbol</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      placeholder="R"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-bold focus:border-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 font-bold mb-1">
                      Rate (1 {baseCurrency} =)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={newRate}
                      onChange={(e) => setNewRate(e.target.value)}
                      placeholder="18.50"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-amber-300 font-mono font-bold focus:border-purple-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAllowWithdrawal}
                      onChange={(e) => setNewAllowWithdrawal(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-purple-500"
                    />
                    <span>Allow Cash-Out withdrawals from till in this currency</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleAddNewCurrency}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white font-bold text-xs shadow hover:opacity-95 transition"
                  >
                    Confirm &amp; Add
                  </button>
                </div>
              </div>
            )}

            {/* Currency Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {foreignCurrencies.map((key) => {
                const item = ratesState[key];
                if (!item) return null;
                const rateNum = parseFloat(item.rate) || 0;
                const isActive = rateNum > 0;

                return (
                  <div
                    key={key}
                    className={`bg-slate-950/80 border rounded-2xl p-3.5 space-y-3 shadow-sm transition ${
                      isActive ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                            isActive
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {item.symbol || item.code}
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-white">{item.name}</h4>
                          <span className="text-[10px] text-slate-400 font-mono">Code: {item.code}</span>
                        </div>
                      </div>

                      {isActive ? (
                        <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/40 flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Active ({rateNum.toFixed(2)})</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                          Inactive (No Rate)
                        </span>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-slate-300">
                          Rate ({item.code} per 1 {baseCurrency})
                        </label>
                        {!isActive && (
                          <span className="text-[10px] text-amber-400">Enter rate &gt; 0 to activate</span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          disabled={!canEdit}
                          value={item.rate}
                          onChange={(e) => handleRateChange(key, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 disabled:opacity-60 rounded-xl px-3 py-2 text-sm font-black font-mono-num text-amber-300 outline-none"
                          placeholder="0.00"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono font-bold">
                          {item.code}
                        </span>
                      </div>
                    </div>

                    {/* Cash withdrawal toggle per currency */}
                    <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs">
                      <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!canEdit || !isActive}
                          checked={item.allowCashWithdrawal && isActive}
                          onChange={(e) => handleWithdrawalToggle(key, e.target.checked)}
                          className="rounded bg-slate-900 border-slate-700 text-amber-500 disabled:opacity-50"
                        />
                        <span className="text-[11px]">Allow Cash-Out Withdrawal</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Global Cash Withdrawal Policy */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-black">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-white">Till Cash Withdrawal (Cash-Out) Policy</h4>
                  <span className="text-[10px] text-slate-400">
                    Governs physical {baseCurrency} cash paid out when shoppers swipe foreign/mobile currencies
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={withdrawalsEnabled}
                  onChange={(e) => setWithdrawalsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600 peer-disabled:opacity-50"></div>
              </label>
            </div>

            {withdrawalsEnabled && (
              <div className="p-3 bg-slate-900 rounded-xl space-y-2 border border-slate-800/80 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-slate-300 font-bold">Maximum Withdrawal Cap:</span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setWithdrawalRule('EQUAL_TO_SALE')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition text-xs ${
                        withdrawalRule === 'EQUAL_TO_SALE'
                          ? 'bg-purple-600 text-white shadow'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Up to Sale Amount (100%)
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setWithdrawalRule('CUSTOM_PERCENT')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition text-xs ${
                        withdrawalRule === 'CUSTOM_PERCENT'
                          ? 'bg-purple-600 text-white shadow'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Custom %
                    </button>
                  </div>
                </div>

                {withdrawalRule === 'CUSTOM_PERCENT' && (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                    <span className="text-slate-400">Withdrawal % of Invoice Total:</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="number"
                        min="1"
                        max="500"
                        disabled={!canEdit}
                        value={customPercent}
                        onChange={(e) => setCustomPercent(e.target.value)}
                        className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-center font-mono font-bold text-purple-300"
                      />
                      <span className="text-slate-400 font-bold">%</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. Interactive Conversion Test Calculator */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">Live Rate Test Calculator</span>
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={calcTargetCurr}
                  onChange={(e) => {
                    const newTarget = e.target.value;
                    setCalcTargetCurr(newTarget);
                    const newR = parseFloat(ratesState[newTarget]?.rate || '0') || 1;
                    setTestTargetAmt(String((parseFloat(testBaseAmt) || 0) * newR));
                  }}
                  className="bg-slate-900 border border-slate-700 text-amber-300 text-xs font-bold rounded-lg px-2 py-1 outline-none font-mono"
                >
                  {foreignCurrencies.map((k) => (
                    <option key={k} value={k}>
                      {k} ({ratesState[k]?.rate || '0'})
                    </option>
                  ))}
                </select>

                <div className="flex rounded-xl bg-slate-900 p-0.5 border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setActiveCalculatorTab('base_to_local')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      activeCalculatorTab === 'base_to_local'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {baseCurrency} &rarr; {calcTargetCurr}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCalculatorTab('local_to_base')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      activeCalculatorTab === 'local_to_base'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {calcTargetCurr} &rarr; {baseCurrency}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 text-[10px] uppercase font-bold mb-1">
                  {baseCurrency} Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={testBaseAmt}
                    onChange={(e) => {
                      setTestBaseAmt(e.target.value);
                      const baseAmt = parseFloat(e.target.value) || 0;
                      setTestTargetAmt((baseAmt * selectedCalcRate).toFixed(2));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 font-mono font-bold text-emerald-400 text-sm outline-none"
                    placeholder="10.00"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-mono">
                    {baseCurrency}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] uppercase font-bold mb-1">
                  {calcTargetCurr} Equivalent
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={testTargetAmt}
                    onChange={(e) => {
                      setTestTargetAmt(e.target.value);
                      const targetAmt = parseFloat(e.target.value) || 0;
                      if (selectedCalcRate > 0) {
                        setTestBaseAmt((targetAmt / selectedCalcRate).toFixed(2));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 font-mono font-bold text-amber-300 text-sm outline-none"
                    placeholder="265.00"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-mono">
                    {calcTargetCurr}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={!canEdit}
              className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed font-black text-xs text-white shadow-lg flex items-center justify-center space-x-1.5 transition"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                  <span>Saved Successfully!</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Save Multi-Currency Configuration</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* PIN Authorization Modal */}
        {showPinModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
            <div className="bg-slate-900 border border-amber-500/40 rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl text-center animate-scaleUp">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Owner Authorization Required</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Enter an authorized Owner, Super Admin, or Manager PIN to unlock multi-currency and exchange rates
                </p>
              </div>

              {pinError && (
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/40 rounded-xl text-rose-300 text-xs font-semibold">
                  {pinError}
                </div>
              )}

              <form onSubmit={handleVerifyOwnerPin} className="space-y-3">
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(null);
                  }}
                  placeholder="Enter 4-digit PIN"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-2xl py-3 px-4 text-center font-mono-num text-2xl tracking-widest text-amber-400 outline-none"
                />

                <div className="flex items-center space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPinModal(false);
                      setPinInput('');
                      setPinError(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifyingPin || !pinInput}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-slate-950 font-black text-xs shadow transition disabled:opacity-50"
                  >
                    Authorize
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
