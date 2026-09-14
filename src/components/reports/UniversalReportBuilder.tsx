import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Columns,
  GitMerge,
  Filter,
  BarChart3,
  Play,
  Save,
  Share2,
  Download,
  Printer,
  Plus,
  Trash2,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Code2,
  Table as TableIcon,
  PieChart as PieIcon,
  LineChart as LineIcon,
  Search,
  Sparkles,
  ArrowUpDown,
  Calendar,
  Layers,
} from 'lucide-react';
import {
  DataDictionaryItem,
  TableRelationship,
  ReportJsonConfig,
  ReportFilter,
  ReportAggregate,
  ReportJoin,
  ReportSort,
  FilterOperator,
  AggregateFunc,
  ReportExecutionResult,
  Salesperson,
  SavedReportTemplate,
} from '../../types';
import {
  getDataDictionary,
  getTableRelationships,
  addDataDictionaryColumn,
  saveReportTemplate,
  getSavedReportTemplateById,
  mapUserRoleToRoleId,
} from '../../db/reportService';
import { buildSafeSql, executeReportQuery } from '../../db/queryBuilder';
import { ReportChartRenderer } from './ReportChartRenderer';
import { ReportPermissionsModal } from './ReportPermissionsModal';

interface UniversalReportBuilderProps {
  currentUser: Salesperson;
  initialTemplateId?: string | null;
  onClose?: () => void;
  onSaved?: (template: SavedReportTemplate) => void;
}

