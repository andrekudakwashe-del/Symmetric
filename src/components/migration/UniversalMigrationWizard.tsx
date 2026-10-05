import React, { useState, useEffect, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Layers,
  Users,
  Building2,
  Package,
  Calculator,
  Save,
  Trash2,
  Clock,
  RotateCcw,
  Check,
  Search,
  Eye,
  Sliders,
  DollarSign,
  Barcode,
  X,
  Plus,
  Play,
  Pause,
  ShieldCheck,
  Download,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Salesperson, PackagingVariant } from '../../types';
import { getSalespeople } from '../../db/roomDatabase';
import {
  parsePackagingVariantsString,
  serializePackagingVariants,
} from '../../services/dataExportImportService';
import {
  MigrationEntityType,
  MigrationJob,
  ColumnMapping,
  FormulaConfig,
  BatchPartition,
  StagedRow,
  DuplicateConflictPolicy,
  getFieldDefinitionsForEntity,
  autoMatchHeaders,
  parseLegacyFile,
  parsePastedTableText,
  applyMappingAndFormulas,
  partitionRowsIntoBatches,
  getAllMigrationJobs,
  saveMigrationJob,
  deleteMigrationJob,
  commitMigrationJob,
  commitMigrationJobAsync,
  rollbackMigrationJob,
} from '../../services/migrationService';

interface UniversalMigrationWizardProps {
  currentUser?: Salesperson | null;
  onNavigateHome?: () => void;
  onMigrationComplete?: () => void;
}

