import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Lock,
  Save,
  CheckCircle,
  X,
  RotateCcw,
} from 'lucide-react';
import { BranchFloorSegment, Salesperson } from '../../types';
import {
  DEFAULT_BRANCH_FLOOR_SEGMENTS,
  getBranchFloorSegments,
  saveBranchFloorSegments,
} from '../../db/roomDatabase';

interface BranchSegmentsModalProps {
  branchId: string;
  branchName: string;
  currentUser: Salesperson | null;
  onClose: () => void;
  onSaved?: (segments: BranchFloorSegment[], finalized: boolean) => void;
}

export const BranchSegmentsModal: React.FC<BranchSegmentsModalProps> = ({
  branchId,
  branchName,
  currentUser,
  onClose,
  onSaved,
}) => {
  const [rows, setRows] = useState<BranchFloorSegment[]>([]);
  const [isFinalized, setIsFinalized] = useState(false);
  const [finalizedMeta, setFinalizedMeta] = useState<{ by?: string; at?: string; version: number }>({
    version: 0,
  });
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    const info = getBranchFloorSegments(branchId);
    setRows(info.segments);
    setIsFinalized(info.finalized);
    setFinalizedMeta({
      by: info.finalizedBy,
      at: info.finalizedAt,
      version: info.version,
    });
  }, [branchId]);

  const handleRowChange = (idx: number, field: keyof BranchFloorSegment, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  const handleMove = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[target];
      copy[target] = temp;
      return copy.map((r, i) => ({ ...r, sortOrder: i + 1 }));
    });
  };

  const handleAddRow = () => {
    const nextNum = rows.length + 1;
    setRows((prev) => [
      ...prev,
      {
        segmentId: `SEG-${String(nextNum).padStart(3, '0')}`,
        locationCode: `LOC-${String(nextNum).padStart(2, '0')}`,
        name: '',
        description: `Shop floor physical count location #${nextNum}`,
        sortOrder: nextNum,
      },
    ]);
  };

  const handleDeleteRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = (finalize: boolean) => {
    const valid = rows
      .filter((r) => String(r.name || '').trim().length > 0)
      .map((r, idx) => ({
        segmentId: r.segmentId || `SEG-${String(idx + 1).padStart(3, '0')}`,
        locationCode: String(r.locationCode || `LOC-${String(idx + 1).padStart(2, '0')}`).trim(),
        name: String(r.name).trim(),
        description: String(r.description || `Shop floor physical count location #${idx + 1}`).trim(),
        sortOrder: idx + 1,
      }));

    if (valid.length === 0) {
      setStatusBanner('Add at least one named physical floor segment before saving.');
      return;
    }

    const actorName = currentUser?.name || 'Branch Manager';
    saveBranchFloorSegments(branchId, valid, finalize, actorName);

    setIsFinalized(finalize);
    setRows(valid);
    if (onSaved) {
      onSaved(valid, finalize);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-white">Branch Master Floor Segments Panel</h3>
                {isFinalized ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Finalized v{finalizedMeta.version || 1}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700">
                    Draft Map
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {branchName} ({branchId}) • Auto-hydrates new Weekly & Lockdown stocktakes & syncs via Hub
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Meta strip */}
        {isFinalized && finalizedMeta.by && (
          <div className="bg-emerald-950/30 border-b border-emerald-800/50 px-5 py-2 text-xs text-emerald-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              Finalized by <strong>{finalizedMeta.by}</strong>
              {finalizedMeta.at ? ` on ${new Date(finalizedMeta.at).toLocaleString()}` : ''}
            </span>
            <span className="text-[11px] text-emerald-300/80">
              Updates will increment map version and re-sync across branch terminals.
            </span>
          </div>
        )}

        {statusBanner && (
          <div className="bg-rose-950/60 border-b border-rose-800 px-5 py-2 text-xs text-rose-200 font-semibold">
            {statusBanner}
          </div>
        )}

        {/* Segment Rows */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 text-xs">
          {rows.map((row, idx) => (
            <div
              key={`${row.segmentId}-${idx}`}
              className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-6 text-center font-mono text-[11px] text-slate-500 font-bold">
                  #{idx + 1}
                </span>
                <input
                  type="text"
                  value={row.locationCode}
                  onChange={(e) => handleRowChange(idx, 'locationCode', e.target.value)}
                  placeholder="LOC-01"
                  className="w-24 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg font-mono text-blue-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => handleRowChange(idx, 'name', e.target.value)}
                  placeholder="Aisle / Shelf Segment Name *"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-semibold text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={row.description || ''}
                  onChange={(e) => handleRowChange(idx, 'description', e.target.value)}
                  placeholder="Bounds / Shelf Description"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-1 shrink-0 justify-end">
                <button
                  type="button"
                  onClick={() => handleMove(idx, -1)}
                  disabled={idx === 0}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 transition"
                  title="Move Up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(idx, 1)}
                  disabled={idx === rows.length - 1}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 transition"
                  title="Move Down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteRow(idx)}
                  disabled={rows.length <= 1}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 disabled:opacity-30 transition"
                  title="Remove Segment"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 font-bold flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              Add Floor Segment
            </button>

            <button
              type="button"
              onClick={() => setRows(DEFAULT_BRANCH_FLOOR_SEGMENTS)}
              className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-800 font-semibold flex items-center gap-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Default Layout
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400">
            {rows.filter((r) => r.name.trim()).length} active segment(s) • Synced across branch devices via SyncCore
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 flex items-center gap-1.5 transition"
            >
              <Save className="w-3.5 h-3.5" />
              Save Draft Map
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 transition"
            >
              <Lock className="w-3.5 h-3.5" />
              Finalize Branch Floor Map
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
