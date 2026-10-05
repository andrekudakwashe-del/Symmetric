import React, { useState, useEffect } from 'react';
import {
  PackageOpen,
  Plus,
  Search,
  CheckCircle,
  Clock,
  User,
  Phone,
  FileText,
  AlertCircle,
  Trash2,
  Check,
  ShieldCheck,
  HelpCircle,
  Truck,
  Boxes,
} from 'lucide-react';
import {
  StocktakeSession,
  CustomerGoodsLeftBehind,
  InventoryItem,
  Salesperson,
} from '../../types';
import {
  getCustomerGoodsLeftBehind,
  addCustomerGoodsLeftBehind,
  deleteCustomerGoodsLeftBehind,
  getInventoryItems,
} from '../../db/roomDatabase';

interface CustomerGoodsLeftBehindTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: () => void;
}

export const CustomerGoodsLeftBehindTab: React.FC<CustomerGoodsLeftBehindTabProps> = ({
  session,
  currentUser,
  onRefreshSession,
}) => {
  const [items, setItems] = useState<CustomerGoodsLeftBehind[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);

  // Form State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [holdType, setHoldType] = useState<'SAME_DAY' | 'DAY_END_FORMAL'>('SAME_DAY');
  const [notes, setNotes] = useState('');

  const loadData = () => {
    const data = getCustomerGoodsLeftBehind(session.sessionId);
    setItems(data);
    setInventoryList(getInventoryItems());
  };

  useEffect(() => {
    loadData();
  }, [session.sessionId]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !selectedItemId || quantity <= 0) return;

    const matchedItem = inventoryList.find((i) => i.itemId === selectedItemId);
    const itemName = matchedItem?.itemName || selectedItemId;

    addCustomerGoodsLeftBehind({
      sessionId: session.sessionId,
      customerName: customerName.trim(),
      phone: customerPhone.trim() || undefined,
      invoiceNo: invoiceNo.trim() || undefined,
      itemId: selectedItemId,
      itemName,
      quantity: Number(quantity),
      notes: `${holdType === 'DAY_END_FORMAL' ? '[Day-End Booking] ' : '[Same-Day Hold] '}${notes}`.trim(),
      recordedBy: currentUser?.name || 'Supervisor',
      collected: false,
    });

    loadData();
    setShowAddModal(false);
    setCustomerName('');
    setCustomerPhone('');
    setInvoiceNo('');
    setSelectedItemId('');
    setQuantity(1);
    setNotes('');
    onRefreshSession();
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this Customer Goods Left Behind record?')) {
      deleteCustomerGoodsLeftBehind(id);
      loadData();
      onRefreshSession();
    }
  };

  // Filter items
  const q = searchQuery.trim().toLowerCase();
  const filteredItems = items.filter((i) => {
    return (
      q === '' ||
      i.customerName.toLowerCase().includes(q) ||
      i.itemName.toLowerCase().includes(q) ||
      (i.phone && i.phone.includes(q)) ||
      (i.invoiceNo && i.invoiceNo.toLowerCase().includes(q))
    );
  });

  const totalHeldUnits = items
    .filter((i) => !i.collected)
    .reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Informational Guidance Banner */}
      <div className="bg-gradient-to-r from-blue-950/70 to-slate-900 border border-blue-800/60 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Customer Goods Left Behind (Floor Stock Reconciliation)
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              When customers purchase goods but leave them behind (e.g. vehicle full, collecting next day), these units sit physically on your floor. During stocktake, counters will count them. This module tags those customer-owned items and automatically deducts them from the physical count so you do <strong>not</strong> report a false overage now, nor a shortage later!
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Book Goods Left Behind
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Customer Held Records</div>
          <div className="text-2xl font-bold font-mono text-white mt-1">{items.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Active hold tickets</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Physical Floor Offset (Total Units)</div>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-1">-{totalHeldUnits} u</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Deducted from raw count during consolidation</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Reconciliation Protection</div>
          <div className="text-sm font-semibold text-emerald-400 mt-1.5 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Balanced & Audited
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Prevents subsequent pickup shrinkage</div>
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, product, phone, invoice..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Goods Left Behind Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
              <tr>
                <th className="py-3 px-4">Hold ID</th>
                <th className="py-3 px-4">Customer & Phone</th>
                <th className="py-3 px-4">Product Held</th>
                <th className="py-3 px-4 text-center">Qty Held</th>
                <th className="py-3 px-4">Invoice / Receipt</th>
                <th className="py-3 px-4">Booking Time</th>
                <th className="py-3 px-4">Supervisor / Notes</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4 font-mono font-bold text-blue-400">{item.id}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{item.customerName}</div>
                    {item.phone && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {item.phone}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-100">{item.itemName}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{item.itemId}</div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="font-mono font-extrabold text-amber-400 bg-amber-950/50 border border-amber-800 px-2 py-0.5 rounded">
                      {item.quantity} units
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-300">
                    {item.invoiceNo || 'N/A'}
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-[11px]">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(item.recordedAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-300 text-[11px] max-w-xs">
                    <span className="text-slate-400">By: {item.recordedBy}</span>
                    {item.notes && <p className="text-slate-300 truncate">{item.notes}</p>}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                      title="Remove record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <PackageOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="font-semibold text-slate-400">No customer goods left behind recorded</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      If customers have paid for stock sitting in the shop awaiting pickup, book them here so they are reconciled.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Goods Left Behind Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <PackageOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Book Goods Left Behind</h3>
                  <p className="text-xs text-slate-400">Physical stock customer hold record</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Farai Mudavanhu"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Customer Phone</label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+263 77..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Invoice / Receipt #</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-1094"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Product Left Behind *</label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Select Product --</option>
                  {inventoryList.map((item) => (
                    <option key={item.itemId} value={item.itemId}>
                      {item.itemName} ({item.itemId})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Quantity Left Behind *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Hold Booking Type</label>
                  <select
                    value={holdType}
                    onChange={(e) => setHoldType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="SAME_DAY">Same-Day Floor Hold</option>
                    <option value="DAY_END_FORMAL">Day-End Formal Booking</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes / Reason (e.g. Truck Full)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Customer truck was full; returning tomorrow morning for pickup."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg"
                >
                  Book Record & Reconcile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