export const UniversalReportBuilder: React.FC<UniversalReportBuilderProps> = ({
  currentUser,
  initialTemplateId,
  onClose,
  onSaved,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Data Dictionary & Relationships state
  const [dataDictionary, setDataDictionary] = useState<DataDictionaryItem[]>([]);
  const [relationships, setRelationships] = useState<TableRelationship[]>([]);

  // Config State
  const [reportName, setReportName] = useState<string>('Custom Untitled Report');
  const [reportDescription, setReportDescription] = useState<string>('');
  const [selectedTables, setSelectedTables] = useState<string[]>(['sales']);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [activeJoins, setActiveJoins] = useState<ReportJoin[]>([]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [aggregates, setAggregates] = useState<ReportAggregate[]>([]);
  const [sortBy, setSortBy] = useState<ReportSort[]>([]);
  const [chartType, setChartType] = useState<'table' | 'bar' | 'pie' | 'line'>('table');
  const [chartXAxis, setChartXAxis] = useState<string>('');
  const [chartYAxis, setChartYAxis] = useState<string>('');
  const [queryLimit, setQueryLimit] = useState<number>(500);

  // Execution & UI state
  const [queryResult, setQueryResult] = useState<ReportExecutionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeSavedTemplate, setActiveSavedTemplate] = useState<SavedReportTemplate | null>(null);

  // New Column/Table Modal state (Part 4 Rule 5: ADD NEW TABLE LATER without code change)
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [newTableInput, setNewTableInput] = useState('');
  const [newColumnInput, setNewColumnInput] = useState('');
  const [newDisplayNameInput, setNewDisplayNameInput] = useState('');
  const [newTypeInput, setNewTypeInput] = useState<'string' | 'number' | 'date' | 'boolean'>('string');
  const [newIsFilterable, setNewIsFilterable] = useState(true);
  const [newIsGroupable, setNewIsGroupable] = useState(true);

  // Load Data Dictionary & Relationships
  useEffect(() => {
    setDataDictionary(getDataDictionary());
    setRelationships(getTableRelationships());
  }, []);

  // If initialTemplateId provided, load it
  useEffect(() => {
    if (!initialTemplateId) return;
    const template = getSavedReportTemplateById(initialTemplateId);
    if (template) {
      setActiveSavedTemplate(template);
      setReportName(template.name);
      setReportDescription(template.description || '');
      const cfg = template.json_config;
      setSelectedTables(cfg.tables || ['sales']);
      setSelectedColumns(cfg.columns || []);
      setActiveJoins(cfg.joins || []);
      setFilters(cfg.filters || []);
      setGroupByColumns(cfg.group_by || []);
      setAggregates(cfg.aggregates || []);
      setSortBy(cfg.sort_by || []);
      setChartType(cfg.chart_type || 'table');
      setChartXAxis(cfg.chart_x_axis || '');
      setChartYAxis(cfg.chart_y_axis || '');
      setQueryLimit(cfg.limit || 500);
      setCurrentStep(5); // jump straight to results/visualization
    }
  }, [initialTemplateId]);

  // Unique table list from data dictionary
  const availableTables = useMemo(() => {
    const set = new Set<string>();
    dataDictionary.forEach((item) => set.add(item.table_name));
    return Array.from(set);
  }, [dataDictionary]);

  // Columns available for selected tables
  const availableColumns = useMemo(() => {
    return dataDictionary.filter((item) => selectedTables.includes(item.table_name));
  }, [dataDictionary, selectedTables]);

  // Filtered columns by search input
  const filteredAvailableColumns = useMemo(() => {
    const query = (columnSearch || '').trim().toLowerCase();
    if (!query) return availableColumns;
    return availableColumns.filter(
      (c) =>
        (c.display_name && c.display_name.toLowerCase().includes(query)) ||
        (c.column_name && c.column_name.toLowerCase().includes(query)) ||
        (c.table_name && c.table_name.toLowerCase().includes(query))
    );
  }, [availableColumns, columnSearch]);

  // Auto-suggested joins for selected tables
  const suggestedJoins = useMemo(() => {
    if (selectedTables.length <= 1) return [];
    return relationships.filter((rel) => {
      const hasFrom = selectedTables.includes(rel.from_table);
      const hasTo = selectedTables.includes(rel.to_table);
      return hasFrom && hasTo;
    });
  }, [relationships, selectedTables]);

  // Auto-enable suggested joins when new tables are picked
  useEffect(() => {
    if (suggestedJoins.length > 0) {
      const newJoins: ReportJoin[] = suggestedJoins.map((s) => ({
        from: `${s.from_table}.${s.from_column}`,
        to: `${s.to_table}.${s.to_column}`,
        type: 'INNER',
      }));

      // Merge avoiding duplicates
      setActiveJoins((prev) => {
        const merged = [...prev];
        newJoins.forEach((nj) => {
          const exists = merged.some((m) => m.from === nj.from && m.to === nj.to);
          if (!exists) merged.push(nj);
        });
        return merged;
      });
    }
  }, [suggestedJoins]);

  // Build current JSON config
  const currentJsonConfig = useMemo<ReportJsonConfig>(() => {
    return {
      name: reportName,
      description: reportDescription,
      tables: selectedTables,
      joins: activeJoins,
      columns: selectedColumns,
      group_by: groupByColumns.length > 0 ? groupByColumns : undefined,
      aggregates: aggregates.length > 0 ? aggregates : undefined,
      filters,
      sort_by: sortBy.length > 0 ? sortBy : undefined,
      limit: queryLimit,
      chart_type: chartType,
      chart_x_axis: chartXAxis,
      chart_y_axis: chartYAxis,
    };
  }, [
    reportName,
    reportDescription,
    selectedTables,
    activeJoins,
    selectedColumns,
    groupByColumns,
    aggregates,
    filters,
    sortBy,
    queryLimit,
    chartType,
    chartXAxis,
    chartYAxis,
  ]);

  // Compiled SQL preview
  const safeSql = useMemo(() => {
    try {
      return buildSafeSql(currentJsonConfig);
    } catch {
      return { sql: '-- Invalid config', bindArgs: [] };
    }
  }, [currentJsonConfig]);

  // Run Query
  const handleRunQuery = () => {
    setIsRunning(true);
    setTimeout(() => {
      try {
        const result = executeReportQuery(currentJsonConfig);
        setQueryResult(result);

        // Auto-select chart axis if not selected
        if (!chartXAxis && result.headers.length > 0) {
          setChartXAxis(result.headers[0].key);
        }
        if (!chartYAxis && result.headers.length > 1) {
          const numCol = result.headers.find((h) => h.type === 'number');
          setChartYAxis(numCol ? numCol.key : result.headers[1].key);
        }
      } catch (err) {
        console.error('Report execution failed:', err);
      } finally {
        setIsRunning(false);
      }
    }, 50);
  };

  // Run on reaching step 5 automatically
  useEffect(() => {
    if (currentStep === 5) {
      handleRunQuery();
    }
  }, [currentStep]);

  // Step 1: Toggle Table Selection
  const toggleTable = (tableName: string) => {
    if (selectedTables.includes(tableName)) {
      if (selectedTables.length === 1) return; // Keep at least one table
      setSelectedTables(selectedTables.filter((t) => t !== tableName));
      // Remove columns belonging to that table
      setSelectedColumns(selectedColumns.filter((c) => !c.startsWith(`${tableName}.`)));
      // Remove joins involving that table
      setActiveJoins(
        activeJoins.filter((j) => !j.from.startsWith(`${tableName}.`) && !j.to.startsWith(`${tableName}.`))
      );
    } else {
      setSelectedTables([...selectedTables, tableName]);
    }
  };

  // Step 2: Toggle Column Selection
  const toggleColumn = (colKey: string) => {
    if (selectedColumns.includes(colKey)) {
      setSelectedColumns(selectedColumns.filter((c) => c !== colKey));
    } else {
      setSelectedColumns([...selectedColumns, colKey]);
    }
  };

  const selectAllFilteredColumns = () => {
    const keysToAdd = filteredAvailableColumns.map((c) => `${c.table_name}.${c.column_name}`);
    const unique = Array.from(new Set([...selectedColumns, ...keysToAdd]));
    setSelectedColumns(unique);
  };

  const deselectAllFilteredColumns = () => {
    const keysToRemove = new Set(filteredAvailableColumns.map((c) => `${c.table_name}.${c.column_name}`));
    setSelectedColumns(selectedColumns.filter((c) => !keysToRemove.has(c)));
  };

  // Step 3: Toggle Join
  const toggleJoin = (from: string, to: string) => {
    const exists = activeJoins.some((j) => j.from === from && j.to === to);
    if (exists) {
      setActiveJoins(activeJoins.filter((j) => !(j.from === from && j.to === to)));
    } else {
      setActiveJoins([...activeJoins, { from, to, type: 'INNER' }]);
    }
  };

  // Step 4: Add Filter
  const addFilter = () => {
    const firstCol = availableColumns[0];
    if (!firstCol) return;
    const newF: ReportFilter = {
      id: `f-${Date.now()}`,
      column: `${firstCol.table_name}.${firstCol.column_name}`,
      op: firstCol.data_type === 'date' ? 'last_30_days' : 'equals',
      value: '',
    };
    setFilters([...filters, newF]);
  };

  const removeFilter = (id: string) => {
    setFilters(filters.filter((f) => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<ReportFilter>) => {
    setFilters(filters.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  // Step 4: Toggle GroupBy
  const toggleGroupBy = (colKey: string) => {
    if (groupByColumns.includes(colKey)) {
      setGroupByColumns(groupByColumns.filter((c) => c !== colKey));
    } else {
      setGroupByColumns([...groupByColumns, colKey]);
    }
  };

  // Step 5: Add Aggregate
  const addAggregate = () => {
    const numCol = availableColumns.find((c) => c.data_type === 'number') || availableColumns[0];
    if (!numCol) return;
    const newAgg: ReportAggregate = {
      column: `${numCol.table_name}.${numCol.column_name}`,
      func: numCol.data_type === 'number' ? 'SUM' : 'COUNT',
      alias: `${numCol.data_type === 'number' ? 'SUM' : 'COUNT'} of ${numCol.display_name}`,
    };
    setAggregates([...aggregates, newAgg]);
  };

  const removeAggregate = (index: number) => {
    setAggregates(aggregates.filter((_, i) => i !== index));
  };

  const updateAggregate = (index: number, updates: Partial<ReportAggregate>) => {
    setAggregates(aggregates.map((agg, i) => (i === index ? { ...agg, ...updates } : agg)));
  };

  // Save Template Action
  const handleSaveTemplateSubmit = () => {
    if (!reportName.trim()) return;

    const saved = saveReportTemplate({
      id: activeSavedTemplate?.id,
      name: reportName.trim(),
      description: reportDescription.trim(),
      json_config: currentJsonConfig,
      created_by: `${currentUser.name} (${currentUser.id})`,
    });

    setActiveSavedTemplate(saved);
    setShowSaveModal(false);
    if (onSaved) onSaved(saved);
  };

  // Export CSV Action
  const handleExportCSV = () => {
    if (!queryResult || queryResult.rows.length === 0) return;

    const headers = queryResult.headers.map((h) => `"${h.label.replace(/"/g, '""')}"`).join(',');
    const rows = queryResult.rows
      .map((row) => {
        return queryResult.headers
          .map((h) => {
            const val = row[h.key] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(',');
      })
      .join('\n');

    const csvContent = `data:text/csv;charset=utf-8,${encodeURIComponent(headers + '\n' + rows)}`;
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `${(reportName || 'report').toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print Report Action
  const handlePrint = () => {
    window.print();
  };

  // Handle Add Column / Dynamic Table to Data Dictionary (Part 4 Rule 5)
  const handleAddDataDictionaryColumnSubmit = () => {
    if (!newTableInput.trim() || !newColumnInput.trim() || !newDisplayNameInput.trim()) return;
    const added = addDataDictionaryColumn({
      table_name: newTableInput.trim().toLowerCase(),
      column_name: newColumnInput.trim().toLowerCase(),
      display_name: newDisplayNameInput.trim(),
      data_type: newTypeInput,
      is_filterable: newIsFilterable,
      is_groupable: newIsGroupable,
    });
    setDataDictionary((prev) => [...prev, added]);
    if (!selectedTables.includes(added.table_name)) {
      setSelectedTables((prev) => [...prev, added.table_name]);
    }
    setShowAddColumnModal(false);
    setNewColumnInput('');
    setNewDisplayNameInput('');
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-16 animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-[#6A4DFF]/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-black text-white">{reportName}</h1>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-mono font-bold border border-purple-500/30">
                NO-CODE ENGINE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Universal Room DB Report Builder &bull; Data Dictionary Driven &bull; Dynamic SQL
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            id="btn-report-view-sql"
            onClick={() => setShowSqlModal(true)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
          >
            <Code2 className="w-4 h-4 text-indigo-400" />
            <span>Room @RawQuery</span>
          </button>

          <button
            type="button"
            id="btn-report-run-now"
            onClick={handleRunQuery}
            disabled={isRunning}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-emerald-950/40 transition"
          >
            <Play className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
            <span>{isRunning ? 'Running...' : 'Run Query'}</span>
          </button>

          <button
            type="button"
            id="btn-report-save-template"
            onClick={() => setShowSaveModal(true)}
            className="px-4 py-2 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-[#6A4DFF]/30 transition"
          >
            <Save className="w-4 h-4" />
            <span>Save Template</span>
          </button>

          {activeSavedTemplate && (
            <button
              type="button"
              id="btn-report-share-roles"
              onClick={() => setShowShareModal(true)}
              className="px-3.5 py-2 rounded-xl bg-purple-900/60 hover:bg-purple-800 text-purple-200 text-xs font-bold flex items-center space-x-1.5 transition border border-purple-500/40"
            >
              <Share2 className="w-4 h-4 text-purple-300" />
              <span>Share &amp; Permissions</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-bold transition"
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {/* 5-Step Wizard Progress Bar */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-3 shadow-lg flex items-center justify-between overflow-x-auto gap-2">
        {[
          { step: 1, label: '1. Pick Data Source', icon: Database },
          { step: 2, label: '2. Pick Columns', icon: Columns },
          { step: 3, label: '3. Join Data', icon: GitMerge },
          { step: 4, label: '4. Filter & Sort', icon: Filter },
          { step: 5, label: '5. Aggregate & View', icon: BarChart3 },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = currentStep === item.step;
          const isDone = currentStep > item.step;
          return (
            <button
              key={item.step}
              type="button"
              onClick={() => setCurrentStep(item.step as any)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                isActive
                  ? 'bg-[#6A4DFF] text-white shadow-lg shadow-[#6A4DFF]/30'
                  : isDone
                  ? 'bg-slate-800/80 text-emerald-400 hover:bg-slate-800'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : isDone ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
              {isDone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* STEP 1: PICK DATA SOURCE */}
      {/* ==================================================================== */}
      {currentStep === 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-black text-white flex items-center space-x-2">
                <Database className="w-5 h-5 text-[#6A4DFF]" />
                <span>Step 1: Pick Data Source Tables</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Select the primary and secondary tables from the Room Data Dictionary.
              </p>
            </div>

            {/* Part 4 Rule 5: Add new table/column dynamically */}
            <button
              type="button"
              id="btn-add-custom-table"
              onClick={() => setShowAddColumnModal(true)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Add Table to Data Dictionary</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {availableTables.map((tbl) => {
              const isSelected = selectedTables.includes(tbl);
              const columnCount = dataDictionary.filter((d) => d.table_name === tbl).length;

              return (
                <div
                  key={tbl}
                  onClick={() => toggleTable(tbl)}
                  className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between space-y-3 ${
                    isSelected
                      ? 'bg-purple-950/40 border-[#6A4DFF] shadow-lg shadow-purple-950/20'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white uppercase tracking-wide">
                      {tbl}
                    </span>
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border transition ${
                        isSelected
                          ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                          : 'border-slate-700 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>{columnCount} columns defined</span>
                    {tbl === selectedTables[0] && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-300 font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-800">
                        PRIMARY
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <span className="text-xs text-slate-400">
              Selected: <strong className="text-white">{selectedTables.length} tables</strong>
            </span>
            <button
              type="button"
              id="btn-step1-next"
              onClick={() => setCurrentStep(2)}
              className="px-5 py-2.5 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-[#6A4DFF]/30 transition"
            >
              <span>Next: Pick Columns</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 2: PICK COLUMNS */}
      {/* ==================================================================== */}
      {currentStep === 2 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-black text-white flex items-center space-x-2">
                <Columns className="w-5 h-5 text-[#6A4DFF]" />
                <span>Step 2: Pick Columns to Project</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Choose the fields to display. Non-coded display names are retrieved from data_dictionary.
              </p>
            </div>

            {/* Quick Actions & Search */}
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter columns..."
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#6A4DFF] w-48"
                />
              </div>
              <button
                type="button"
                onClick={selectAllFilteredColumns}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={deselectAllFilteredColumns}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold transition"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Columns Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredAvailableColumns.map((col) => {
              const colKey = `${col.table_name}.${col.column_name}`;
              const isSelected = selectedColumns.includes(colKey);

              return (
                <div
                  key={colKey}
                  onClick={() => toggleColumn(colKey)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-start justify-between space-x-2 ${
                    isSelected
                      ? 'bg-purple-950/40 border-[#6A4DFF]'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-200 block">
                      {col.display_name}
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/60">
                        {col.table_name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {col.data_type}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-5 h-5 rounded-lg flex items-center justify-center border shrink-0 transition ${
                      isSelected
                        ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                        : 'border-slate-700 text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center space-x-2 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <div className="text-xs text-slate-400">
              Selected: <strong className="text-white">{selectedColumns.length} columns</strong>
            </div>
            <button
              type="button"
              id="btn-step2-next"
              onClick={() => setCurrentStep(3)}
              className="px-5 py-2.5 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-[#6A4DFF]/30 transition"
            >
              <span>Next: Join Data</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 3: JOIN DATA */}
      {/* ==================================================================== */}
      {currentStep === 3 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h2 className="text-base font-black text-white flex items-center space-x-2">
              <GitMerge className="w-5 h-5 text-[#6A4DFF]" />
              <span>Step 3: Join Data (Auto-suggested from table_relationships)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Table relationships are auto-scanned to link your tables without writing manual SQL.
            </p>
          </div>

          {suggestedJoins.length === 0 && selectedTables.length > 1 ? (
            <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-amber-200 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                No predefined join found between the selected tables in `table_relationships`. You can add custom joins or cross-reference.
              </span>
            </div>
          ) : selectedTables.length === 1 ? (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-slate-400 text-xs">
              Single table selected (<strong className="text-white">{selectedTables[0]}</strong>). No joins are required.
            </div>
          ) : (
            <div className="space-y-3">
              {suggestedJoins.map((s) => {
                const fromKey = `${s.from_table}.${s.from_column}`;
                const toKey = `${s.to_table}.${s.to_column}`;
                const isEnabled = activeJoins.some((j) => j.from === fromKey && j.to === toKey);

                return (
                  <div
                    key={s.id}
                    className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                        <span className="font-mono text-purple-300">{s.from_table}.{s.from_column}</span>
                        <span className="text-slate-500">&rarr;</span>
                        <span className="font-mono text-indigo-300">{s.to_table}.{s.to_column}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">{s.relationship_name}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleJoin(fromKey, toKey)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                        isEnabled
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                      }`}
                    >
                      {isEnabled ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Join Active</span>
                        </>
                      ) : (
                        <span>Enable Join</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center space-x-2 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              type="button"
              id="btn-step3-next"
              onClick={() => setCurrentStep(4)}
              className="px-5 py-2.5 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-[#6A4DFF]/30 transition"
            >
              <span>Next: Filter, Group &amp; Sort</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 4: FILTER + GROUP + SORT */}
      {/* ==================================================================== */}
      {currentStep === 4 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h2 className="text-base font-black text-white flex items-center space-x-2">
              <Filter className="w-5 h-5 text-[#6A4DFF]" />
              <span>Step 4: Filters, Group By, and Sorting</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Add criteria filters (e.g. last 30 days, category equals), group by columns, and sort results.
            </p>
          </div>

          {/* 1. FILTERS SECTION */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span>Filters</span>
              </span>
              <button
                type="button"
                id="btn-add-filter"
                onClick={addFilter}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-bold flex items-center space-x-1 transition border border-slate-700"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Filter</span>
              </button>
            </div>

            {filters.length === 0 ? (
              <div className="p-4 bg-slate-950/50 border border-slate-800/80 rounded-2xl text-slate-500 text-xs italic">
                No filters applied. All rows within limits will be processed.
              </div>
            ) : (
              <div className="space-y-2">
                {filters.map((f) => (
                  <div
                    key={f.id}
                    className="p-3 bg-slate-950 border border-slate-800 rounded-2xl flex flex-wrap items-center gap-2"
                  >
                    {/* Column */}
                    <select
                      value={f.column}
                      onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                    >
                      {availableColumns.map((col) => (
                        <option key={`${col.table_name}.${col.column_name}`} value={`${col.table_name}.${col.column_name}`}>
                          {col.display_name} ({col.table_name})
                        </option>
                      ))}
                    </select>

                    {/* Operator */}
                    <select
                      value={f.op}
                      onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOperator })}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                    >
                      <option value="equals">Equals (=)</option>
                      <option value="not_equals">Not Equals (!=)</option>
                      <option value="contains">Contains (LIKE)</option>
                      <option value="gt">Greater Than (&gt;)</option>
                      <option value="lt">Less Than (&lt;)</option>
                      <option value="gte">Greater or Equal (&gt;=)</option>
                      <option value="lte">Less or Equal (&lt;=)</option>
                      <option value="last_7_days">Last 7 Days</option>
                      <option value="last_30_days">Last 30 Days</option>
                      <option value="this_month">This Month</option>
                      <option value="between">Between Range</option>
                    </select>

                    {/* Value Input (unless relative date) */}
                    {!['last_7_days', 'last_30_days', 'this_month'].includes(f.op) && (
                      <input
                        type="text"
                        placeholder="Value..."
                        value={f.value || ''}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#6A4DFF] flex-1 min-w-[120px]"
                      />
                    )}

                    {f.op === 'between' && (
                      <input
                        type="text"
                        placeholder="Value 2..."
                        value={f.value2 || ''}
                        onChange={(e) => updateFilter(f.id, { value2: e.target.value2 })}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#6A4DFF] flex-1 min-w-[120px]"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => removeFilter(f.id)}
                      className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 text-rose-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. GROUP BY SECTION */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Group By Dimensions</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {availableColumns
                .filter((c) => c.is_groupable)
                .map((col) => {
                  const colKey = `${col.table_name}.${col.column_name}`;
                  const isGrouped = groupByColumns.includes(colKey);

                  return (
                    <button
                      key={colKey}
                      type="button"
                      onClick={() => toggleGroupBy(colKey)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 border ${
                        isGrouped
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span>{col.display_name}</span>
                      {isGrouped && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* 3. SORT BY SECTION */}
          <div className="space-y-3 pt-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpDown className="w-4 h-4 text-amber-400" />
              <span>Sort Order</span>
            </span>
            <div className="flex items-center space-x-2">
              <select
                value={sortBy[0]?.column || ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setSortBy([]);
                  } else {
                    setSortBy([{ column: e.target.value, direction: sortBy[0]?.direction || 'DESC' }]);
                  }
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
              >
                <option value="">No Sorting</option>
                {availableColumns.map((col) => (
                  <option key={`${col.table_name}.${col.column_name}`} value={`${col.table_name}.${col.column_name}`}>
                    {col.display_name} ({col.table_name})
                  </option>
                ))}
              </select>

              {sortBy.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSortBy([
                      {
                        column: sortBy[0].column,
                        direction: sortBy[0].direction === 'ASC' ? 'DESC' : 'ASC',
                      },
                    ])
                  }
                  className="px-3 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold font-mono"
                >
                  {sortBy[0].direction}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center space-x-2 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              type="button"
              id="btn-step4-next"
              onClick={() => setCurrentStep(5)}
              className="px-5 py-2.5 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-[#6A4DFF]/30 transition"
            >
              <span>Next: Aggregations &amp; Output</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 5: AGGREGATE & OUTPUT */}
      {/* ==================================================================== */}
      {currentStep === 5 && (
        <div className="space-y-5">
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              {/* Aggregates builder */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Calculated Metrics &amp; Aggregates (Sum, Count, Avg, Min, Max)
                  </span>
                  <button
                    type="button"
                    onClick={addAggregate}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-bold flex items-center space-x-1 border border-slate-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Metric</span>
                  </button>
                </div>

                {aggregates.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {aggregates.map((agg, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex items-center space-x-2 text-xs"
                      >
                        <select
                          value={agg.func}
                          onChange={(e) => updateAggregate(idx, { func: e.target.value as AggregateFunc })}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-purple-300 font-bold font-mono focus:outline-none"
                        >
                          <option value="SUM">SUM</option>
                          <option value="COUNT">COUNT</option>
                          <option value="AVG">AVG</option>
                          <option value="MIN">MIN</option>
                          <option value="MAX">MAX</option>
                        </select>

                        <select
                          value={agg.column}
                          onChange={(e) => updateAggregate(idx, { column: e.target.value })}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 focus:outline-none"
                        >
                          {availableColumns.map((col) => (
                            <option key={`${col.table_name}.${col.column_name}`} value={`${col.table_name}.${col.column_name}`}>
                              {col.display_name}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          placeholder="Alias label..."
                          value={agg.alias || ''}
                          onChange={(e) => updateAggregate(idx, { alias: e.target.value })}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 placeholder-slate-500 w-32 focus:outline-none"
                        />

                        <button
                          type="button"
                          onClick={() => removeAggregate(idx)}
                          className="text-rose-400 hover:text-rose-300 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* View Selector (Table / Bar / Pie / Line) */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-400 mr-1">Display:</span>
                <button
                  type="button"
                  onClick={() => setChartType('table')}
                  className={`p-2 rounded-xl border transition ${
                    chartType === 'table'
                      ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Data Table View"
                >
                  <TableIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('bar')}
                  className={`p-2 rounded-xl border transition ${
                    chartType === 'bar'
                      ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Bar Chart View"
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('pie')}
                  className={`p-2 rounded-xl border transition ${
                    chartType === 'pie'
                      ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Pie Chart View"
                >
                  <PieIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('line')}
                  className={`p-2 rounded-xl border transition ${
                    chartType === 'line'
                      ? 'bg-[#6A4DFF] border-[#6A4DFF] text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Line Chart View"
                >
                  <LineIcon className="w-4 h-4" />
                </button>

                <div className="h-6 w-px bg-slate-800 mx-1" />

                <button
                  type="button"
                  id="btn-export-csv"
                  onClick={handleExportCSV}
                  disabled={!queryResult || queryResult.rows.length === 0}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <Download className="w-4 h-4" />
                  <span>CSV</span>
                </button>

                <button
                  type="button"
                  id="btn-print-report"
                  onClick={handlePrint}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            {/* If chart selected, Axis mapping options */}
            {chartType !== 'table' && queryResult && queryResult.headers.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-950/70 p-3 rounded-2xl border border-slate-800">
                <span className="font-bold text-slate-400">Chart Axis Config:</span>
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-500">X-Axis Dimension:</span>
                  <select
                    value={chartXAxis}
                    onChange={(e) => setChartXAxis(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200"
                  >
                    {queryResult.headers.map((h) => (
                      <option key={h.key} value={h.key}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-500">Y-Axis Metric:</span>
                  <select
                    value={chartYAxis}
                    onChange={(e) => setChartYAxis(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200"
                  >
                    {queryResult.headers.map((h) => (
                      <option key={h.key} value={h.key}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Performance warning if dataset was limited */}
            {queryResult?.warning && (
              <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-600/50 text-amber-200 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{queryResult.warning}</span>
              </div>
            )}
          </div>

          {/* Chart Display */}
          {chartType !== 'table' && queryResult && (
            <ReportChartRenderer
              chartType={chartType}
              data={queryResult.rows}
              xAxisKey={chartXAxis || queryResult.headers[0]?.key || ''}
              yAxisKey={chartYAxis || queryResult.headers[1]?.key || queryResult.headers[0]?.key || ''}
              xAxisLabel={queryResult.headers.find((h) => h.key === chartXAxis)?.label}
              yAxisLabel={queryResult.headers.find((h) => h.key === chartYAxis)?.label}
            />
          )}

          {/* Table Results Display */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-200">
                <TableIcon className="w-4 h-4 text-purple-400" />
                <span>Query Output Table</span>
              </div>
              <div className="flex items-center space-x-3 text-xs text-slate-400">
                <span>
                  Rows: <strong className="text-white">{queryResult?.totalRows || 0}</strong>
                </span>
                <span>&bull;</span>
                <span>
                  Execution: <strong className="text-emerald-400">{queryResult?.executionTimeMs || 0}ms</strong>
                </span>
              </div>
            </div>

            {!queryResult || queryResult.rows.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs italic">
                No matching records returned. Try adjusting filters or table joins.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 text-slate-500 font-mono font-medium text-[10px] w-12 text-center">
                        #
                      </th>
                      {queryResult.headers.map((h) => (
                        <th key={h.key} className="py-2.5 px-4 font-bold text-slate-300 whitespace-nowrap">
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {queryResult.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-4 text-slate-600 text-center">{rIdx + 1}</td>
                        {queryResult.headers.map((h) => {
                          const val = row[h.key];
                          const isNumeric = typeof val === 'number';
                          const isCurrency = h.label.includes('($)') || h.label.includes('Revenue') || h.label.includes('Price') || h.label.includes('Amount') || h.label.includes('Valuation');

                          return (
                            <td
                              key={h.key}
                              className={`py-2.5 px-4 whitespace-nowrap ${
                                isNumeric ? 'text-emerald-300 text-right' : 'text-slate-200'
                              }`}
                            >
                              {val === null || val === undefined
                                ? '-'
                                : isCurrency && isNumeric
                                ? `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : isNumeric
                                ? val.toLocaleString()
                                : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: VIEW COMPILED ROOM @RAWQUERY SQL */}
      {/* ==================================================================== */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Code2 className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-black text-white">
                  Room @RawQuery &amp; Parameterized SQL
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Security Rule 2 enforced: Safe parameterized SQL with bind arguments. Protects against SQL injection in Room SQLite.
            </p>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs text-emerald-400 whitespace-pre overflow-x-auto">
              {safeSql.sql}
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 font-mono block">
                Bind Arguments (Room SupportSQLiteQuery.bindArgs):
              </span>
              <div className="font-mono text-xs text-indigo-300">
                {safeSql.bindArgs.length > 0 ? JSON.stringify(safeSql.bindArgs, null, 2) : '[] (No runtime parameters)'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: SAVE REPORT TEMPLATE */}
      {/* ==================================================================== */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-2">
              <Save className="w-5 h-5 text-[#6A4DFF]" />
              <h3 className="text-base font-black text-white">Save Report Template</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Report Name</label>
                <input
                  type="text"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="e.g. Sales by Supplier"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description</label>
                <textarea
                  rows={3}
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder="Brief explanation of what this report analyzes..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-save-template"
                onClick={handleSaveTemplateSubmit}
                className="px-5 py-2 rounded-xl bg-[#6A4DFF] hover:bg-[#583be8] text-white text-xs font-bold shadow-lg shadow-[#6A4DFF]/30"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: SHARE REPORT & ROLE PERMISSIONS */}
      {/* ==================================================================== */}
      <ReportPermissionsModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        report={activeSavedTemplate}
      />

      {/* ==================================================================== */}
      {/* MODAL: ADD DYNAMIC TABLE/COLUMN TO DATA DICTIONARY (PART 4 RULE 5) */}
      {/* ==================================================================== */}
      {showAddColumnModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-black text-white">
                Add Table / Column to Data Dictionary
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Extend the system dynamically: Adding new tables and columns to `data_dictionary` immediately exposes them to the No-Code builder without modifying application source code.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Table Name</label>
                <input
                  type="text"
                  value={newTableInput}
                  onChange={(e) => setNewTableInput(e.target.value)}
                  placeholder="e.g. deliveries or marketing"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Column Name</label>
                <input
                  type="text"
                  value={newColumnInput}
                  onChange={(e) => setNewColumnInput(e.target.value)}
                  placeholder="e.g. channel or tracking_no"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Display Label</label>
                <input
                  type="text"
                  value={newDisplayNameInput}
                  onChange={(e) => setNewDisplayNameInput(e.target.value)}
                  placeholder="e.g. Marketing Channel"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Data Type</label>
                <select
                  value={newTypeInput}
                  onChange={(e) => setNewTypeInput(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#6A4DFF]"
                >
                  <option value="string">string (Text)</option>
                  <option value="number">number (Numeric / Currency)</option>
                  <option value="date">date (Timestamp / Calendar)</option>
                  <option value="boolean">boolean (True / False)</option>
                </select>
              </div>

              <div className="flex items-center space-x-6 pt-1">
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsFilterable}
                    onChange={(e) => setNewIsFilterable(e.target.checked)}
                    className="rounded text-[#6A4DFF]"
                  />
                  <span>Is Filterable</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsGroupable}
                    onChange={(e) => setNewIsGroupable(e.target.checked)}
                    className="rounded text-[#6A4DFF]"
                  />
                  <span>Is Groupable</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddColumnModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-add-column"
                onClick={handleAddDataDictionaryColumnSubmit}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Add Column
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
