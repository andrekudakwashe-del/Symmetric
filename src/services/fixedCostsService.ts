import { FixedMonthlyCost, FixedCostCategory } from '../types';
import { getStored, setStored, getCurrentCompanyId, getCurrentBranchId, getDeviceId, enqueueSync } from '../db/roomDatabase';
import { initIndexedDB } from '../db/indexedDBService';

export const FIXED_COSTS_STORAGE_KEY = 'saimetric_fixed_monthly_costs';
export const FIXED_COST_CATEGORIES_STORAGE_KEY = 'saimetric_fixed_cost_categories';

export interface FixedCostCategoryDefinition {
  key: string;
  label: string;
  icon: string;
  isCustom?: boolean;
}

export const DEFAULT_FIXED_COST_CATEGORIES: FixedCostCategoryDefinition[] = [
  { key: 'RENT', label: 'Rent & Premises', icon: '🏢' },
  { key: 'SALARIES', label: 'Fixed Salaries & Wages', icon: '👥' },
  { key: 'INTERNET', label: 'Internet, Wi-Fi & TelOne', icon: '🌐' },
  { key: 'LICENSES', label: 'Licenses & City Council', icon: '📜' },
  { key: 'INSURANCE', label: 'Insurance & Security', icon: '🛡️' },
  { key: 'OTHER_FIXED', label: 'Other Fixed Overheads', icon: '⚙️' },
];

export const getFixedCostCategories = (): FixedCostCategoryDefinition[] => {
  const stored = getStored<FixedCostCategoryDefinition[]>(
    FIXED_COST_CATEGORIES_STORAGE_KEY,
    DEFAULT_FIXED_COST_CATEGORIES
  );
  if (!Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_FIXED_COST_CATEGORIES;
  }
  // Ensure default categories exist if not present
  const keys = new Set(stored.map((c) => c.key));
  const merged = [...stored];
  DEFAULT_FIXED_COST_CATEGORIES.forEach((def) => {
    if (!keys.has(def.key)) {
      merged.push(def);
    }
  });
  return merged;
};

export const saveFixedCostCategory = (cat: { key: string; label: string; icon?: string; oldKey?: string }): FixedCostCategoryDefinition => {
  const all = getFixedCostCategories();
  const searchKey = cat.oldKey || cat.key;
  const cleanKey = (cat.key || cat.label).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const index = all.findIndex((c) => c.key === searchKey || c.key === cleanKey);
  const record: FixedCostCategoryDefinition = {
    key: cleanKey,
    label: cat.label.trim(),
    icon: cat.icon || '🏷️',
    isCustom: index >= 0 ? all[index].isCustom ?? true : true,
  };

  let updated: FixedCostCategoryDefinition[];
  if (index >= 0) {
    updated = [...all];
    updated[index] = { ...all[index], ...record };
  } else {
    updated = [...all, record];
  }

  setStored(FIXED_COST_CATEGORIES_STORAGE_KEY, updated);

  // If category key was updated/renamed, migrate any fixed cost records that used the previous key
  if (cat.oldKey && cat.oldKey !== cleanKey) {
    const costs = getAllFixedCosts();
    let costsChanged = false;
    const migratedCosts = costs.map((c) => {
      if (c.category === cat.oldKey) {
        costsChanged = true;
        return { ...c, category: cleanKey };
      }
      return c;
    });
    if (costsChanged) {
      setStored(FIXED_COSTS_STORAGE_KEY, migratedCosts);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_fixed_cost_categories_updated', { detail: updated }));
    window.dispatchEvent(new CustomEvent('saimetric_fixed_costs_updated', { detail: { categoryUpdated: cleanKey } }));
  }
  return record;
};

export const deleteFixedCostCategory = (key: string): boolean => {
  const all = getFixedCostCategories();
  // Don't delete core system categories, but can hide custom ones
  const filtered = all.filter((c) => c.key !== key);
  setStored(FIXED_COST_CATEGORIES_STORAGE_KEY, filtered);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_fixed_cost_categories_updated', { detail: filtered }));
  }
  return true;
};

