import { SyncEnvelope } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { normalizeTombstoneEntityType } from './syncCore';
import {
  getAllSales,
  getRawStoredInventoryItems,
  getRawStoredSalespeople,
  getRawStoredCustomers,
  getAllBranches,
  getRawStoredCashAccounts,
  getCreditGroups,
  getRawStoredSuppliers,
  getRawStoredStocktakeSessions,
  getTemporaryCasuals,
  getRawStoredExpenses,
  getRawStoredDirectGrvs,
  getRawStoredCustomerChanges,
  getRawStoredCreditSales,
  getRawStoredCashLogs,
  getRawStoredCashLifts,
  getRawStoredCashTransfers,
  getRawStoredStockMovements,
  getRawStoredGoodsReceived,
  getRawStoredAuditLogs,
  getRawStoredReconciliations,
  getRawStoredAdminSales,
  getRawStoredCashCounts,
  getRawStoredSupplierInvoiceVouchers,
  getRawStoredBusinessDayClosures,
  getBranchLockdowns,
  getZoneAssignments,
  getCategories,
  getMultiCurrencyUpdatedAt,
  getPermissionsMatrixUpdatedAt,
  getCurrentCompanyId,
  getCurrentBranchId,
  parseTimestampMs,
  extractRecordTimestamp,
  getTombstones,
  applyTombstone,
  ingestMeshInventoryDelete,
  ingestMeshSale,
  ingestMeshCashLog,
  ingestMeshInventoryItem,
  ingestMeshCustomerChange,
  ingestMeshCreditSale,
  ingestMeshCreditGroup,
  ingestMeshStockMovement,
  ingestMeshGRV,
  ingestMeshGoodsReceived,
  addExpense,
  ingestMeshCashLift,
  ingestMeshCashTransfer,
  ingestMeshStaff,
  ingestMeshPermissionsMatrix,
  ingestMeshMultiCurrencyConfig,
  ingestMeshCustomer,
  isValidBranchRecord,
  saveBranch,
  saveCashAccount,
  addSupplier,
  saveAdminSalesEntry,
  saveFinalCashCount,
  saveSupplierInvoiceVoucher,
  saveBusinessDayClosure,
  saveElectronicSettlement,
  saveCategories,
  ingestMeshSupervisorApproval,
  saveReconciliation,
  ingestMeshSettings,
  syncCasualWorkersFromHub,
  syncLockdownFromHub,
  saveStocktakeSegment,
  updateZoneClaim,
  saveCountSubmission,
  saveZoneAssignment,
  applyJointRecountSignature,
  reopenFinalizedSegmentSlot,
  ingestStocktakeSessionFromMesh,
  updateSheetsConfig,
} from '../../db/roomDatabase';
import { getMovements, addMovement } from '../../db/cashLedger';
import {
  getWallets,
  saveWallets,
  getInternalConsumptions,
  ingestMeshInternalConsumption,
} from '../walletService';
import {
  getRoleDefinitionsUpdatedAt,
  ingestMeshRoleDefinitions,
} from '../roleNavigationService';
import {
  getLastStaffSync,
  setLastStaffSync,
  getLastBranchSync,
  setLastBranchSync,
  getLastCustomerSync,
  setLastCustomerSync,
  getLastCashAccountSync,
  setLastCashAccountSync,
  getLastMultiCurrencySync,
  setLastMultiCurrencySync,
  getLastCasualWorkerSync,
  setLastCasualWorkerSync,
  getLastStocktakeSessionSync,
  setLastStocktakeSessionSync,
} from './highWaterMarks';

