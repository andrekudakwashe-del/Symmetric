import { P2PMeshConfig } from '../../types';
import {
  addSupplier,
  saveAdminSalesEntry,
  saveFinalCashCount,
  saveSupplierInvoiceVoucher,
  saveBusinessDayClosure,
  saveElectronicSettlement,
  saveCategories,
  getCategories,
  getTombstones,
  parseTimestampMs,
  getSales,
  getDeletedInventoryItems,
  ingestMeshSale,
  ingestMeshInventoryDelete,
} from '../../db/roomDatabase';
import { normalizeTombstoneEntityType } from '../sync/syncCore';
import { MeshEventLog, playChime } from './meshTypesAndHelpers';

// =========================================================================
// T1 & T2 STANDALONE ENTITY INGESTORS
// =========================================================================

export function ingestMeshSupplierRecord(payload: any): boolean {
  if (!payload || (!payload.supplierId && !payload.id && !payload.SupplierID)) {
    return false;
  }
  try {
    const supp = {
      ...payload,
      supplierId: payload.supplierId || payload.id || payload.SupplierID,
      name: payload.name || payload.Name || '',
      category: payload.category || payload.Category,
      phone: payload.phone || payload.Phone,
      address: payload.address || payload.Address,
      city: payload.city || payload.City,
      paymentTerms: payload.paymentTerms || payload.PaymentTerms,
      taxNumber: payload.taxNumber || payload.TaxNumber,
    };
    addSupplier(supp, { fromSync: true });
    window.dispatchEvent(new Event('saimetric_suppliers_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_suppliers_updated', { detail: supp })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshSupplier error:', e);
    return false;
  }
}

export function ingestMeshAdminSalesRecord(payload: any): boolean {
  if (!payload || (!payload.id && !payload.staffId)) return false;
  try {
    const entry = saveAdminSalesEntry(
      payload.date || new Date().toISOString().split('T')[0],
      payload.staffId || 'ADMIN',
      payload.staffName || 'Admin Sales',
      Number(payload.salesAmount || payload.amount || 0),
      payload.notes || '',
      {
        fromSync: true,
        id: payload.id,
        timestamp: payload.timestamp,
        company_id: payload.company_id || payload.companyId,
        branch_id: payload.branch_id || payload.branchId,
      }
    );
    window.dispatchEvent(new Event('saimetric_admin_sales_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_admin_sales_updated', { detail: entry })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshAdminSales error:', e);
    return false;
  }
}

export function ingestMeshCashCountRecord(payload: any): boolean {
  if (!payload || (!payload.id && !payload.staffId)) return false;
  try {
    const cleanPayload: any = { ...payload };
    delete cleanPayload.fromMesh;
    delete cleanPayload.fromSync;
    const res = saveFinalCashCount(
      {
        id: cleanPayload.id,
        timestamp: cleanPayload.timestamp,
        updatedAt: cleanPayload.updatedAt || cleanPayload.hubTimestamp,
        lastUpdated: cleanPayload.lastUpdated,
        staffId: cleanPayload.staffId,
        staffName: cleanPayload.staffName || 'Staff',
        denominations: cleanPayload.denominations || {},
        finalCashOutTotal: Number(
          cleanPayload.finalCashOutTotal ?? cleanPayload.total ?? 0
        ),
        notes: cleanPayload.notes || '',
        date: cleanPayload.date,
        branchId: cleanPayload.branchId || cleanPayload.branch_id,
        branch_id: cleanPayload.branch_id || cleanPayload.branchId,
        companyId: cleanPayload.companyId || cleanPayload.company_id,
        company_id: cleanPayload.company_id || cleanPayload.companyId,
        ...(cleanPayload.isCloudSynced !== undefined
          ? { isCloudSynced: cleanPayload.isCloudSynced }
          : {}),
      },
      { fromSync: true }
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('saimetric_cash_counts_updated'));
      window.dispatchEvent(
        new CustomEvent('saimetric_cash_counts_updated', {
          detail: res.countRecord,
        })
      );
      window.dispatchEvent(new Event('saimetric_cash_movements_updated'));
      window.dispatchEvent(new Event('saimetric_cash_updated'));
    }
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshCashCount error:', e);
    return false;
  }
}

export function ingestMeshVoucherRecord(payload: any): boolean {
  if (!payload || (!payload.voucherId && !payload.id)) return false;
  try {
    const voucher = saveSupplierInvoiceVoucher(
      {
        ...payload,
        voucherId: payload.voucherId || payload.id,
      },
      { fromSync: true }
    );
    window.dispatchEvent(new Event('saimetric_vouchers_updated'));
    window.dispatchEvent(new Event('saimetric_supplier_invoices_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_vouchers_updated', { detail: voucher })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshVoucher error:', e);
    return false;
  }
}

export function ingestMeshClosureRecord(payload: any): boolean {
  if (!payload || (!payload.id && !payload.date)) return false;
  try {
    const res = saveBusinessDayClosure(
      {
        ...payload,
        id: payload.id || `EOD-${payload.date}-${payload.branchId || 'BR-MAIN'}`,
      },
      { fromSync: true }
    );
    window.dispatchEvent(new Event('saimetric_closures_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_closures_updated', { detail: res.closure })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshClosure error:', e);
    return false;
  }
}

export function ingestMeshSettlementRecord(payload: any): boolean {
  if (!payload || (!payload.id && !payload.date)) return false;
  try {
    saveElectronicSettlement(
      {
        ...payload,
        id:
          payload.id ||
          `SETTLE-${payload.date}-${payload.branchId || 'BR-MAIN'}`,
      },
      { fromSync: true }
    );
    window.dispatchEvent(new Event('saimetric_settlements_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_settlements_updated', { detail: payload })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshSettlement error:', e);
    return false;
  }
}

export function ingestMeshCategoriesRecord(payload: any): boolean {
  const rawCategories = Array.isArray(payload)
    ? payload
    : payload?.categories || payload?.item || payload?.data;
  if (!Array.isArray(rawCategories)) return false;

  const tombstones = getTombstones();
  const catTombstones = tombstones.filter(
    (t) => normalizeTombstoneEntityType(t.entityType) === 'inventory_category'
  );
  const incomingCatTs = parseTimestampMs(
    payload?.updatedAt || payload?.lastUpdated || payload?.hubTimestamp || 0
  );
  const filteredCategories = rawCategories.filter((cat: any) => {
    const catId = String(cat?.categoryId || cat?.id || '').trim().toUpperCase();
    if (!catId) return true;
    const tomb = catTombstones.find(
      (t) => String(t.entityId || '').trim().toUpperCase() === catId
    );
    if (!tomb) return true;
    const catItemTs =
      parseTimestampMs(cat?.updatedAt || cat?.lastUpdated || 0) ||
      incomingCatTs;
    return !(Number(tomb.deletedAt || 0) > catItemTs);
  });

  // T2 LWW Guard (60000ms skew tolerance)
  const existingCats = getCategories();
  const existingTime = Math.max(
    ...existingCats.map((c: any) =>
      parseTimestampMs(c.updatedAt || c.lastUpdated || c.timestamp || 0)
    ),
    0
  );
  const incomingTime = incomingCatTs;

  if (
    existingTime > 0 &&
    incomingTime > 0 &&
    existingTime > incomingTime + 60000
  ) {
    console.warn(
      `[LWW Client] 🛡️ Rejected stale categories update (Local: ${new Date(
        existingTime
      ).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()})`
    );
    return false;
  }

  try {
    saveCategories(filteredCategories, { fromSync: true });
    window.dispatchEvent(new Event('saimetric_categories_updated'));
    window.dispatchEvent(
      new CustomEvent('saimetric_categories_updated', {
        detail: filteredCategories,
      })
    );
    return true;
  } catch (e) {
    console.warn('[MeshSyncService] ingestMeshCategories error:', e);
    return false;
  }
}

// =========================================================================
// OFFLINE TRANSPORT A: OPTICAL QR BATCH SYNC (Air-gapped, zero-network)
// =========================================================================

export function generateOfflineBatchPayloadForConfig(
  config: P2PMeshConfig
): string {
  const allSales = getSales();
  const recentSales = allSales.slice(0, 15);
  const payload = {
    type: 'SAIMETRIC_OFFLINE_BATCH',
    version: 2,
    companyId: config.companyId,
    branchId: config.branchId,
    branchCode: config.branchCode,
    originDeviceId: config.deviceId,
    originDeviceName: config.deviceName,
    timestamp: Date.now(),
    sales: recentSales.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      customerName: s.customerName,
      staffName: s.staffName || 'Staff',
      total: s.total,
      tax: s.tax,
      paymentMethod: s.paymentMethod,
      company_id: config.companyId,
      branch_id: config.branchId,
      items: (s.items || []).map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
      })),
    })),
    deletedItemIds: getDeletedInventoryItems()
      .filter(
        (d) =>
          (d.companyId || '').toUpperCase() ===
          (config.companyId || '').toUpperCase()
      )
      .slice(-50),
  };
  return JSON.stringify(payload);
}