export const UniversalMigrationWizard: React.FC<UniversalMigrationWizardProps> = ({
  currentUser,
  onNavigateHome,
  onMigrationComplete,
}) => {
  // Wizard steps: 1: Upload, 2: Column Mapping, 3: Formulas, 4: Staged Review & Delegation, 5: Commit
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [entityType, setEntityType] = useState<MigrationEntityType>('inventory');

  // Existing saved draft projects
  const [savedJobs, setSavedJobs] = useState<MigrationJob[]>(() => getAllMigrationJobs());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Ingestion states
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>('');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Parsed raw file data
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);

  // Step 2: Mapping states
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});

  // Step 3: Formulas & Auto-Generators
  const [formulas, setFormulas] = useState<FormulaConfig>({
    autoGenerateSku: true,
    skuPrefix: 'PRD',
    skuDigits: 4,
    caseFormula: 'case_cost_from_unit',
    defaultCaseQuantity: 12,
    markupFormula: 'cost_plus_markup',
    markupPercent: 20,
    taxAdjustment: 'none',
    taxPercent: 15,
    cleanText: true,
    variantImportMode: 'parse_column',
    autoVariantPreset: 'none',
    autoVariantDiscountPercent: 5,
  });

  // Step 4: Staged rows & Collaborative Batches
  const [stagedRows, setStagedRows] = useState<StagedRow[]>([]);
  const [batches, setBatches] = useState<BatchPartition[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | 'ALL'>('ALL');
  const [stagedSearch, setStagedSearch] = useState('');
  const [showBatchAssignModal, setShowBatchAssignModal] = useState(false);
  const [editingVariantRow, setEditingVariantRow] = useState<StagedRow | null>(null);

  // Step 5: Commit policy
  const [conflictPolicy, setConflictPolicy] = useState<DuplicateConflictPolicy>('update');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{
    processed: number;
    total: number;
    pct: number;
    curItem?: string;
  } | null>(null);
  const [commitResult, setCommitResult] = useState<{
    success: boolean;
    message: string;
    recordsAdded: number;
    recordsUpdated: number;
  } | null>(null);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);

  const staffList = useMemo(() => getSalespeople().filter((s) => s.active === 'Y'), []);
  const targetFields = useMemo(() => getFieldDefinitionsForEntity(entityType), [entityType]);

  // Sync prefix with entity type
  useEffect(() => {
    if (entityType === 'inventory') {
      setFormulas((prev) => ({ ...prev, skuPrefix: 'PRD' }));
    } else if (entityType === 'customers') {
      setFormulas((prev) => ({ ...prev, skuPrefix: 'CUST' }));
    } else if (entityType === 'suppliers') {
      setFormulas((prev) => ({ ...prev, skuPrefix: 'SUP' }));
    }
  }, [entityType]);

  // Load a saved draft job
  const handleLoadJob = (job: MigrationJob) => {
    setActiveJobId(job.id);
    setEntityType(job.entityType);
    setRawHeaders(job.rawHeaders || []);
    setMappings(job.mappings || {});
    setFormulas(job.formulas || formulas);
    setStagedRows(job.stagedRows || []);
    setBatches(job.partitions || []);
    setConflictPolicy(job.conflictPolicy || 'update');

    if (job.status === 'committed') {
      setCurrentStep(5);
      setCommitResult({
        success: true,
        message: `This migration was committed on ${new Date(job.committedAt || '').toLocaleDateString()}.`,
        recordsAdded: job.totalRows,
        recordsUpdated: 0,
      });
    } else {
      setCurrentStep(4);
    }
  };

  // Delete saved draft
  const handleDeleteJob = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMigrationJob(id);
    setSavedJobs(getAllMigrationJobs());
    if (activeJobId === id) {
      setActiveJobId(null);
      setCurrentStep(1);
    }
  };

  // Step 1: File selection & Parsing
  const handleFileDrop = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    setUploadedFile(file);

    try {
      const res = await parseLegacyFile(file);
      setRawHeaders(res.headers);
      setRawRows(res.rows);

      // Auto-match headers
      const matched = autoMatchHeaders(entityType, res.headers);
      setMappings(matched);

      // Advance to Step 2
      setCurrentStep(2);
    } catch (err: any) {
      setParseError(`Failed to parse file: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) return;
    setParseError(null);
    setIsParsing(true);

    try {
      const res = parsePastedTableText(pastedText);
      setRawHeaders(res.headers);
      setRawRows(res.rows);
      setUploadedFile(null);

      const matched = autoMatchHeaders(entityType, res.headers);
      setMappings(matched);

      setShowPasteModal(false);
      setCurrentStep(2);
    } catch (err: any) {
      setParseError(`Failed to parse pasted data: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Step 2 -> 3
  const handleProceedToFormulas = () => {
    // Check if required fields are mapped
    const missingReq = targetFields.filter((f) => f.required && !mappings[f.key]?.sourceHeader);
    if (missingReq.length > 0) {
      setParseError(`Please map required field: ${missingReq.map((m) => m.label).join(', ')}`);
      return;
    }
    setParseError(null);
    setCurrentStep(3);
  };

  // Step 3 -> 4: Apply formulas and generate staged rows
  const handleApplyFormulasAndStage = () => {
    setIsParsing(true);
    try {
      const staged = applyMappingAndFormulas(entityType, rawRows, mappings, formulas);
      setStagedRows(staged);

      // Create initial batches for staff delegation
      const initialBatches = partitionRowsIntoBatches(staged.length, 250, staffList);
      setBatches(initialBatches);

      // Save persistent draft
      const jobId = activeJobId || `JOB_${Date.now()}`;
      const newJob: MigrationJob = {
        id: jobId,
        title: `${entityType.toUpperCase()} Migration (${uploadedFile?.name || 'Clipboard'})`,
        entityType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'in_review',
        fileName: uploadedFile?.name || 'Manual Paste',
        rawHeaders,
        mappings,
        formulas,
        partitions: initialBatches,
        stagedRows: staged,
        totalRows: staged.length,
        verifiedRows: staged.filter((r) => r._isValid).length,
        conflictPolicy,
      };

      saveMigrationJob(newJob);
      setActiveJobId(jobId);
      setSavedJobs(getAllMigrationJobs());

      setCurrentStep(4);
    } catch (err: any) {
      setParseError(`Error generating staged data: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Save current progress as persistent draft
  const handleSaveProgressDraft = () => {
    if (!activeJobId && stagedRows.length === 0) return;
    const jobId = activeJobId || `JOB_${Date.now()}`;
    const job: MigrationJob = {
      id: jobId,
      title: `${entityType.toUpperCase()} Migration - ${uploadedFile?.name || 'Draft'}`,
      entityType,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      fileName: uploadedFile?.name,
      rawHeaders,
      mappings,
      formulas,
      partitions: batches,
      stagedRows,
      totalRows: stagedRows.length,
      verifiedRows: stagedRows.filter((r) => r._isValid).length,
      conflictPolicy,
    };
    saveMigrationJob(job);
    setActiveJobId(jobId);
    setSavedJobs(getAllMigrationJobs());
    alert('Migration project saved! You can pause now and return anytime.');
  };

  const handleUpdateStagedCell = (rowId: string, field: string, value: any) => {
    setStagedRows((prev) =>
      prev.map((r) => {
        if (r._rowId === rowId) {
          const updated = { ...r, [field]: value };
          if (field === 'costPrice' || field === 'caseQuantity') {
            const cost = Number(field === 'costPrice' ? value : r.costPrice) || 0;
            const cq = Number(field === 'caseQuantity' ? value : r.caseQuantity) || 1;
            updated.caseCost = cost * cq;
          }
          if (field === 'name') {
            updated._isValid = Boolean(value && String(value).trim().length > 0);
          }
          return updated;
        }
        return r;
      })
    );
  };

  const handleDeleteStagedRow = (rowId: string) => {
    setStagedRows((prev) => prev.filter((r) => r._rowId !== rowId));
  };

  const handleSaveVariants = (rowId: string, variants: PackagingVariant[]) => {
    const serialized = serializePackagingVariants(variants);
    setStagedRows((prev) =>
      prev.map((r) => {
        if (r._rowId === rowId) {
          return {
            ...r,
            _parsedVariants: variants,
            packagingVariants: serialized,
          };
        }
        return r;
      })
    );
    if (editingVariantRow && editingVariantRow._rowId === rowId) {
      setEditingVariantRow((prev) =>
        prev
          ? {
              ...prev,
              _parsedVariants: variants,
              packagingVariants: serialized,
            }
          : null
      );
    }
  };

  // Final Commit to Live Store
  const handleCommitMigration = async () => {
    if (stagedRows.length === 0) return;
    setIsCommitting(true);
    setParseError(null);

    try {
      const jobId = activeJobId || `JOB_${Date.now()}`;
      const currentJob: MigrationJob = {
        id: jobId,
        title: `${entityType.toUpperCase()} Migration`,
        entityType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'ready',
        rawHeaders,
        mappings,
        formulas,
        partitions: batches,
        stagedRows,
        totalRows: stagedRows.length,
        verifiedRows: stagedRows.filter((r) => r._isValid).length,
        conflictPolicy,
      };

      setCommitProgress({ processed: 0, total: stagedRows.length, pct: 0 });
      const result = await commitMigrationJobAsync(currentJob, conflictPolicy, (processed, total, pct, curItem) => {
        setCommitProgress({ processed, total, pct, curItem });
      });
      if (result.success) {
        setCommitResult(result);
        setSavedJobs(getAllMigrationJobs());
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        if (onMigrationComplete) {
          onMigrationComplete();
        }
      } else {
        setParseError(result.message);
      }
    } catch (err: any) {
      setParseError(`Commit failed: ${err.message}`);
    } finally {
      setIsCommitting(false);
      setCommitProgress(null);
    }
  };

  // Undo / Rollback
  const handleRollback = () => {
    if (!activeJobId) return;
    const job = getAllMigrationJobs().find((j) => j.id === activeJobId);
    if (!job) return;

    const res = rollbackMigrationJob(job);
    if (res.success) {
      setRollbackSuccessMsg(res.message);
      setCommitResult(null);
      setSavedJobs(getAllMigrationJobs());
      setCurrentStep(4);
    } else {
      setParseError(res.message);
    }
  };

  // Filtered staged rows for Step 4
  const filteredStagedRows = useMemo(() => {
    let rows = stagedRows;
    if (selectedBatchId !== 'ALL') {
      const b = batches.find((x) => x.id === selectedBatchId);
      if (b) {
        rows = rows.slice(b.startIndex, b.endIndex + 1);
      }
    }
    if (stagedSearch.trim()) {
      const q = stagedSearch.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.sku && r.sku.toLowerCase().includes(q)) ||
          (r.barcode && r.barcode.toLowerCase().includes(q)) ||
          (r.category && r.category.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [stagedRows, selectedBatchId, batches, stagedSearch]);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-purple-950/70 via-indigo-950/70 to-slate-900 border border-purple-500/30 rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Universal Legacy Migration &amp; Onboarding Hub</span>
            </div>
            <h2 className="text-xl font-black text-white">
              Migrate Any POS, Excel, or Legacy Database in Minutes
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Eliminate re-typing friction. Upload files from QuickBooks, Sage Pastel, or custom Excel sheets. Smart auto-heading matcher, dynamic formula builder, and collaborative multi-staff review.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleSaveProgressDraft}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
                title="Pause and save draft to resume later"
              >
                <Save className="w-3.5 h-3.5 text-indigo-400" />
                <span>Pause &amp; Save Draft</span>
              </button>
            )}

            {onNavigateHome && (
              <button
                type="button"
                onClick={onNavigateHome}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-bold border border-slate-700 transition"
              >
                Close Wizard
              </button>
            )}
          </div>
        </div>

        {/* Wizard Step Progress Tracker */}
        <div className="grid grid-cols-5 gap-2 mt-6 pt-5 border-t border-purple-900/40 text-xs">
          {[
            { step: 1, label: '1. Ingest File' },
            { step: 2, label: '2. Smart Matcher' },
            { step: 3, label: '3. Auto Formulas' },
            { step: 4, label: '4. Staged Review' },
            { step: 5, label: '5. Commit to Store' },
          ].map((s) => {
            const isDone = currentStep > s.step;
            const isCurrent = currentStep === s.step;
            return (
              <div
                key={s.step}
                className={`py-2 px-3 rounded-xl border flex items-center gap-2 transition ${
                  isCurrent
                    ? 'bg-purple-600/30 border-purple-400 text-white font-bold shadow-md shadow-purple-900/40'
                    : isDone
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 font-semibold'
                    : 'bg-slate-900/40 border-slate-800 text-slate-500'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrent
                      ? 'bg-purple-500 text-white'
                      : isDone
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isDone ? '✓' : s.step}
                </span>
                <span className="truncate">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error or Alert Banner */}
      {parseError && (
        <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{parseError}</span>
          </div>
          <button
            type="button"
            onClick={() => setParseError(null)}
            className="text-rose-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {rollbackSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{rollbackSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setRollbackSuccessMsg(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 1: FILE INGESTION & ENTITY SELECTION */}
      {/* ========================================================================= */}
      {currentStep === 1 && (
        <div className="space-y-6">
          {/* Entity Type Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Select Data Type to Migrate
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'inventory',
                  label: 'Inventory & Products',
                  icon: Package,
                  desc: 'Stock items, costs, retail prices, packaging, cases & categories',
                },
                {
                  id: 'customers',
                  label: 'Customers & Debtors',
                  icon: Users,
                  desc: 'Accounts, credit limits, phone numbers & opening debt balances',
                },
                {
                  id: 'suppliers',
                  label: 'Suppliers & Vendors',
                  icon: Building2,
                  desc: 'Wholesale suppliers, contact persons, phones & payment terms',
                },
              ].map((ent) => {
                const isSelected = entityType === ent.id;
                const Icon = ent.icon;
                return (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => setEntityType(ent.id as MigrationEntityType)}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between space-y-2 cursor-pointer ${
                      isSelected
                        ? 'bg-purple-950/60 border-purple-500 text-white shadow-lg shadow-purple-900/30'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                          isSelected ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-purple-400" />}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">{ent.label}</div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{ent.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Upload Dropzone */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Upload Legacy Data File (.xlsx, .xls, .csv, .json)
            </label>
            <div className="border-2 border-dashed border-slate-700 hover:border-purple-500/80 rounded-3xl p-8 flex flex-col items-center justify-center bg-slate-900/60 hover:bg-slate-900 transition-all text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Upload className="w-7 h-7" />
              </div>

              <div>
                <h4 className="text-sm font-bold text-white">
                  Drop your Excel spreadsheet or CSV export here
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Supports Excel (.xlsx, .xls), CSV, TSV, or JSON. Headings do not need to match our names!
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <label className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-900/40 cursor-pointer transition">
                  <span>Browse File on Device</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv,.json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileDrop(f);
                    }}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowPasteModal(true)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition cursor-pointer"
                >
                  📋 Or Paste from Clipboard
                </button>
              </div>

              {isParsing && (
                <div className="flex items-center gap-2 text-xs text-purple-400 pt-2 animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Parsing legacy spreadsheet structure...</span>
                </div>
              )}
            </div>
          </div>

          {/* Saved Migration Projects / Drafts List */}
          {savedJobs.length > 0 && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Existing Migration Projects ({savedJobs.length})
                  </h4>
                </div>
                <span className="text-[11px] text-slate-500">
                  Paused projects can be resumed anytime with zero loss
                </span>
              </div>

              <div className="divide-y divide-slate-800/80">
                {savedJobs.map((job) => (
                  <div
                    key={job.id}
                    onClick={() => handleLoadJob(job)}
                    className="py-3 px-3 rounded-xl hover:bg-slate-800/50 flex items-center justify-between transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                          job.status === 'committed'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-purple-500/20 text-purple-400'
                        }`}
                      >
                        {job.entityType === 'inventory' ? '📦' : job.entityType === 'customers' ? '👥' : '🏢'}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white group-hover:text-purple-300 transition">
                          {job.title}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>{job.totalRows} rows</span>
                          <span>•</span>
                          <span>{new Date(job.updatedAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              job.status === 'committed'
                                ? 'bg-emerald-950 text-emerald-300'
                                : 'bg-amber-950 text-amber-300'
                            }`}
                          >
                            {job.status === 'committed' ? 'Committed' : 'In Review / Paused'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => handleDeleteJob(job.id, e)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white transition" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: SMART COLUMN MATCHER (SYNONYM DICTIONARY) */}
      {/* ========================================================================= */}
      {currentStep === 2 && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Match Your File Headers to Saimetric Fields</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300">
                  {rawHeaders.length} Columns Detected
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Our synonym engine pre-matched common terms. Review and adjust any dropdowns below.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={handleProceedToFormulas}
                className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-900/30 flex items-center gap-1.5"
              >
                <span>Continue to Formulas</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Mapping Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-12 gap-3 p-3.5 bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase text-slate-400">
              <div className="col-span-4">Saimetric Target Field</div>
              <div className="col-span-4">Your File Column Heading</div>
              <div className="col-span-4">Live Sample Data (Row 1)</div>
            </div>

            <div className="divide-y divide-slate-800/80">
              {targetFields.map((field) => {
                const currentMapped = mappings[field.key]?.sourceHeader || '';
                const sampleVal = currentMapped && rawRows[0] ? rawRows[0][currentMapped] : '—';
                const isMatched = Boolean(currentMapped);

                return (
                  <div key={field.key} className="grid grid-cols-12 gap-3 p-3.5 items-center text-xs">
                    <div className="col-span-4 space-y-0.5">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span>{field.label}</span>
                        {field.required && (
                          <span className="text-rose-400 text-[10px] font-mono font-bold">*Required</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 leading-snug">{field.description}</div>
                    </div>

                    <div className="col-span-4">
                      <select
                        value={currentMapped}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setMappings((prev) => ({
                            ...prev,
                            [field.key]: {
                              targetFieldKey: field.key,
                              sourceHeader: val,
                            },
                          }));
                        }}
                        className={`w-full py-2 px-3 rounded-xl border text-xs font-medium focus:outline-none transition ${
                          isMatched
                            ? 'bg-slate-950 border-purple-500/60 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-500'
                        }`}
                      >
                        <option value="">-- Do Not Import / Not in File --</option>
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-4 font-mono text-[11px] text-slate-300 truncate bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                      {String(sampleVal)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: DYNAMIC FORMULAS & AUTO-GENERATION ENGINE */}
      {/* ========================================================================= */}
      {currentStep === 3 && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Formulas, Auto-Generators &amp; Packaging Conversion</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically generate missing codes, compute wholesale carton/case costs, and apply retail markups.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={handleApplyFormulasAndStage}
                className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-900/30 flex items-center gap-1.5 cursor-pointer"
              >
                <span>Apply Formulas &amp; Stage Rows</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Rule 1: Auto-Generate Missing SKU / Codes */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  <Barcode className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    1. Auto-Generate Missing Codes / SKUs
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    If old system did not have item codes, auto-generate clean sequential identifiers.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={formulas.autoGenerateSku}
                    onChange={(e) =>
                      setFormulas((prev) => ({ ...prev, autoGenerateSku: e.target.checked }))
                    }
                    className="w-4 h-4 rounded text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                  />
                  <span>Generate unique codes when missing</span>
                </label>

                {formulas.autoGenerateSku && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                        Prefix
                      </label>
                      <input
                        type="text"
                        value={formulas.skuPrefix}
                        onChange={(e) =>
                          setFormulas((prev) => ({ ...prev, skuPrefix: e.target.value.toUpperCase() }))
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white uppercase font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                        Sample Result
                      </label>
                      <div className="py-1.5 px-3 rounded-xl bg-slate-950 border border-slate-800 text-purple-400 font-mono text-xs">
                        {formulas.skuPrefix}-0001
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Rule 2: Case & Packaging Conversion Formula */}
            {entityType === 'inventory' && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    <Calculator className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      2. Case &amp; Wholesale Carton Formula
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Convert between single unit cost and bulk case costs automatically.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <select
                    value={formulas.caseFormula}
                    onChange={(e) =>
                      setFormulas((prev) => ({ ...prev, caseFormula: e.target.value as any }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="none">No Formula (Use file values as-is)</option>
                    <option value="case_cost_from_unit">
                      Calculate Case Cost = Unit Cost × Case Quantity
                    </option>
                    <option value="unit_cost_from_case">
                      Calculate Unit Cost = Case Cost ÷ Case Quantity
                    </option>
                  </select>

                  <div className="flex items-center justify-between text-xs text-slate-400 pl-1">
                    <span>Default units per case (if empty):</span>
                    <input
                      type="number"
                      min="1"
                      value={formulas.defaultCaseQuantity}
                      onChange={(e) =>
                        setFormulas((prev) => ({
                          ...prev,
                          defaultCaseQuantity: parseInt(e.target.value, 10) || 1,
                        }))
                      }
                      className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Rule 3: Retail Price Markup Generator */}
            {entityType === 'inventory' && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      3. Profit Margin / Retail Markup Formula
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      If old database only had cost prices, auto-calculate selling prices.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={formulas.markupFormula === 'cost_plus_markup'}
                      onChange={(e) =>
                        setFormulas((prev) => ({
                          ...prev,
                          markupFormula: e.target.checked ? 'cost_plus_markup' : 'none',
                        }))
                      }
                      className="w-4 h-4 rounded text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                    />
                    <span>Auto-calculate retail price from cost + markup %</span>
                  </label>

                  {formulas.markupFormula === 'cost_plus_markup' && (
                    <div className="flex items-center gap-2 pl-6 text-xs text-slate-300">
                      <span>Markup Percentage:</span>
                      <input
                        type="number"
                        min="0"
                        max="500"
                        value={formulas.markupPercent}
                        onChange={(e) =>
                          setFormulas((prev) => ({
                            ...prev,
                            markupPercent: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono text-right"
                      />
                      <span>% (e.g. $10.00 cost &rarr; ${((10 * (1 + formulas.markupPercent / 100))).toFixed(2)})</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rule 4: Data Cleansing & Title Casing */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    4. Data Cleansing &amp; Standardizer
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Format messy text, remove excess spacing, and title-case product titles.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1 text-xs text-slate-300">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formulas.cleanText}
                    onChange={(e) =>
                      setFormulas((prev) => ({ ...prev, cleanText: e.target.checked }))
                    }
                    className="w-4 h-4 rounded text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                  />
                  <span>Trim whitespace &amp; format names in Title Case</span>
                </label>
              </div>
            </div>

            {/* Rule 5: Packaging Variants & Prepacks Engine */}
            {entityType === 'inventory' && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                    <Package className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      5. Packaging Variants &amp; Prepacks Engine
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Import prepacks from spreadsheet column or auto-generate pack sizes with bulk pricing.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label
                      className={`p-3 rounded-2xl border text-xs cursor-pointer flex flex-col justify-between transition ${
                        formulas.variantImportMode === 'parse_column'
                          ? 'bg-purple-600/10 border-purple-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="variantMode"
                          checked={formulas.variantImportMode === 'parse_column'}
                          onChange={() =>
                            setFormulas((prev) => ({ ...prev, variantImportMode: 'parse_column' }))
                          }
                          className="w-3.5 h-3.5 text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                        />
                        <span className="font-bold text-white">Import from File</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Parse prepack variants from spreadsheet column (key-value or JSON).
                      </span>
                    </label>

                    <label
                      className={`p-3 rounded-2xl border text-xs cursor-pointer flex flex-col justify-between transition ${
                        formulas.variantImportMode === 'auto_generate'
                          ? 'bg-purple-600/10 border-purple-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="variantMode"
                          checked={formulas.variantImportMode === 'auto_generate'}
                          onChange={() =>
                            setFormulas((prev) => ({ ...prev, variantImportMode: 'auto_generate' }))
                          }
                          className="w-3.5 h-3.5 text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                        />
                        <span className="font-bold text-white">Auto-Generate</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Create prepacks automatically for all items using a standard ratio.
                      </span>
                    </label>

                    <label
                      className={`p-3 rounded-2xl border text-xs cursor-pointer flex flex-col justify-between transition ${
                        formulas.variantImportMode === 'none'
                          ? 'bg-purple-600/10 border-purple-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="variantMode"
                          checked={formulas.variantImportMode === 'none'}
                          onChange={() =>
                            setFormulas((prev) => ({ ...prev, variantImportMode: 'none' }))
                          }
                          className="w-3.5 h-3.5 text-purple-600 focus:ring-0 bg-slate-950 border-slate-700"
                        />
                        <span className="font-bold text-white">Skip Variants</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Only import single and case units without prepack variants.
                      </span>
                    </label>
                  </div>

                  {formulas.variantImportMode === 'auto_generate' && (
                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-400 mb-1">
                            Prepack Preset Size:
                          </label>
                          <select
                            value={formulas.autoVariantPreset || 'five_pack'}
                            onChange={(e) =>
                              setFormulas((prev) => ({
                                ...prev,
                                autoVariantPreset: e.target.value as any,
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                          >
                            <option value="five_pack">Prepack (5s) - 5 Single Units</option>
                            <option value="ten_pack">Pack of 10s - 10 Single Units</option>
                            <option value="double_pack">Double Pack (2s) - 2 Single Units</option>
                            <option value="half_pack">Half Portion - 0.5 Single Units</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-400 mb-1">
                            Prepack Discount (% off singles):
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="50"
                              value={formulas.autoVariantDiscountPercent || 5}
                              onChange={(e) =>
                                setFormulas((prev) => ({
                                  ...prev,
                                  autoVariantDiscountPercent: parseFloat(e.target.value) || 0,
                                }))
                              }
                              className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono text-right"
                            />
                            <span className="text-xs text-slate-400">% bulk incentive discount</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 4: STAGED WORKSPACE & COLLABORATIVE BATCH DELEGATION */}
      {/* ========================================================================= */}
      {currentStep === 4 && (
        <div className="space-y-6">
          {/* Top Actions & Summary Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Staged Migration Workspace</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                  {stagedRows.length} Rows Staged
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300">
                  {batches.length} Batches
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Review, correct values inline, delegate batches to staff members, or proceed to final commit.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBatchAssignModal(true)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Delegate to Staff</span>
              </button>

              <button
                type="button"
                onClick={handleSaveProgressDraft}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save &amp; Pause</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentStep(5)}
                className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-900/30 flex items-center gap-1.5 cursor-pointer"
              >
                <span>Commit to Live Store</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Batch Filter Tabs */}
          <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1.5 overflow-x-auto text-xs">
            <button
              type="button"
              onClick={() => setSelectedBatchId('ALL')}
              className={`px-3 py-1.5 rounded-xl font-bold transition ${
                selectedBatchId === 'ALL'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              All Batches ({stagedRows.length})
            </button>
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBatchId(b.id)}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                  selectedBatchId === b.id
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>{b.title}</span>
                {b.assignedStaffName && (
                  <span className="text-[10px] opacity-75 font-normal">({b.assignedStaffName})</span>
                )}
              </button>
            ))}
          </div>

          {/* Staged Data Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-sm">
            <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="relative max-w-xs w-full">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search staged items..."
                  value={stagedSearch}
                  onChange={(e) => setStagedSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="text-xs text-slate-400">
                Showing {filteredStagedRows.length} of {stagedRows.length} records
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold sticky top-0 z-10 border-b border-slate-800">
                  <tr>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Item / Name (Editable)</th>
                    <th className="p-2.5">Code / SKU</th>
                    <th className="p-2.5">Barcode</th>
                    <th className="p-2.5">Category</th>
                    {entityType === 'inventory' && (
                      <>
                        <th className="p-2.5 text-right">Cost Price ($)</th>
                        <th className="p-2.5 text-right">Retail Price ($)</th>
                        <th className="p-2.5 text-right">Case Qty</th>
                        <th className="p-2.5 text-right">Case Cost ($)</th>
                        <th className="p-2.5 text-right">Opening Qty</th>
                        <th className="p-2.5 text-center">Prepacks / Variants</th>
                      </>
                    )}
                    {entityType === 'customers' && (
                      <>
                        <th className="p-2.5">Phone</th>
                        <th className="p-2.5 text-right">Credit Limit ($)</th>
                        <th className="p-2.5 text-right">Opening Debt ($)</th>
                      </>
                    )}
                    {entityType === 'suppliers' && (
                      <>
                        <th className="p-2.5">Contact</th>
                        <th className="p-2.5">Phone</th>
                        <th className="p-2.5">Terms</th>
                      </>
                    )}
                    <th className="p-2.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredStagedRows.slice(0, 100).map((row) => (
                    <tr key={row._rowId} className="hover:bg-slate-800/40 transition">
                      <td className="p-2.5">
                        {row._isValid ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                            Valid
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400" title={row._validationErrors?.join(', ')}>
                            Error
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.name || ''}
                          onChange={(e) => handleUpdateStagedCell(row._rowId, 'name', e.target.value)}
                          className="w-full min-w-[160px] bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-xs text-white font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.sku || row.customerCode || row.supplierCode || ''}
                          onChange={(e) =>
                            handleUpdateStagedCell(
                              row._rowId,
                              entityType === 'inventory' ? 'sku' : entityType === 'customers' ? 'customerCode' : 'supplierCode',
                              e.target.value
                            )
                          }
                          className="w-24 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 font-mono text-purple-300 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.barcode || ''}
                          onChange={(e) => handleUpdateStagedCell(row._rowId, 'barcode', e.target.value)}
                          className="w-28 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 font-mono text-slate-300 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.category || ''}
                          onChange={(e) => handleUpdateStagedCell(row._rowId, 'category', e.target.value)}
                          className="w-24 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-slate-300 text-xs"
                        />
                      </td>
                      {entityType === 'inventory' && (
                        <>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={row.costPrice !== undefined ? row.costPrice : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'costPrice', e.target.value)}
                              className="w-20 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-right font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={row.sellingPrice !== undefined ? row.sellingPrice : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'sellingPrice', e.target.value)}
                              className="w-20 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-emerald-500 rounded-lg px-2 py-1 text-right font-mono text-emerald-400 font-bold text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="1"
                              value={row.caseQuantity || 1}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'caseQuantity', e.target.value)}
                              className="w-16 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-right font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={row.caseCost !== undefined ? row.caseCost : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'caseCost', e.target.value)}
                              className="w-20 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-right font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              value={row.stockQuantity !== undefined ? row.stockQuantity : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'stockQuantity', e.target.value)}
                              className="w-20 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-amber-500 rounded-lg px-2 py-1 text-right font-mono text-amber-400 font-bold text-xs"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => setEditingVariantRow(row)}
                              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition whitespace-nowrap mx-auto ${
                                row._parsedVariants && row._parsedVariants.length > 0
                                  ? 'bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30'
                                  : 'bg-slate-950/60 hover:bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                              title="Configure Prepacks and Packaging Variants"
                            >
                              <Package className="w-3 h-3 text-purple-400" />
                              <span>
                                {row._parsedVariants && row._parsedVariants.length > 0
                                  ? `${row._parsedVariants.length} Prepack${row._parsedVariants.length > 1 ? 's' : ''}`
                                  : '+ Add Prepack'}
                              </span>
                            </button>
                          </td>
                        </>
                      )}
                      {entityType === 'customers' && (
                        <>
                          <td className="p-2">
                            <input
                              type="text"
                              value={row.phone || ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'phone', e.target.value)}
                              className="w-28 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={row.creditLimit !== undefined ? row.creditLimit : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'creditLimit', e.target.value)}
                              className="w-24 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-right font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={row.currentBalance !== undefined ? row.currentBalance : ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'currentBalance', e.target.value)}
                              className="w-24 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-rose-500 rounded-lg px-2 py-1 text-right font-mono text-rose-400 font-bold text-xs"
                            />
                          </td>
                        </>
                      )}
                      {entityType === 'suppliers' && (
                        <>
                          <td className="p-2">
                            <input
                              type="text"
                              value={row.contactPerson || ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'contactPerson', e.target.value)}
                              className="w-28 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={row.phone || ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'phone', e.target.value)}
                              className="w-28 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 font-mono text-slate-300 text-xs"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={row.paymentTerms || ''}
                              onChange={(e) => handleUpdateStagedCell(row._rowId, 'paymentTerms', e.target.value)}
                              className="w-24 bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/60 focus:border-purple-500 rounded-lg px-2 py-1 text-slate-300 text-xs"
                            />
                          </td>
                        </>
                      )}
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteStagedRow(row._rowId)}
                          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          title="Delete row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 5: VALIDATION, DEDUPLICATION & COMMIT TO LIVE STORE */}
      {/* ========================================================================= */}
      {currentStep === 5 && (
        <div className="space-y-6">
          {commitResult ? (
            /* Success State */
            <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
              <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-black text-white">Migration Complete!</h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto">{commitResult.message}</p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleRollback}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white font-bold text-xs border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Undo Migration (Rollback)</span>
                </button>

                {onNavigateHome && (
                  <button
                    type="button"
                    onClick={onNavigateHome}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-xs shadow-lg shadow-purple-900/30 cursor-pointer"
                  >
                    Go to Store Home
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Pre-Commit Review & Duplicate Policy */
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">
                      Final Review &amp; Conflict Handling
                    </h3>
                    <p className="text-xs text-slate-400">
                      Configure duplicate protection before committing staged rows to your live store database.
                    </p>
                  </div>
                </div>

                {/* Conflict Policy Selector */}
                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    Duplicate Handling Policy (When Barcode or SKU already exists)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setConflictPolicy('update')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        conflictPolicy === 'update'
                          ? 'bg-purple-950/60 border-purple-500 text-white shadow-md'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <strong className="block text-xs text-white mb-0.5">
                        Update Existing Records (Recommended)
                      </strong>
                      <span className="text-[11px] block opacity-80 leading-snug">
                        Updates price, cost, and adds new opening stock on top of existing stock.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConflictPolicy('skip')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        conflictPolicy === 'skip'
                          ? 'bg-purple-950/60 border-purple-500 text-white shadow-md'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <strong className="block text-xs text-white mb-0.5">
                        Skip Duplicates
                      </strong>
                      <span className="text-[11px] block opacity-80 leading-snug">
                        Keeps existing records untouched; only imports brand-new items.
                      </span>
                    </button>
                  </div>
                </div>

                {/* Pre-Migration Safety Guarantee */}
                <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-xs flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <strong className="text-white font-bold block">Automated Safety Snapshot</strong>
                    <p className="text-[11px] text-slate-300">
                      Before committing, a complete encrypted snapshot of your target table will be recorded. You can undo and restore in one click at any time.
                    </p>
                  </div>
                </div>

                {/* Progress bar during async commit */}
                {isCommitting && commitProgress && (
                  <div className="p-4 rounded-2xl bg-slate-900 border border-purple-500/40 space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                        <span>Processing {commitProgress.curItem ? `"${commitProgress.curItem}"` : 'records'}...</span>
                      </span>
                      <span className="font-mono text-purple-300 font-bold">
                        {commitProgress.processed} / {commitProgress.total} ({commitProgress.pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-150 rounded-full"
                        style={{ width: `${commitProgress.pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 italic">
                      Committing in lightweight asynchronous batches to keep browser responsive.
                    </p>
                  </div>
                )}

                {/* Commit Action */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                  >
                    &larr; Back to Staged Review
                  </button>

                  <button
                    type="button"
                    id="btn-final-commit"
                    onClick={handleCommitMigration}
                    disabled={isCommitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white font-black text-xs shadow-lg shadow-purple-900/40 flex items-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    {isCommitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Committing {stagedRows.length} Items to Store...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Commit {stagedRows.length} Records to Live Store</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Paste from Clipboard */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Paste Table from Clipboard</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Copy rows from Excel or Google Sheets and paste them directly below:
            </p>

            <textarea
              rows={8}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste tab-separated or comma-separated rows here..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePasteSubmit}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md cursor-pointer"
              >
                Parse Pasted Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delegate Batches to Staff */}
      {showBatchAssignModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Delegate Batches to Staff</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBatchAssignModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Assign staff members to verify individual partitions of this migration batch:
            </p>

            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {batches.map((b) => (
                <div key={b.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-white">
                    <span>{b.title}</span>
                    <span className="text-slate-400 font-mono">{b.totalRows} items</span>
                  </div>

                  <select
                    value={b.assignedStaffId || ''}
                    onChange={(e) => {
                      const staffId = e.target.value;
                      const staff = staffList.find((s) => s.id === staffId);
                      setBatches((prev) =>
                        prev.map((x) =>
                          x.id === b.id
                            ? {
                                ...x,
                                assignedStaffId: staffId || undefined,
                                assignedStaffName: staff?.name || undefined,
                              }
                            : x
                        )
                      );
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="">-- Unassigned (Manager Only) --</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowBatchAssignModal(false)}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Staged Product Prepacks & Packaging Variants Editor */}
      {editingVariantRow && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Prepacks &amp; Packaging Variants</h3>
                  <p className="text-xs text-slate-400">
                    {editingVariantRow.name || 'Product'} (Single Sell: ${Number(editingVariantRow.sellingPrice || 0).toFixed(2)}, Cost: ${Number(editingVariantRow.costPrice || 0).toFixed(2)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingVariantRow(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Existing Variants List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Configured Prepacks ({(editingVariantRow._parsedVariants || []).length})
                  </span>
                </div>

                {(!editingVariantRow._parsedVariants || editingVariantRow._parsedVariants.length === 0) ? (
                  <div className="p-6 rounded-2xl bg-slate-950/60 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-300">No packaging variants configured yet.</p>
                    <p className="text-[11px]">Use a quick preset below or add a custom prepack size.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editingVariantRow._parsedVariants.map((v: PackagingVariant, vIdx: number) => (
                      <div
                        key={v.id || vIdx}
                        className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{v.name}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300">
                              {v.unitsPerPack} Singles
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-3">
                            <span>Sell: <strong className="text-emerald-400">${Number(v.sellPrice || 0).toFixed(2)}</strong></span>
                            {v.costPrice !== undefined && (
                              <span>Cost: <strong className="text-slate-300">${Number(v.costPrice || 0).toFixed(2)}</strong></span>
                            )}
                            {v.barcode && <span>Barcode: <span className="font-mono text-slate-400">{v.barcode}</span></span>}
                            {v.sku && <span>SKU: <span className="font-mono text-purple-300">{v.sku}</span></span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (editingVariantRow._parsedVariants || []).filter((_: any, idx: number) => idx !== vIdx);
                              handleSaveVariants(editingVariantRow._rowId, updated);
                            }}
                            className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition"
                            title="Delete variant"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Preset Buttons */}
              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Quick Prepack Presets:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const sell = Number(editingVariantRow.sellingPrice) || 0;
                      const cost = Number(editingVariantRow.costPrice) || 0;
                      const newV: PackagingVariant = {
                        id: `VAR-5PK-${Date.now().toString().slice(-4)}`,
                        name: 'Prepack (5s)',
                        unitsPerPack: 5,
                        sellPrice: Number((sell * 5 * 0.95).toFixed(2)),
                        costPrice: Number((cost * 5).toFixed(2)),
                      };
                      const updated = [...(editingVariantRow._parsedVariants || []), newV];
                      handleSaveVariants(editingVariantRow._rowId, updated);
                    }}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500 text-xs font-bold text-slate-300 hover:text-white transition flex flex-col items-center text-center gap-1"
                  >
                    <span>Prepack (5s)</span>
                    <span className="text-[10px] text-purple-400 font-normal">5 units @ 5% off</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const sell = Number(editingVariantRow.sellingPrice) || 0;
                      const cost = Number(editingVariantRow.costPrice) || 0;
                      const newV: PackagingVariant = {
                        id: `VAR-10PK-${Date.now().toString().slice(-4)}`,
                        name: 'Pack of 10s',
                        unitsPerPack: 10,
                        sellPrice: Number((sell * 10 * 0.90).toFixed(2)),
                        costPrice: Number((cost * 10).toFixed(2)),
                      };
                      const updated = [...(editingVariantRow._parsedVariants || []), newV];
                      handleSaveVariants(editingVariantRow._rowId, updated);
                    }}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500 text-xs font-bold text-slate-300 hover:text-white transition flex flex-col items-center text-center gap-1"
                  >
                    <span>Pack of 10s</span>
                    <span className="text-[10px] text-purple-400 font-normal">10 units @ 10% off</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const sell = Number(editingVariantRow.sellingPrice) || 0;
                      const cost = Number(editingVariantRow.costPrice) || 0;
                      const newV: PackagingVariant = {
                        id: `VAR-2PK-${Date.now().toString().slice(-4)}`,
                        name: 'Double Pack (2s)',
                        unitsPerPack: 2,
                        sellPrice: Number((sell * 2 * 0.98).toFixed(2)),
                        costPrice: Number((cost * 2).toFixed(2)),
                      };
                      const updated = [...(editingVariantRow._parsedVariants || []), newV];
                      handleSaveVariants(editingVariantRow._rowId, updated);
                    }}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500 text-xs font-bold text-slate-300 hover:text-white transition flex flex-col items-center text-center gap-1"
                  >
                    <span>Double Pack (2s)</span>
                    <span className="text-[10px] text-purple-400 font-normal">2 units @ 2% off</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const sell = Number(editingVariantRow.sellingPrice) || 0;
                      const cost = Number(editingVariantRow.costPrice) || 0;
                      const newV: PackagingVariant = {
                        id: `VAR-HALF-${Date.now().toString().slice(-4)}`,
                        name: 'Half Portion (0.5)',
                        unitsPerPack: 0.5,
                        sellPrice: Number((sell * 0.55).toFixed(2)),
                        costPrice: Number((cost * 0.5).toFixed(2)),
                      };
                      const updated = [...(editingVariantRow._parsedVariants || []), newV];
                      handleSaveVariants(editingVariantRow._rowId, updated);
                    }}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500 text-xs font-bold text-slate-300 hover:text-white transition flex flex-col items-center text-center gap-1"
                  >
                    <span>Half Portion</span>
                    <span className="text-[10px] text-purple-400 font-normal">0.5 single unit</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingVariantRow(null)}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer transition shadow-md"
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
