import {
  DataDictionaryItem,
  TableRelationship,
  UserRole,
  SavedReportTemplate,
  ReportPermission,
  RoleId,
  Role,
} from '../types';
import {
  INITIAL_DATA_DICTIONARY,
  INITIAL_TABLE_RELATIONSHIPS,
  INITIAL_USER_ROLES,
  INITIAL_REPORT_TEMPLATES,
  INITIAL_REPORT_PERMISSIONS,
} from './dataDictionary';

const STORAGE_KEYS = {
  DATA_DICTIONARY: 'saimetric_room_data_dictionary',
  TABLE_RELATIONSHIPS: 'saimetric_room_table_relationships',
  USER_ROLES: 'saimetric_room_user_roles',
  REPORT_TEMPLATES: 'saimetric_room_saved_report_templates',
  REPORT_PERMISSIONS: 'saimetric_room_report_permissions',
};

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Failed to store key:', key, err);
  }
}

// Map Salesperson Role to RoleId
export function mapUserRoleToRoleId(role: Role | string): RoleId {
  const normalized = (role || '').toLowerCase();
  if (normalized.includes('admin')) return 'super_admin';
  if (normalized.includes('manager')) return 'manager';
  if (normalized.includes('cashier')) return 'cashier';
  if (normalized.includes('accountant')) return 'accountant';
  return 'super_admin'; // Default fallback
}

// Initialize tables in Room DB
export function initializeReportModule(): void {
  if (!localStorage.getItem(STORAGE_KEYS.DATA_DICTIONARY)) {
    setStored(STORAGE_KEYS.DATA_DICTIONARY, INITIAL_DATA_DICTIONARY);
  }
  if (!localStorage.getItem(STORAGE_KEYS.TABLE_RELATIONSHIPS)) {
    setStored(STORAGE_KEYS.TABLE_RELATIONSHIPS, INITIAL_TABLE_RELATIONSHIPS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.USER_ROLES)) {
    setStored(STORAGE_KEYS.USER_ROLES, INITIAL_USER_ROLES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.REPORT_TEMPLATES)) {
    setStored(STORAGE_KEYS.REPORT_TEMPLATES, INITIAL_REPORT_TEMPLATES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.REPORT_PERMISSIONS)) {
    setStored(STORAGE_KEYS.REPORT_PERMISSIONS, INITIAL_REPORT_PERMISSIONS);
  }
}

// 1. DATA DICTIONARY
export function getDataDictionary(): DataDictionaryItem[] {
  initializeReportModule();
  return getStored<DataDictionaryItem[]>(STORAGE_KEYS.DATA_DICTIONARY, INITIAL_DATA_DICTIONARY);
}

export function addDataDictionaryColumn(item: Omit<DataDictionaryItem, 'id'>): DataDictionaryItem {
  const all = getDataDictionary();
  const newItem: DataDictionaryItem = {
    ...item,
    id: `dd-${item.table_name}-${item.column_name}-${Date.now()}`,
  };
  const updated = [...all, newItem];
  setStored(STORAGE_KEYS.DATA_DICTIONARY, updated);
  return newItem;
}

// 2. TABLE RELATIONSHIPS
export function getTableRelationships(): TableRelationship[] {
  initializeReportModule();
  return getStored<TableRelationship[]>(STORAGE_KEYS.TABLE_RELATIONSHIPS, INITIAL_TABLE_RELATIONSHIPS);
}

export function addTableRelationship(rel: Omit<TableRelationship, 'id'>): TableRelationship {
  const all = getTableRelationships();
  const newRel: TableRelationship = {
    ...rel,
    id: `rel-${Date.now()}`,
  };
  const updated = [...all, newRel];
  setStored(STORAGE_KEYS.TABLE_RELATIONSHIPS, updated);
  return newRel;
}

// 3. USER ROLES
export function getUserRoles(): UserRole[] {
  initializeReportModule();
  return getStored<UserRole[]>(STORAGE_KEYS.USER_ROLES, INITIAL_USER_ROLES);
}

// 4. SAVED REPORT TEMPLATES
export function getSavedReportTemplates(): SavedReportTemplate[] {
  initializeReportModule();
  return getStored<SavedReportTemplate[]>(STORAGE_KEYS.REPORT_TEMPLATES, INITIAL_REPORT_TEMPLATES);
}

export function getSavedReportTemplateById(id: string): SavedReportTemplate | null {
  const all = getSavedReportTemplates();
  return all.find((t) => t.id === id) || null;
}

