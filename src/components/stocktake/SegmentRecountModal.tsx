import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  Boxes,
  Package,
  UserCheck,
  HelpCircle,
  Save,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  Salesperson,
} from '../../types';

interface SegmentRecountModalProps {
  session: StocktakeSession;
  segment: StocktakeSegment;
  currentUser: Salesperson | null;
  onResolveRecount: (
    segmentId: string,
    resolvedRecountLines: StocktakeLineCount[],
    staffId: string,
    staffName: string
  ) => void;
  onClose: () => void;
}

export const SegmentRecountModal: React.FC<SegmentRecountModalProps> = ({
  session,
  segment,
  currentUser,
  onResolveRecount,
  onClose,
}) => {
  const [recounterName, setRecounterName] = useState(currentUser?.name || 'Sarah Chidyamakono');
  const [recounterId, setRecounterId] = useState(currentUser?.id || '001');

  // Build discrepancy list with Count 1 vs Count 2 comparison
  const mapA = new Map<string, StocktakeLineCount>();
  const mapB = new Map<string, StocktakeLineCount>();
  segment.count1.forEach((l) => mapA.set(l.itemId.toUpperCase(), l));
  segment.count2.forEach((l) => mapB.set(l.itemId.toUpperCase(), l));

  const initialDiscrepancies = segment.recount && segment.recount.length > 0
    ? segment.recount
    : [];

  const [recountValues, setRecountValues] = useState<
    Record<string, { cases: number; singles: number; totalUnits: number }>
  >(() => {
    const map: Record<string, { cases: number; singles: number; totalUnits: number }> = {};
    initialDiscrepancies.forEach((d) => {
      const upc = d.unitsPerCase || 1;
      map[d.itemId] = {
        cases: d.cases,
        singles: d.singles,
        totalUnits: (d.cases * upc) + d.singles,
      };
    });
    return map;
  });

  const handleUpdate = (itemId: string, upc: number, cases: number, singles: number) => {
    const totalUnits = (cases * upc) + singles;
    setRecountValues((prev) => ({
      ...prev,
      [itemId]: { cases, singles, totalUnits },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const resolvedLines: StocktakeLineCount[] = initialDiscrepancies.map((d) => {
      const current = recountValues[d.itemId] || { cases: d.cases, singles: d.singles, totalUnits: d.totalUnits };
      const upc = d.unitsPerCase || 1;
      return {
        ...d,
        cases: current.cases,
        singles: current.singles,
        totalUnits: (current.cases * upc) + current.singles,
      };
    });

    onResolveRecount(segment.segmentId, resolvedLines, recounterId, recounterName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Segment Recount & Discrepancy Resolution</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800">
                  {initialDiscrepancies.length} Mismatch(es)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Segment: <strong className="text-slate-200">{segment.name}</strong> ({segment.locationCode})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-amber-950/40 border-b border-amber-800/40 px-6 py-3 text-xs text-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Counter A ({segment.counterAName || 'Counter 1'}) and Counter B ({segment.counterBName || 'Counter 2'}) reported differing quantities for the items below. Please conduct a physical recount to verify the true floor count.
            </span>
          </div>
        </div>

        {/* Discrepancy Comparison Table */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-2 px-3">Product / SKU</th>
                <th className="py-2 px-3 text-center bg-blue-950/30 rounded-t">
                  Count 1 (Counter A)
                </th>
                <th className="py-2 px-3 text-center bg-purple-950/30 rounded-t">
                  Count 2 (Counter B)
                </th>
                <th className="py-2 px-3 text-center text-amber-400">Discrepancy</th>
                <th className="py-2 px-3 text-center bg-emerald-950/40 text-emerald-300 rounded-t">
                  Verified Recount Input
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {initialDiscrepancies.map((item) => {
                const itemA = mapA.get(item.itemId.toUpperCase());
                const itemB = mapB.get(item.itemId.toUpperCase());
                const upc = item.unitsPerCase || 1;

                const aUnits = itemA?.totalUnits || 0;
                const bUnits = itemB?.totalUnits || 0;
                const diffUnits = aUnits - bUnits;

                const currentRecount = recountValues[item.itemId] || {
                  cases: item.cases,
                  singles: item.singles,
                  totalUnits: (item.cases * upc) + item.singles,
                };

                return (
                  <tr key={item.itemId} className="hover:bg-slate-800/40 transition">
                    {/* Item */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-white text-sm">{item.itemName}</div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                        <span>{item.sku}</span>
                        <span>•</span>
                        <span>{upc} units/case</span>
                      </div>
                    </td>

                    {/* Count 1 */}
                    <td className="py-3 px-3 text-center bg-blue-950/20">
                      <div className="font-mono font-bold text-blue-300 text-sm">{aUnits} units</div>
                      <div className="text-[10px] text-slate-400">
                        {itemA?.cases || 0} cs + {itemA?.singles || 0} ea
                      </div>
                    </td>

                    {/* Count 2 */}
                    <td className="py-3 px-3 text-center bg-purple-950/20">
                      <div className="font-mono font-bold text-purple-300 text-sm">{bUnits} units</div>
                      <div className="text-[10px] text-slate-400">
                        {itemB?.cases || 0} cs + {itemB?.singles || 0} ea
                      </div>
                    </td>

                    {/* Diff */}
                    <td className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded text-xs border border-amber-800/40">
                        {diffUnits > 0 ? `+${diffUnits}` : diffUnits} units
                      </span>
                    </td>

                    {/* Verified Recount Controller */}
                    <td className="py-3 px-3 bg-emerald-950/20">
                      <div className="flex items-center justify-center gap-2">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">Cases</span>
                          <input
                            type="number"
                            min="0"
                            value={currentRecount.cases}
                            onChange={(e) =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                Math.max(0, Number(e.target.value) || 0),
                                currentRecount.singles
                              )
                            }
                            className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded px-1 py-1 text-sm focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>

                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">Singles</span>
                          <input
                            type="number"
                            min="0"
                            value={currentRecount.singles}
                            onChange={(e) =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                currentRecount.cases,
                                Math.max(0, Number(e.target.value) || 0)
                              )
                            }
                            className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded px-1 py-1 text-sm focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>

                        <div className="flex flex-col items-center pl-2">
                          <span className="text-[9px] text-emerald-400 uppercase font-semibold">Total</span>
                          <div className="font-mono font-extrabold text-emerald-400 text-sm">
                            {currentRecount.totalUnits}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-800/90 border-t border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <UserCheck className="w-4 h-4 text-slate-400" />
            <span>Recount Supervisor: <strong className="text-white">{recounterName}</strong></span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center gap-2 transition"
            >
              <CheckCircle className="w-4 h-4" />
              Save Recount & Verify Segment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
