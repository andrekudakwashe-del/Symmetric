import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Play,
  Download,
  Edit3,
  Share2,
  Trash2,
  Shield,
  Search,
  CheckCircle2,
  Sparkles,
  Layers,
  ArrowRight,
  Database,
  BarChart3,
  Table as TableIcon,
} from 'lucide-react';
import { Salesperson, SavedReportTemplate, ReportPermission, RoleId } from '../../types';
import {
  getUserPermittedReports,
  getSavedReportTemplates,
  deleteReportTemplate,
  mapUserRoleToRoleId,
} from '../../db/reportService';
import { executeReportQuery } from '../../db/queryBuilder';
import { ReportPermissionsModal } from './ReportPermissionsModal';
import { ReportChartRenderer } from './ReportChartRenderer';

interface CustomReportsListViewProps {
  currentUser: Salesperson;
  onCreateNewReport: () => void;
  onEditReport: (templateId: string) => void;
  onBack?: () => void;
}

export const CustomReportsListView: React.FC<CustomReportsListViewProps> = ({
  currentUser,
  onCreateNewReport,
  onEditReport,
  onBack,
}) => {
  const [permittedList, setPermittedList] = useState<
    Array<{ template: SavedReportTemplate; permission: ReportPermission }>
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportToShare, setSelectedReportToShare] = useState<SavedReportTemplate | null>(null);

  // Quick Run inline modal/preview
  const [runningReport, setRunningReport] = useState<SavedReportTemplate | null>(null);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewViewType, setPreviewViewType] = useState<'table' | 'bar' | 'pie' | 'line'>('table');

  // Simulated role toggle (to easily test cashier, manager, accountant, super_admin views)
  const [simulatedRole, setSimulatedRole] = useState<RoleId>(() =>
    mapUserRoleToRoleId(currentUser.role)
  );

  const isActualSuperAdmin =
    currentUser.role === 'SUPER_ADMIN' ||
    (currentUser.role as string) === 'super_admin' ||
    currentUser.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const isSuperAdmin = isActualSuperAdmin && simulatedRole === 'super_admin';

  const loadReports = () => {
    const list = getUserPermittedReports(simulatedRole);
    setPermittedList(list);
  };

  useEffect(() => {
    loadReports();
  }, [simulatedRole]);

  // Filter by search query
  const q = (searchQuery || '').trim().toLowerCase();
  const filteredReports = permittedList.filter(
    (item) =>
      !q ||
      (item.template?.name && item.template.name.toLowerCase().includes(q)) ||
      (item.template?.description && item.template.description.toLowerCase().includes(q))
  );

  // Handle Run Report
  const handleRunReport = (template: SavedReportTemplate) => {
    const result = executeReportQuery(template.json_config);
    setPreviewResult(result);
    setPreviewViewType(template.json_config.chart_type || 'table');
    setRunningReport(template);
  };

  // Handle Export CSV
  const handleExportCSV = (template: SavedReportTemplate) => {
    const result = executeReportQuery(template.json_config);
    if (!result || result.rows.length === 0) return;

    const headers = result.headers.map((h) => `"${h.label.replace(/"/g, '""')}"`).join(',');
    const rows = result.rows
      .map((row) =>
        result.headers
          .map((h) => {
            const val = row[h.key] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');

    const csvContent = `data:text/csv;charset=utf-8,${encodeURIComponent(headers + '\n' + rows)}`;
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute(
      'download',
      `${(template.name || 'report').toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Delete Template
  const handleDeleteTemplate = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete report "${name}"?`)) {
      deleteReportTemplate(id);
      loadReports();
      if (runningReport?.id === id) {
        setRunningReport(null);
      }
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-20 animate-in fade-in duration-200">
      {/* Top Banner & Role Testing Switcher */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 via-[#6A4DFF] to-indigo-500 text-white flex items-center justify-center shadow-xl shadow-[#6A4DFF]/30">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-black text-white">Universal No-Code Reports</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/30 flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>ACTIVE</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Super Admin creates ANY report from ANY table without code &bull; Role-enforced access for Cashiers, Managers, and Accountants
            </p>
          </div>
        </div>

        {/* Role Selector & Create Button */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Role Simulation Selector for Testing RBAC (Super Admin Only) */}
          {isActualSuperAdmin && (
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-1.5 flex items-center space-x-1.5">
              <Shield className="w-4 h-4 text-purple-400 ml-2" />
              <span className="text-[11px] font-bold text-slate-400 mr-1">View as:</span>
              {(['super_admin', 'manager', 'accountant', 'cashier'] as RoleId[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSimulatedRole(r)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold font-mono transition ${
                    simulatedRole === r
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* New Report Button (Super Admin) */}
          {isSuperAdmin && (
            <button
              type="button"
              id="btn-create-nocode-report"
              onClick={onCreateNewReport}
              className="px-5 py-2.5 rounded-2xl bg-[#6A4DFF] hover:bg-[#583be8] text-white text-xs font-black flex items-center space-x-2 shadow-xl shadow-[#6A4DFF]/30 transition active:scale-95"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Create New Report</span>
            </button>
          )}

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
            >
              Back
            </button>
          )}
        </div>
      </div>

      {/* Search & Statistics Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search reports by title or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#6A4DFF]"
          />
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <span>
            Authorized Reports: <strong className="text-white">{filteredReports.length}</strong>
          </span>
          <span>&bull;</span>
          <span>
            Current Role: <strong className="text-purple-300 uppercase font-mono">{simulatedRole}</strong>
          </span>
        </div>
      </div>

      {/* Reports Grid */}
      {filteredReports.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-12 text-center space-y-3">
          <FileText className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-300">No Authorized Reports</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {isSuperAdmin
              ? 'No templates have been saved yet. Click "Create New Report" to build one with the 5-step wizard.'
              : `Your role (${simulatedRole}) does not have view permission for any reports. Request access from a Super Admin.`}
          </p>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onCreateNewReport}
              className="mt-2 px-4 py-2 bg-[#6A4DFF] text-white text-xs font-bold rounded-xl shadow-lg"
            >
              Launch 5-Step Wizard
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredReports.map(({ template, permission }) => {
            const cfg = template.json_config;
            const canView = permission.can_view;
            const canEdit = permission.can_edit || isSuperAdmin;
            const canExport = permission.can_export || isSuperAdmin;

            return (
              <div
                key={template.id}
                id={`card-report-${template.id}`}
                className="bg-gradient-to-br from-slate-900/90 via-slate-900 to-slate-950 border border-slate-800 hover:border-slate-700 rounded-3xl p-5 shadow-xl transition space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-base font-black text-white flex items-center gap-2">
                        <span>{template.name}</span>
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-2">
                        {template.description || 'Custom generated dynamic report template.'}
                      </p>
                    </div>

                    <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-slate-800 text-indigo-300 border border-slate-700 uppercase shrink-0">
                      {cfg.chart_type || 'TABLE'}
                    </span>
                  </div>

                  {/* Metadata Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-mono font-bold bg-purple-950/80 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                      Tables: {cfg.tables?.join(', ')}
                    </span>
                    {cfg.group_by && cfg.group_by.length > 0 && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        Grouped by: {cfg.group_by.join(', ')}
                      </span>
                    )}
                    {cfg.aggregates && cfg.aggregates.length > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                        Metrics: {cfg.aggregates.map((a) => a.func).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Permissions & Action Buttons */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5">
                    {/* Run Button (can_view) */}
                    {canView && (
                      <button
                        type="button"
                        id={`btn-run-report-${template.id}`}
                        onClick={() => handleRunReport(template)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1 transition shadow-md shadow-emerald-950/30"
                        title="Run Report"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Run</span>
                      </button>
                    )}

                    {/* Export Button (can_export) */}
                    {canExport && (
                      <button
                        type="button"
                        id={`btn-export-report-${template.id}`}
                        onClick={() => handleExportCSV(template)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center space-x-1 transition border border-slate-700"
                        title="Export to CSV"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Export</span>
                      </button>
                    )}

                    {/* Edit Button (can_edit) */}
                    {canEdit && (
                      <button
                        type="button"
                        id={`btn-edit-report-${template.id}`}
                        onClick={() => onEditReport(template.id)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold text-xs flex items-center space-x-1 transition border border-slate-700"
                        title="Edit in 5-Step Wizard"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>

                  {/* Admin Tools: Share Permissions & Delete */}
                  {isSuperAdmin && (
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        id={`btn-share-report-${template.id}`}
                        onClick={() => setSelectedReportToShare(template)}
                        className="p-1.5 rounded-xl bg-purple-950/60 hover:bg-purple-900 text-purple-300 transition border border-purple-800/60"
                        title="Share Report & Role Permissions"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        id={`btn-delete-report-${template.id}`}
                        onClick={() => handleDeleteTemplate(template.id, template.name)}
                        className="p-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900 text-rose-400 transition border border-rose-900/60"
                        title="Delete Report Template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QUICK PREVIEW DRAWER / MODAL WHEN RUNNING A REPORT */}
      {runningReport && previewResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-black text-white">{runningReport.name}</h3>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {previewResult.totalRows} rows &bull; {previewResult.executionTimeMs}ms
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{runningReport.description}</p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setPreviewViewType('table')}
                className={`p-2 rounded-xl border ${
                  previewViewType === 'table' ? 'bg-[#6A4DFF] text-white border-[#6A4DFF]' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <TableIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewViewType('bar')}
                className={`p-2 rounded-xl border ${
                  previewViewType === 'bar' ? 'bg-[#6A4DFF] text-white border-[#6A4DFF]' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleExportCSV(runningReport)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-bold flex items-center space-x-1.5 border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => setRunningReport(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold"
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Render Chart if bar/pie/line */}
          {previewViewType !== 'table' && (
            <ReportChartRenderer
              chartType={previewViewType}
              data={previewResult.rows}
              xAxisKey={runningReport.json_config.chart_x_axis || previewResult.headers[0]?.key || ''}
              yAxisKey={runningReport.json_config.chart_y_axis || previewResult.headers[1]?.key || previewResult.headers[0]?.key || ''}
              xAxisLabel={previewResult.headers.find((h: any) => h.key === runningReport.json_config.chart_x_axis)?.label}
              yAxisLabel={previewResult.headers.find((h: any) => h.key === runningReport.json_config.chart_y_axis)?.label}
            />
          )}

          {/* Render Table */}
          {previewViewType === 'table' && (
            <div className="overflow-x-auto max-h-[380px] bg-slate-950 rounded-2xl border border-slate-800">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead className="bg-slate-900 sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3 text-slate-500 font-medium text-[10px] w-10 text-center">#</th>
                    {previewResult.headers.map((h: any) => (
                      <th key={h.key} className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap">
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-[11px]">
                  {previewResult.rows.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="py-2 px-3 text-slate-600 text-center">{idx + 1}</td>
                      {previewResult.headers.map((h: any) => {
                        const val = row[h.key];
                        const isNum = typeof val === 'number';
                        const isCurrency = h.label.includes('($)') || h.label.includes('Revenue') || h.label.includes('Price') || h.label.includes('Amount') || h.label.includes('Valuation');

                        return (
                          <td key={h.key} className={`py-2 px-3 whitespace-nowrap ${isNum ? 'text-emerald-300 text-right' : 'text-slate-200'}`}>
                            {val === null || val === undefined
                              ? '-'
                              : isCurrency && isNum
                              ? `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : isNum
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
      )}

      {/* SHARE / REPORT PERMISSIONS MODAL */}
      <ReportPermissionsModal
        isOpen={selectedReportToShare !== null}
        onClose={() => setSelectedReportToShare(null)}
        report={selectedReportToShare}
        onPermissionsUpdated={loadReports}
      />
    </div>
  );
};