export function saveReportTemplate(
  templateData: Omit<SavedReportTemplate, 'id' | 'created_at'> & { id?: string }
): SavedReportTemplate {
  const all = getSavedReportTemplates();
  const now = new Date().toISOString();

  let savedItem: SavedReportTemplate;

  if (templateData.id) {
    // Update existing
    savedItem = {
      ...templateData,
      id: templateData.id,
      created_at: now,
      updated_at: now,
    } as SavedReportTemplate;
    const index = all.findIndex((t) => t.id === templateData.id);
    if (index >= 0) {
      all[index] = savedItem;
    } else {
      all.unshift(savedItem);
    }
  } else {
    // Create new
    const newId = `template-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    savedItem = {
      ...templateData,
      id: newId,
      created_at: now,
    };
    all.unshift(savedItem);

    // Auto-create default permissions: Super Admin gets full access, Manager view/export
    const allPermissions = getReportPermissions();
    const defaultPerms: ReportPermission[] = [
      { id: `perm-${newId}-admin`, report_id: newId, role_id: 'super_admin', can_view: true, can_edit: true, can_export: true },
      { id: `perm-${newId}-mgr`, report_id: newId, role_id: 'manager', can_view: true, can_edit: false, can_export: true },
      { id: `perm-${newId}-acct`, report_id: newId, role_id: 'accountant', can_view: true, can_edit: false, can_export: true },
      { id: `perm-${newId}-cashier`, report_id: newId, role_id: 'cashier', can_view: false, can_edit: false, can_export: false },
    ];
    setStored(STORAGE_KEYS.REPORT_PERMISSIONS, [...allPermissions, ...defaultPerms]);
  }

  setStored(STORAGE_KEYS.REPORT_TEMPLATES, all);
  return savedItem;
}

export function deleteReportTemplate(id: string): boolean {
  const all = getSavedReportTemplates();
  const filtered = all.filter((t) => t.id !== id);
  setStored(STORAGE_KEYS.REPORT_TEMPLATES, filtered);

  // Also remove its permissions
  const perms = getReportPermissions();
  const remainingPerms = perms.filter((p) => p.report_id !== id);
  setStored(STORAGE_KEYS.REPORT_PERMISSIONS, remainingPerms);

  return true;
}

// 5. REPORT PERMISSIONS
export function getReportPermissions(reportId?: string): ReportPermission[] {
  initializeReportModule();
  const all = getStored<ReportPermission[]>(STORAGE_KEYS.REPORT_PERMISSIONS, INITIAL_REPORT_PERMISSIONS);
  if (reportId) {
    return all.filter((p) => p.report_id === reportId);
  }
  return all;
}

export function updateReportPermissions(
  reportId: string,
  permissions: Array<{ role_id: RoleId; can_view: boolean; can_edit: boolean; can_export: boolean }>
): void {
  const all = getReportPermissions();
  const others = all.filter((p) => p.report_id !== reportId);

  const updatedForReport: ReportPermission[] = permissions.map((p) => ({
    id: `perm-${reportId}-${p.role_id}`,
    report_id: reportId,
    role_id: p.role_id,
    can_view: p.can_view,
    can_edit: p.can_edit,
    can_export: p.can_export,
  }));

  setStored(STORAGE_KEYS.REPORT_PERMISSIONS, [...others, ...updatedForReport]);
}

/**
 * Returns list of reports that the current user has permission to view
 */
export function getUserPermittedReports(roleId: RoleId): Array<{
  template: SavedReportTemplate;
  permission: ReportPermission;
}> {
  const templates = getSavedReportTemplates();
  const permissions = getReportPermissions();

  const results: Array<{ template: SavedReportTemplate; permission: ReportPermission }> = [];

  templates.forEach((t) => {
    // Super admin always has full permissions
    if (roleId === 'super_admin') {
      const existing = permissions.find((p) => p.report_id === t.id && p.role_id === 'super_admin');
      results.push({
        template: t,
        permission: existing || {
          id: `perm-${t.id}-super_admin`,
          report_id: t.id,
          role_id: 'super_admin',
          can_view: true,
          can_edit: true,
          can_export: true,
        },
      });
      return;
    }

    const perm = permissions.find((p) => p.report_id === t.id && p.role_id === roleId);
    if (perm && perm.can_view) {
      results.push({
        template: t,
        permission: perm,
      });
    }
  });

  return results;
}