export const DEFAULT_FIXED_COSTS: FixedMonthlyCost[] = [
  {
    uuid: 'fc-rent-001',
    id: 'fc-rent-001',
    shop_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    device_id: 'DEV-PRIMARY',
    name: 'Shop Commercial Premises Rent',
    category: 'RENT',
    monthly_amount: 900.0,
    currency: 'USD',
    effective_from_date: '2026-01-01',
    effective_to_date: null,
    is_active: true,
    is_deleted: false,
    created_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    synced_at: null,
    sync_status: 'synced',
    version: 1,
  },
  {
    uuid: 'fc-salaries-002',
    id: 'fc-salaries-002',
    shop_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    device_id: 'DEV-PRIMARY',
    name: 'Base Staff Fixed Salaries',
    category: 'SALARIES',
    monthly_amount: 1200.0,
    currency: 'USD',
    effective_from_date: '2026-01-01',
    effective_to_date: null,
    is_active: true,
    is_deleted: false,
    created_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    synced_at: null,
    sync_status: 'synced',
    version: 1,
  },
  {
    uuid: 'fc-internet-003',
    id: 'fc-internet-003',
    shop_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    device_id: 'DEV-PRIMARY',
    name: 'TelOne / Starlink POS Fibre Internet',
    category: 'INTERNET',
    monthly_amount: 85.0,
    currency: 'USD',
    effective_from_date: '2026-01-01',
    effective_to_date: null,
    is_active: true,
    is_deleted: false,
    created_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    synced_at: null,
    sync_status: 'synced',
    version: 1,
  },
  {
    uuid: 'fc-license-004',
    id: 'fc-license-004',
    shop_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    device_id: 'DEV-PRIMARY',
    name: 'Municipal City Council Shop License',
    category: 'LICENSES',
    monthly_amount: 45.0,
    currency: 'USD',
    effective_from_date: '2026-01-01',
    effective_to_date: null,
    is_active: true,
    is_deleted: false,
    created_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T08:00:00Z').toISOString(),
    synced_at: null,
    sync_status: 'synced',
    version: 1,
  },
];

// Asynchronously persist to native IndexedDB
async function persistToIndexedDB(item: FixedMonthlyCost): Promise<void> {
  try {
    const db = await initIndexedDB();
    if (!db) return;
    const tx = db.transaction('fixedMonthlyCosts', 'readwrite');
    const store = tx.objectStore('fixedMonthlyCosts');
    store.put(item);
  } catch (err) {
    console.warn('[FixedCosts] IndexedDB write notice:', err);
  }
}

// Asynchronously sync all from IndexedDB into memory if present
export async function syncFromIndexedDB(): Promise<void> {
  try {
    const db = await initIndexedDB();
    if (!db) return;
    const tx = db.transaction('fixedMonthlyCosts', 'readonly');
    const store = tx.objectStore('fixedMonthlyCosts');
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result as FixedMonthlyCost[];
      if (Array.isArray(records) && records.length > 0) {
        const current = getStored<FixedMonthlyCost[]>(FIXED_COSTS_STORAGE_KEY, []);
        const mergedMap = new Map<string, FixedMonthlyCost>();
        // Keep current memory/localStorage records as base
        current.forEach((c) => mergedMap.set(c.uuid, c));
        // Only override if record from IndexedDB is newer or doesn't exist yet
        records.forEach((r) => {
          const ex = mergedMap.get(r.uuid);
          if (!ex) {
            mergedMap.set(r.uuid, r);
          } else if (r.updated_at && ex.updated_at && r.updated_at > ex.updated_at) {
            mergedMap.set(r.uuid, r);
          }
        });
        setStored(FIXED_COSTS_STORAGE_KEY, Array.from(mergedMap.values()));
      }
    };
  } catch (err) {
    console.warn('[FixedCosts] IndexedDB read notice:', err);
  }
}

export const getAllFixedCosts = (): FixedMonthlyCost[] => {
  const stored = getStored<FixedMonthlyCost[]>(FIXED_COSTS_STORAGE_KEY, null as any);
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  return DEFAULT_FIXED_COSTS.map((c) => ({ ...c }));
};

export const getCompanyFixedCosts = (companyId?: string): FixedMonthlyCost[] => {
  const currentCompany = companyId || getCurrentCompanyId() || 'COMP-001';
  const all = getAllFixedCosts();
  return all.filter((c) => {
    if (c.is_deleted) return false;
    return (
      !c.shop_id ||
      c.shop_id === currentCompany ||
      currentCompany === 'COMP-MASTER' ||
      c.shop_id === 'COMP-MASTER'
    );
  });
};