export function ingestOfflineBatchPayloadForConfig(
  rawString: string,
  config: P2PMeshConfig,
  hooks: {
    addLog: (
      type: MeshEventLog['type'],
      message: string,
      sourceDevice: string,
      targetDevice?: string
    ) => void;
    notifyPeerSubscribers: () => void;
  }
): {
  success: boolean;
  syncedCount: number;
  message: string;
  details?: string;
} {
  try {
    const parsed = JSON.parse(rawString);
    if (
      !parsed ||
      parsed.type !== 'SAIMETRIC_OFFLINE_BATCH' ||
      !Array.isArray(parsed.sales)
    ) {
      return {
        success: false,
        syncedCount: 0,
        message: 'Invalid offline QR packet format.',
      };
    }

    // Strict tenant isolation
    const packetComp = (parsed.companyId || parsed.company_id || '')
      .trim()
      .toUpperCase();
    const localComp = (config.companyId || '').trim().toUpperCase();
    if (packetComp && localComp && packetComp !== localComp) {
      return {
        success: false,
        syncedCount: 0,
        message: `Security Isolation: QR code belongs to tenant [${packetComp}], but this terminal is on [${localComp}].`,
      };
    }

    // Strict branch isolation
    const packetBranch = (parsed.branchId || parsed.branchCode || '')
      .trim()
      .toUpperCase();
    const localBranchId = (config.branchId || '').trim().toUpperCase();
    const localBranchCode = (config.branchCode || '').trim().toUpperCase();
    if (
      packetBranch &&
      packetBranch !== localBranchId &&
      packetBranch !== localBranchCode
    ) {
      return {
        success: false,
        syncedCount: 0,
        message: `Branch mismatch: Beacon is for branch [${packetBranch}], but this terminal is assigned to [${localBranchCode}].`,
      };
    }

    let count = 0;
    for (const s of parsed.sales) {
      const didIngest = ingestMeshSale({
        ...s,
        company_id: config.companyId,
        branch_id: config.branchId,
        fromMesh: true,
      });
      if (didIngest) count++;
    }

    // Sync offline deleted items across peer terminals
    let deletedCount = 0;
    if (Array.isArray(parsed.deletedItemIds)) {
      for (const del of parsed.deletedItemIds) {
        if (del && del.itemId) {
          const didDel = ingestMeshInventoryDelete(
            del.itemId,
            del.companyId || config.companyId
          );
          if (didDel) deletedCount++;
        }
      }
    }

    playChime();
    hooks.addLog(
      'EPIDEMIC_HOP',
      `Air-Gapped Optical QR: Ingested ${count} sales and ${deletedCount} deleted records from ${
        parsed.originDeviceName || 'Terminal'
      } into local Room database!`,
      parsed.originDeviceName || 'Airgap QR',
      config.deviceName
    );

    hooks.notifyPeerSubscribers();

    return {
      success: true,
      syncedCount: count,
      message: `Successfully ingested ${count} sale(s) into local database!`,
      details: `${parsed.sales.length} sale(s) processed from ${parsed.originDeviceName} (${parsed.branchCode}). Inventory decremented & daily totals updated.`,
    };
  } catch (e: any) {
    return {
      success: false,
      syncedCount: 0,
      message: e.message || 'Error parsing offline batch.',
    };
  }
}
