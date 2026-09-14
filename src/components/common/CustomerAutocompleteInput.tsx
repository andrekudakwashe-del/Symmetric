import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Customer } from '../../types';
import { getCustomers, getCustomerChanges, getCreditSales } from '../../db/roomDatabase';
import {
  User,
  Check,
  Plus,
  Coins,
  CreditCard,
  Phone,
  MapPin,
  ChevronDown,
  Sparkles,
} from 'lucide-react';

interface CustomerAutocompleteInputProps {
  value?: string;
  onChange: (name: string, customer?: Customer) => void;
  onSelectCustomer?: (customer: Customer) => void;
  onRegisterNew?: (typedName: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  theme?: 'purple' | 'orange' | 'emerald' | 'indigo';
  showBalances?: boolean;
  autoFocus?: boolean;
  id?: string;
}

export const CustomerAutocompleteInput: React.FC<CustomerAutocompleteInputProps> = ({
  value = '',
  onChange,
  onSelectCustomer,
  onRegisterNew,
  placeholder = 'Type customer name (e.g. Givemore, Batanai)...',
  disabled = false,
  required = false,
  className = '',
  inputClassName = '',
  theme = 'purple',
  showBalances = true,
  autoFocus = false,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [allCustomers, setAllCustomers] = useState<Customer[]>(() => getCustomers());
  const [allChanges, setAllChanges] = useState(() => getCustomerChanges());
  const [allCredits, setAllCredits] = useState(() => getCreditSales());

  // Refresh customer and balance data when opened
  useEffect(() => {
    if (isOpen) {
      setAllCustomers(getCustomers());
      setAllChanges(getCustomerChanges());
      setAllCredits(getCreditSales());
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter and rank matches based on typed text
  const safeValue = value || '';
  const query = (safeValue || '').trim().toLowerCase();

  const filteredCustomers = useMemo(() => {
    if (!query) {
      // If empty query but opened, return first 8 recent customers
      return allCustomers.slice(0, 8);
    }

    return allCustomers
      .filter((c) => {
        const cName = (c.name || '').toLowerCase();
        const cId = (c.customerId || '').toLowerCase();
        const nameMatch = cName.includes(query);
        const idMatch = cId.includes(query);
        const phoneMatch = c.phone ? c.phone.toLowerCase().includes(query) : false;
        const addressMatch = c.address ? c.address.toLowerCase().includes(query) : false;
        return nameMatch || idMatch || phoneMatch || addressMatch;
      })
      .sort((a, b) => {
        // Prioritize exact prefix matches (e.g. "g" -> "Givemore" before "Apex Logistics")
        const aName = a.name || '';
        const bName = b.name || '';
        const aStarts = aName.toLowerCase().startsWith(query);
        const bStarts = bName.toLowerCase().startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        return aName.localeCompare(bName);
      })
      .slice(0, 8);
  }, [allCustomers, query]);

  // Check if current typed value is an exact match to a registered customer
  const exactMatch = useMemo(() => {
    if (!query) return undefined;
    return allCustomers.find(
      (c) =>
        (c.name && c.name.toLowerCase() === query) ||
        (c.customerId && c.customerId.toLowerCase() === query)
    );
  }, [allCustomers, query]);

  // Pre-calculate balances for suggested customers
  const customerBalances = useMemo(() => {
    const map = new Map<string, { changeHeld: number; creditOwed: number }>();
    filteredCustomers.forEach((c) => {
      const cName = (c.name || '').toLowerCase();
      // Change held: sum(in) - sum(out)
      const custChanges = allChanges.filter(
        (ch) =>
          (c.customerId && ch.customerId === c.customerId) ||
          (ch.customerName && cName && ch.customerName.toLowerCase() === cName)
      );
      const changeIn = custChanges.reduce((acc, ch) => acc + (Number(ch.in) || 0), 0);
      const changeOut = custChanges.reduce((acc, ch) => acc + (Number(ch.out) || 0), 0);
      const changeHeld = Math.max(0, changeIn - changeOut);

      // Credit owed: sum(in/amount) - sum(out)
      const custCredits = allCredits.filter(
        (cr) =>
          (c.customerId && cr.customerId === c.customerId) ||
          (cr.customerName && cName && cr.customerName.toLowerCase() === cName)
      );
      const creditIn = custCredits.reduce((acc, cr) => acc + (Number(cr.in) || Number(cr.amount) || 0), 0);
      const creditOut = custCredits.reduce((acc, cr) => acc + (Number(cr.out) || 0), 0);
      const creditOwed = Math.max(0, creditIn - creditOut);

      map.set(c.customerId, { changeHeld, creditOwed });
    });
    return map;
  }, [filteredCustomers, allChanges, allCredits]);

  const handleSelect = (customer: Customer) => {
    onChange(customer.name, customer);
    if (onSelectCustomer) {
      onSelectCustomer(customer);
    }
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    const totalOptions = filteredCustomers.length + (query && !exactMatch ? 1 : 0);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < filteredCustomers.length) {
        e.preventDefault();
        handleSelect(filteredCustomers[highlightedIndex]);
      } else if (highlightedIndex === filteredCustomers.length && onRegisterNew && query) {
        e.preventDefault();
        onRegisterNew(safeValue.trim());
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  // Helper to highlight matching substrings
  const renderHighlightedName = (name?: string, searchStr?: string) => {
    if (!name) return <span>{name || ''}</span>;
    if (!searchStr) return <span>{name}</span>;
    const lowerName = (name || '').toLowerCase();
    const lowerQuery = (searchStr || '').toLowerCase();
    const index = lowerName.indexOf(lowerQuery);

    if (index === -1) return <span>{name}</span>;

    const before = name.substring(0, index);
    const match = name.substring(index, index + searchStr.length);
    const after = name.substring(index + searchStr.length);

    return (
      <span>
        {before}
        <span className="bg-amber-400/30 text-amber-200 font-black rounded px-0.5">{match}</span>
        {after}
      </span>
    );
  };

  const themeBorderFocus =
    theme === 'orange'
      ? 'focus:border-[#FF8A00] focus:ring-1 focus:ring-[#FF8A00]/30'
      : theme === 'emerald'
      ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30'
      : 'focus:border-[#6A4DFF] focus:ring-1 focus:ring-[#6A4DFF]/30';

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={safeValue}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => {
            const nextVal = e.target.value || '';
            const cleanVal = nextVal.trim().toLowerCase();
            const match = cleanVal
              ? allCustomers.find(
                  (c) => c.name && c.name.toLowerCase() === cleanVal
                )
              : undefined;
            onChange(nextVal, match);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full px-3 py-2 rounded-xl bg-slate-900 border text-xs text-white placeholder-slate-500 outline-none transition ${
            disabled
              ? 'opacity-70 cursor-not-allowed bg-slate-950/60 border-slate-800 text-slate-400'
              : exactMatch
              ? 'border-emerald-500/60 bg-emerald-950/10'
              : query
              ? 'border-purple-500/60'
              : 'border-slate-700/80'
          } ${themeBorderFocus} ${inputClassName}`}
        />

        {/* Status indicator / Customer ID badge inside input */}
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center space-x-1.5 pointer-events-none">
          {exactMatch ? (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono-num font-bold px-1.5 py-0.5 rounded flex items-center space-x-1">
              <Check className="w-3 h-3 text-emerald-400" />
              <span>{exactMatch.customerId}</span>
            </span>
          ) : query && !disabled ? (
            <span className="text-[10px] bg-purple-500/20 text-purple-300 font-semibold px-1.5 py-0.5 rounded flex items-center space-x-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>New</span>
            </span>
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          )}
        </div>
      </div>

      {/* Autocomplete Suggestions Popup */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-slate-900/98 backdrop-blur-xl border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto animate-scaleUp divide-y divide-slate-800/80">
          {/* Header */}
          <div className="px-3 py-1.5 bg-slate-950/80 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span>
              {query ? `Suggestions for "${query}"` : 'Recent Customers'}
            </span>
            <span className="font-mono-num">{filteredCustomers.length} Found</span>
          </div>

          {/* Results List */}
          <div className="p-1.5 space-y-1">
            {filteredCustomers.length > 0 ? (
              filteredCustomers.map((cust, idx) => {
                const isSelected = highlightedIndex === idx;
                const balances = customerBalances.get(cust.customerId);
                const hasChange = balances && balances.changeHeld > 0;
                const hasDebt = balances && balances.creditOwed > 0;

                return (
                  <div
                    key={cust.customerId}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input blur before selection
                      handleSelect(cust);
                    }}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`px-3 py-2 rounded-xl cursor-pointer text-xs transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-purple-600/30 text-white border border-purple-500/40'
                        : 'text-slate-200 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white truncate">
                          {renderHighlightedName(cust.name, query)}
                        </span>
                        <span className="font-mono-num text-[10px] text-purple-300 bg-purple-950 border border-purple-800/60 px-1.5 py-0.2 rounded shrink-0 font-bold">
                          {cust.customerId}
                        </span>
                      </div>

                      {/* Contact metadata */}
                      <div className="flex items-center space-x-3 text-[11px] text-slate-400 mt-0.5 truncate">
                        {cust.phone && (
                          <span className="flex items-center space-x-1">
                            <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>{cust.phone}</span>
                          </span>
                        )}
                        {cust.address && (
                          <span className="flex items-center space-x-1 truncate">
                            <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="truncate">{cust.address}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Balance Badges */}
                    {showBalances && (
                      <div className="flex flex-col items-end space-y-1 shrink-0">
                        {hasChange && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono-num font-bold flex items-center space-x-1">
                            <Coins className="w-2.5 h-2.5 text-emerald-400" />
                            <span>Change: ${balances!.changeHeld.toFixed(2)}</span>
                          </span>
                        )}
                        {hasDebt && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-300 font-mono-num font-bold flex items-center space-x-1">
                            <CreditCard className="w-2.5 h-2.5 text-rose-400" />
                            <span>Debt: ${balances!.creditOwed.toFixed(2)}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-3 px-3 text-center text-xs text-slate-400">
                No matching customer named &ldquo;{query}&rdquo;
              </div>
            )}

            {/* Register New Customer Button in Dropdown */}
            {query && !exactMatch && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (onRegisterNew) {
                    onRegisterNew(value.trim());
                  }
                  setIsOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(filteredCustomers.length)}
                className={`p-2.5 rounded-xl cursor-pointer bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 flex items-center justify-between text-xs font-bold transition ${
                  highlightedIndex === filteredCustomers.length ? 'ring-2 ring-purple-400' : ''
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Plus className="w-4 h-4 text-[#FF8A00]" />
                  <span>Register &ldquo;{value.trim()}&rdquo; in Customer Database</span>
                </div>
                <span className="text-[10px] bg-[#6A4DFF] text-white px-2 py-0.5 rounded-full">
                  1-Click Save
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