export const getFixedCosts = (shopId?: string, branchId?: string): FixedMonthlyCost[] => {
  const currentCompany = shopId || getCurrentCompanyId();
  const currentBranch = branchId || getCurrentBranchId();
  const all = getAllFixedCosts();

  return all.filter((c) => {
    if (c.is_deleted) return false;
    const matchShop =
      !c.shop_id ||
      c.shop_id === currentCompany ||
      currentCompany === 'COMP-MASTER' ||
      c.shop_id === 'COMP-MASTER';
    if (!matchShop) return false;

    // Items marked 'ALL' or with empty branch_id apply universally across all branches
    if (!c.branch_id || c.branch_id.toUpperCase() === 'ALL') {
      return true;
    }

    if (currentBranch && currentBranch !== 'ALL') {
      return c.branch_id.toLowerCase() === currentBranch.toLowerCase();
    }
    return true;
  });
};

export const saveFixedCost = (
  costData: Partial<FixedMonthlyCost> & { name: string; monthly_amount: number; category: FixedCostCategory }
): FixedMonthlyCost => {
  const all = getAllFixedCosts();
  const currentCompany = getCurrentCompanyId() || 'COMP-001';
  const currentBranch = getCurrentBranchId() || 'ALL';
  const now = new Date().toISOString();
  const uuid = costData.uuid || costData.id || `fc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const existingIndex = all.findIndex((c) => c.uuid === uuid || (costData.id && (c.id === costData.id || c.uuid === costData.id)) || (costData.uuid && c.id === costData.uuid));
  const existing = existingIndex >= 0 ? all[existingIndex] : null;

  const targetBranch =
    costData.branch_id !== undefined
      ? costData.branch_id
      : existing?.branch_id !== undefined
      ? existing.branch_id
      : 'ALL';

  const savedRecord: FixedMonthlyCost = {
    uuid,
    id: uuid,
    shop_id: costData.shop_id || currentCompany || existing?.shop_id || 'COMP-001',
    branch_id: targetBranch,
    device_id: costData.device_id || existing?.device_id || getDeviceId(),
    name: costData.name.trim(),
    category: costData.category,
    monthly_amount: Math.max(0, Number(costData.monthly_amount) || 0),
    currency: costData.currency || existing?.currency || 'USD',
    effective_from_date: costData.effective_from_date || existing?.effective_from_date || now.slice(0, 10),
    effective_to_date: costData.effective_to_date !== undefined ? costData.effective_to_date : (existing ? existing.effective_to_date : null),
    is_active: costData.is_active !== undefined ? costData.is_active : (existing ? existing.is_active : true),
    is_deleted: false,
    created_at: existing?.created_at || now,
    updated_at: now,
    synced_at: null,
    sync_status: 'pending',
    version: (existing?.version || 0) + 1,
  };

  let updatedList: FixedMonthlyCost[];
  if (existingIndex >= 0) {
    updatedList = [...all];
    updatedList[existingIndex] = savedRecord;
  } else {
    updatedList = [savedRecord, ...all];
  }

  setStored(FIXED_COSTS_STORAGE_KEY, updatedList);
  persistToIndexedDB(savedRecord);

  // Push to offline sync queue
  const actionType = existingIndex >= 0 ? 'UPDATE' : 'INSERT';
  enqueueSync('FixedMonthlyCosts' as any, actionType, {
    uuid: savedRecord.uuid,
    shop_id: savedRecord.shop_id,
    branch_id: savedRecord.branch_id,
    name: savedRecord.name,
    category: savedRecord.category,
    monthly_amount: savedRecord.monthly_amount,
    currency: savedRecord.currency,
    effective_from_date: savedRecord.effective_from_date,
    effective_to_date: savedRecord.effective_to_date,
    is_active: savedRecord.is_active,
    updated_at: savedRecord.updated_at,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_fixed_costs_updated', { detail: savedRecord }));
  }

  return savedRecord;
};

export const deleteFixedCost = (uuid: string): boolean => {
  const all = getAllFixedCosts();
  const index = all.findIndex((c) => c.uuid === uuid);
  if (index === -1) return false;

  const updated = [...all];
  updated[index] = {
    ...updated[index],
    is_deleted: true,
    updated_at: new Date().toISOString(),
    sync_status: 'pending',
  };

  setStored(FIXED_COSTS_STORAGE_KEY, updated);
  persistToIndexedDB(updated[index]);

  enqueueSync('FixedMonthlyCosts', 'DELETE', { uuid, shop_id: updated[index].shop_id });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_fixed_costs_updated'));
  }

  return true;
};

export const toggleFixedCostActive = (uuid: string, isActive: boolean): boolean => {
  const all = getAllFixedCosts();
  const item = all.find((c) => c.uuid === uuid);
  if (!item) return false;

  saveFixedCost({
    ...item,
    is_active: isActive,
  });
  return true;
};