export function lookupLocalRecordForCloudEnvelope(envelope: SyncEnvelope): any | undefined {
  if (!envelope || !envelope.entityType) return undefined;
  const spec = ENTITY_REGISTRY[envelope.entityType];
  if (!spec) return undefined;

  const cleanId = String(envelope.entityId || '').trim();
  const cleanUpper = cleanId.toUpperCase();
  const d: any = envelope.data || {};

  if (spec.class === 'T2') {
    switch (envelope.entityType) {
      case 'inventory_item': {
        const found = getRawStoredInventoryItems().find(
          (it: any) => String(it.itemId || it.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = Math.max(
          parseTimestampMs((found as any).hubTimestamp),
          parseTimestampMs((found as any).updatedAt),
          parseTimestampMs((found as any).lastUpdated)
        );
        return ts > 0 ? { ...found, updatedAt: ts, hubTimestamp: ts } : undefined;
      }
      case 'staff': {
        const found = getRawStoredSalespeople().find(
          (s: any) => String(s.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'customer': {
        const found = getRawStoredCustomers().find(
          (c: any) => String(c.customerId || c.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'branch': {
        const normCanon = (raw?: string) => {
          const c = String(raw || '').trim().toUpperCase();
          return c === '1' || c === 'BR001' || c === 'BR-MAIN' ? 'BR-MAIN' : c;
        };
        const targetUpper = normCanon(cleanUpper);
        const found = getAllBranches().find(
          (b: any) => normCanon(b.branchId || b.id || b.branch_id) === targetUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'cash_account': {
        const found = getRawStoredCashAccounts().find(
          (a: any) => String(a.account_id || a.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'wallet': {
        const found = getWallets().find(
          (w: any) => String(w.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'multi_currency': {
        const ts = getMultiCurrencyUpdatedAt();
        return ts > 0 ? { updatedAt: ts } : undefined;
      }
      case 'permissions_matrix': {
        const ts = getPermissionsMatrixUpdatedAt();
        return ts > 0 ? { updatedAt: ts } : undefined;
      }
      case 'role_configs': {
        const ts = getRoleDefinitionsUpdatedAt();
        return ts > 0 ? { updatedAt: ts } : undefined;
      }
      case 'inventory_category': {
        const cats = getCategories();
        const maxTs = Math.max(
          ...cats.map((c: any) => parseTimestampMs(c.updatedAt || c.lastUpdated || c.timestamp || 0)),
          0
        );
        return maxTs > 0 ? { updatedAt: maxTs } : undefined;
      }
      case 'credit_group': {
        const found = getCreditGroups().find(
          (g: any) => String(g.id || g.groupId || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'supplier': {
        const found = getRawStoredSuppliers().find(
          (s: any) => String(s.supplierId || s.id || s.SupplierID || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'stocktake_session': {
        const found = getRawStoredStocktakeSessions().find(
          (s: any) => String(s.sessionId || s.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'stocktake_zone_assignment': {
        const found = getZoneAssignments(d?.sessionId).find(
          (z: any) => String(z.zoneId || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'branch_lockdown': {
        const map = getBranchLockdowns();
        const targetBr = String(d?.branchId || cleanId || '').trim();
        const found = map[targetBr];
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'casual_worker': {
        const casuals = getTemporaryCasuals();
        const maxTs = Math.max(...casuals.map((c: any) => extractRecordTimestamp(c)), 0);
        return maxTs > 0 ? { updatedAt: maxTs } : undefined;
      }
      default:
        return undefined;
    }
  }

  switch (envelope.entityType) {
    case 'sale': {
      const isSaleUpdate =
        envelope.action === 'UPSERT' ||
        Boolean(envelope.meta?.isSaleUpdate) ||
        d?.status === 'Refunded' ||
        d?.status === 'Voided' ||
        d?.mobileVerificationStatus === 'VERIFIED' ||
        d?.mobileVerificationStatus === 'FLAGGED' ||
        Boolean(d?.hasExchanges);
      if (isSaleUpdate) return undefined;
      return getAllSales().find((s: any) => String(s.id || '').trim().toUpperCase() === cleanUpper);
    }
    case 'expense': {
      const existing = getRawStoredExpenses().find(
        (e: any) => String(e.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged = (d?.status && d.status !== existing.status) || envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'direct_grv': {
      const existing = getRawStoredDirectGrvs().find(
        (g: any) => String(g.id || g.grvNumber || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged = (d?.status && d.status !== existing.status) || envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'internal_consumption': {
      const existing = getInternalConsumptions().find(
        (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged = (d?.status && d.status !== existing.status) || envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'customer_change': {
      const existing = getRawStoredCustomerChanges().find(
        (c: any) => String(c.id || c.changeId || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const changed = (d?.status && d.status !== (existing as any).status) || envelope.action === 'UPSERT';
      return changed ? undefined : existing;
    }
    case 'credit_sale': {
      const existing = getRawStoredCreditSales().find(
        (c: any) => String(c.id || c.creditId || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const changed =
        (d?.status && d.status !== (existing as any).status) ||
        (d?.paidAmount !== undefined && d.paidAmount !== (existing as any).paidAmount) ||
        envelope.action === 'UPSERT';
      return changed ? undefined : existing;
    }
    case 'cash_log':
      return getRawStoredCashLogs().find(
        (c: any) => String(c.id || `${c.date}_${c.timestamp}`).trim().toUpperCase() === cleanUpper
      );
    case 'cash_movement':
      return getMovements().find((m: any) => String(m.id || '').trim().toUpperCase() === cleanUpper);
    case 'cash_lift':
      return getRawStoredCashLifts().find((l: any) => String(l.id || '').trim().toUpperCase() === cleanUpper);
    case 'cash_transfer':
      return getRawStoredCashTransfers().find(
        (t: any) => String(t.transfer_id || t.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'stock_movement':
      return getRawStoredStockMovements().find(
        (m: any) => String(m.id || m.txnId || m.movementId || '').trim().toUpperCase() === cleanUpper
      );
    case 'goods_received':
      return getRawStoredGoodsReceived().find(
        (g: any) => String(g.id || g.grnId || '').trim().toUpperCase() === cleanUpper
      );
    case 'supervisor_approval':
    case 'audit_log':
      return getRawStoredAuditLogs().find((a: any) => String(a.id || '').trim().toUpperCase() === cleanUpper);
    case 'reconciliation':
      return getRawStoredReconciliations().find((r: any) => String(r.id || '').trim().toUpperCase() === cleanUpper);
    case 'admin_sales':
      return getRawStoredAdminSales().find((a: any) => String(a.id || '').trim().toUpperCase() === cleanUpper);
    case 'cash_count':
      return getRawStoredCashCounts().find((c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper);
    case 'supplier_invoice_voucher':
      return getRawStoredSupplierInvoiceVouchers().find(
        (v: any) => String(v.voucherId || v.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'business_day_closure':
      return getRawStoredBusinessDayClosures().find(
        (b: any) => String(b.id || '').trim().toUpperCase() === cleanUpper
      );
    default:
      return undefined;
  }
}

export function applyCloudEnvelopeToRoomDb(
  envelope: SyncEnvelope,
  _originName: string = 'APPS_SCRIPT_CLOUD'
): void {
  if (!envelope || !envelope.entityType) return;
  const d: any = envelope.data || {};
  const compId = d?.company_id || d?.companyId || getCurrentCompanyId() || 'COMP-001';
  const branchId = d?.branch_id || d?.branchId || envelope.targetBranchId || getCurrentBranchId() || 'BR-MAIN';

  if (envelope.action === 'DELETE') {
    if (envelope.entityId) {
      if (envelope.entityType === 'inventory_item') {
        ingestMeshInventoryDelete(envelope.entityId, compId);
      }
      applyTombstone({
        entityType: envelope.entityType,
        entityId: envelope.entityId,
        deletedAt: envelope.updatedAt || Date.now(),
      });
    }
    return;
  }

  switch (envelope.entityType) {
    case 'sale': {
      const saleId = envelope.entityId || d.id || d.InvoiceID;
      if (!saleId || !d) return;
      const ingested = ingestMeshSale({
        ...d,
        id: saleId,
        company_id: compId,
        branch_id: d.branch_id || d.branchId || branchId,
        isCloudSynced: true,
        fromMesh: true,
      } as any);
      if (ingested && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;
    }

    case 'inventory_item': {
      if (!d || (!d.itemId && !d.id)) return;
      const ts = parseTimestampMs(envelope.hubTimestamp ?? envelope.updatedAt ?? d.updatedAt ?? d.lastUpdated) || Date.now();
      const ingested = ingestMeshInventoryItem({
        ...d,
        itemId: d.itemId || d.id || envelope.entityId,
        updatedAt: ts,
        hubTimestamp: ts,
        lastUpdated: d.lastUpdated || new Date(ts).toISOString(),
        company_id: compId,
        branch_id: d.branch_id || 'ALL',
        isCloudSynced: true,
        fromMesh: true,
      });
      if (ingested && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated', { detail: d }));
        window.dispatchEvent(new Event('saimetric_products_updated'));
      }
      break;
    }

    case 'cash_log':
      if (d && ingestMeshCashLog({ ...d, isCloudSynced: true, fromMesh: true } as any) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
      break;

    case 'customer_change':
      if (d && ingestMeshCustomerChange({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_customer_changes_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'credit_sale':
      if (d && ingestMeshCreditSale({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_credit_sales_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'credit_group':
      if (d && ingestMeshCreditGroup({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_credit_groups_updated', { detail: d }));
      }
      break;

    case 'stock_movement':
      if (d && ingestMeshStockMovement({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;

    case 'direct_grv':
      if (d && ingestMeshGRV({ ...d, isCloudSynced: true, fromMesh: true } as any) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_direct_grvs_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'goods_received':
      if (d && ingestMeshGoodsReceived({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;

    case 'expense':
      if (d) {
        addExpense({ ...d, isCloudSynced: true, fromMesh: true }, { fromSync: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      break;

    case 'internal_consumption':
      if (d && d.id && ingestMeshInternalConsumption({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_internal_consumption_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;

    case 'cash_movement':
      if (d && d.id) {
        const cur = getMovements();
        if (!cur.some((m) => m.id === d.id)) {
          addMovement({ ...d, isCloudSynced: true, fromMesh: true });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          }
        }
      }
      break;

    case 'cash_lift':
      if (d && ingestMeshCashLift({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'cash_transfer':
      if (d && ingestMeshCashTransfer({ ...d, isCloudSynced: true }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_transfers_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'wallet': {
      if (d && (d.id || envelope.entityId)) {
        const targetId = String(d.id || envelope.entityId);
        const list = getWallets();
        const idx = list.findIndex((w) => w.id === targetId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...d, id: targetId as any };
        } else {
          list.push({ ...d, id: targetId as any });
        }
        saveWallets(list);
      }
      break;
    }

    case 'staff':
      if (d && d.id) {
        const staffTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        ingestMeshStaff({ ...d, isCloudSynced: true, fromMesh: true } as any, { fromSync: true });
        if (staffTime > 0) setLastStaffSync(Math.max(getLastStaffSync(), staffTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_salespeople_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_staff_updated', { detail: d }));
        }
      }
      break;

    case 'permissions_matrix': {
      const rules = Array.isArray(d) ? d : d.rules;
      const ts = envelope.updatedAt || parseTimestampMs(d?.updatedAt);
      if (Array.isArray(rules) && rules.length > 0) {
        ingestMeshPermissionsMatrix(rules, ts);
      }
      break;
    }

    case 'role_configs': {
      const defs = d?.definitions || d;
      const ts = envelope.updatedAt || parseTimestampMs(d?.updatedAt);
      if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
        ingestMeshRoleDefinitions(defs, ts);
      }
      break;
    }

    case 'multi_currency': {
      const mcConfig = d?.multiCurrencyConfig || d?.exchangeRates || d;
      const ts = envelope.updatedAt || parseTimestampMs(mcConfig?.updatedAt ?? mcConfig?.lastUpdated);
      if (mcConfig && typeof mcConfig === 'object' && mcConfig.rates) {
        ingestMeshMultiCurrencyConfig(mcConfig, ts);
        if (ts > 0) setLastMultiCurrencySync(Math.max(getLastMultiCurrencySync(), ts));
      }
      break;
    }

    case 'customer':
      if (d && (d.customerId || d.id)) {
        const custTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        ingestMeshCustomer({ ...d, isCloudSynced: true, fromMesh: true }, { fromSync: true });
        if (custTime > 0) setLastCustomerSync(Math.max(getLastCustomerSync(), custTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        }
      }
      break;

    case 'branch':
      if (d && isValidBranchRecord(d) && (d.branchId || d.id || d.branch_id || d.BranchID)) {
        const rawBrId = String(d.branchId || d.id || d.branch_id || d.BranchID || 'BR-MAIN').trim();
        const lowerBr = rawBrId.toLowerCase();
        const canonBrId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
        const brTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        const normalized = { ...d, branchId: canonBrId, id: canonBrId, branch_id: canonBrId, isCloudSynced: true, fromMesh: true };
        saveBranch(normalized, { fromSync: true });
        if (brTime > 0) setLastBranchSync(Math.max(getLastBranchSync(), brTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_branches_updated', { detail: normalized }));
        }
      }
      break;

    case 'cash_account':
      if (d && (d.account_id || d.id)) {
        const accTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        saveCashAccount({ ...d, isCloudSynced: true, fromMesh: true }, { fromSync: true });
        if (accTime > 0) setLastCashAccountSync(Math.max(getLastCashAccountSync(), accTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        }
      }
      break;

    case 'supplier':
      if (d && (d.supplierId || d.id || d.SupplierID)) {
        addSupplier(
          {
            ...d,
            supplierId: d.supplierId || d.id || d.SupplierID,
            name: d.name || d.Name || d.SupplierName || '',
            isCloudSynced: true,
          },
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_suppliers_updated', { detail: d }));
        }
      }
      break;

    case 'admin_sales':
      if (d && (d.id || d.staffId)) {
        saveAdminSalesEntry(
          d.date || new Date().toISOString().split('T')[0],
          d.staffId || 'ADMIN',
          d.staffName || 'Admin Sales',
          Number(d.salesAmount || d.amount || 0),
          d.notes || '',
          {
            fromSync: true,
            id: d.id || envelope.entityId,
            timestamp: d.timestamp,
            company_id: compId,
            branch_id: branchId,
          }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_admin_sales_updated', { detail: d }));
        }
      }
      break;

    case 'cash_count':
      if (d && (d.id || d.staffId)) {
        saveFinalCashCount({ ...d, id: d.id || envelope.entityId, company_id: compId, branch_id: branchId }, { fromSync: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cash_counts_updated', { detail: d }));
        }
      }
      break;

    case 'supplier_invoice_voucher':
      if (d && (d.voucherId || d.id)) {
        saveSupplierInvoiceVoucher({ ...d, voucherId: d.voucherId || d.id, isCloudSynced: true }, { fromSync: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_vouchers_updated', { detail: d }));
          window.dispatchEvent(new Event('saimetric_supplier_invoices_updated'));
        }
      }
      break;

    case 'business_day_closure':
      if (d && (d.id || d.date)) {
        saveBusinessDayClosure(
          { ...d, id: d.id || `EOD-${d.date}-${branchId}` },
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_closures_updated', { detail: d }));
        }
      }
      break;

    case 'electronic_settlement':
      if (d && (d.id || d.date)) {
        saveElectronicSettlement(
          { ...d, id: d.id || `SETTLE-${d.date}-${branchId}` },
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_settlements_updated', { detail: d }));
        }
      }
      break;

    case 'inventory_category': {
      const rawCategories = Array.isArray(d) ? d : d?.categories || d?.item || d?.data;
      if (Array.isArray(rawCategories)) {
        const catTombs = getTombstones().filter(
          (t) => normalizeTombstoneEntityType(t.entityType) === 'inventory_category'
        );
        const ts = parseTimestampMs(d?.updatedAt || d?.lastUpdated || envelope.updatedAt || 0);
        const filtered = rawCategories.filter((cat: any) => {
          const cid = String(cat?.categoryId || cat?.id || '').trim().toUpperCase();
          if (!cid) return true;
          const tomb = catTombs.find((t) => String(t.entityId || '').trim().toUpperCase() === cid);
          return !(tomb && Number(tomb.deletedAt || 0) > (parseTimestampMs(cat?.updatedAt) || ts));
        });
        saveCategories(filtered, { fromSync: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_categories_updated', { detail: filtered }));
        }
      }
      break;
    }

    case 'supervisor_approval':
    case 'audit_log':
      if (d) {
        const ingested = ingestMeshSupervisorApproval({ ...d, fromMesh: true } as any);
        if (ingested && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_audit_log_updated', { detail: d }));
        }
      }
      break;

    case 'reconciliation':
      if (d) {
        saveReconciliation(d);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_reconciliations_updated', { detail: d }));
        }
      }
      break;

    case 'system_settings':
      if (d) {
        ingestMeshSettings(d);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_settings_updated', { detail: d }));
        }
      }
      break;

    case 'sheets_config':
      if (d && typeof d === 'object') {
        updateSheetsConfig(d);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_sheets_config_updated', { detail: d }));
        }
      }
      break;

    case 'tombstone':
      if (d && d.entityId && d.entityType) {
        applyTombstone({
          ...d,
          deletedAt: d.deletedAt ?? envelope.updatedAt ?? envelope.hubTimestamp,
        });
      }
      break;

    case 'casual_worker':
      if (Array.isArray(d)) {
        syncCasualWorkersFromHub(d, { fromSync: true });
      } else if (d && typeof d === 'object' && d.id) {
        const existing = getTemporaryCasuals();
        const next = [...existing.filter((c: any) => c.id !== d.id), d];
        syncCasualWorkersFromHub(next, { fromSync: true });
      }
      if (envelope.updatedAt) setLastCasualWorkerSync(Math.max(getLastCasualWorkerSync(), envelope.updatedAt));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_casual_workers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_casuals_updated'));
      }
      break;

    case 'branch_lockdown':
      syncLockdownFromHub({
        branchId: d.branchId || branchId,
        isLocked: Boolean(d.isLocked),
        sessionId: d.sessionId,
        lockedBy: d.lockedBy,
        lockedByName: d.lockedByName,
        lockedAt: d.lockedAt,
        reason: d.reason,
        updatedAt: d.updatedAt || envelope.updatedAt || Date.now(),
        lastUpdated: d.lastUpdated,
      });
      break;

    case 'stocktake_segment': {
      const seg = d?.segment || d;
      if (seg) {
        saveStocktakeSegment(seg, d?.sessionId || seg?.sessionId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
        }
      }
      break;
    }

    case 'stocktake_zone_assignment': {
      if (d && d.zoneId && d.sessionId) {
        saveZoneAssignment(d);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
        }
      }
      break;
    }

    case 'stocktake_zone_claim': {
      const zoneId = d?.zoneId || envelope.entityId;
      updateZoneClaim(
        zoneId,
        d?.slot,
        {
          staffId: d?.staffId,
          staffName: d?.staffName,
          deviceId: d?.deviceId,
          zoneName: d?.zone?.zoneName || d?.zoneName,
          sessionId: d?.sessionId,
        },
        d?.sessionId
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
      }
      break;
    }

    case 'stocktake_count_submission': {
      if (d && d.sessionId && d.zoneId && !d.redactedBlindCount && Array.isArray(d.lines)) {
        saveCountSubmission(
          d.sessionId,
          d.zoneId,
          d.slot || 'A',
          d.lines,
          d.staffId || 'STAFF',
          d.staffName || 'Counter'
        );
      }
      break;
    }

    case 'stocktake_joint_proposal': {
      const zoneId = d?.zoneId || envelope.entityId;
      applyJointRecountSignature(
        d?.sessionId,
        zoneId,
        d?.proposedBySlot || 'A',
        d?.proposedByName || 'Peer Counter',
        d?.recountLines || []
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_joint_proposal', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
      }
      break;
    }

    case 'stocktake_joint_finalized': {
      const zoneId = d?.zoneId || envelope.entityId;
      applyJointRecountSignature(
        d?.sessionId,
        zoneId,
        'BOTH',
        d?.resolvedByName || 'Dual Counters',
        d?.resolvedLines || []
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_match_verified', { detail: { zoneId, verifiedCounts: d?.resolvedLines } }));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: { zoneId, status: 'VERIFIED' } }));
      }
      break;
    }

    case 'stocktake_segment_unlock': {
      if (d?.sessionId && (d?.segmentId || d?.zoneId)) {
        reopenFinalizedSegmentSlot(
          d.sessionId,
          d.segmentId || d.zoneId,
          d.target || 'ALL',
          d.actorId || 'AUDITOR',
          d.actorName || 'Auditor',
          d.reason || 'Cloud synchronized auditor unlock'
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_segment_unlocked', { detail: d }));
        }
      }
      break;
    }

    case 'stocktake_session': {
      const sObj = d?.session && typeof d.session === 'object' ? { ...d, ...d.session } : d;
      const sId = sObj?.sessionId || sObj?.id || envelope.entityId;
      if (sId) {
        ingestStocktakeSessionFromMesh({
          ...sObj,
          sessionId: sId,
          sessionName: sObj?.sessionName || sObj?.title,
          title: sObj?.title || sObj?.sessionName,
          segments: sObj?.segments || [],
          startedBy: sObj?.startedBy || sObj?.createdByName || sObj?.createdBy,
          startedAt: sObj?.startedAt || sObj?.timestamp,
          updatedAt: sObj?.updatedAt || envelope.updatedAt,
        });
        if (envelope.updatedAt) {
          setLastStocktakeSessionSync(Math.max(getLastStocktakeSessionSync(), envelope.updatedAt));
        }
      }
      break;
    }

    default:
      break;
  }
}
