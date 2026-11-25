import {
  getAllSales,
  getRawStoredInventoryItems,
  getRawStoredSalespeople,
  getRawStoredCustomers,
  getAllBranches,
  getRawStoredCashAccounts,
  getMultiCurrencyUpdatedAt,
  getPermissionsMatrixUpdatedAt,
  getCategories,
  getCreditGroups,
  getRawStoredSuppliers,
  getRawStoredStocktakeSessions,
  getRawStoredDailyBlindConfigs,
  getRawStoredDailyBlindCounts,
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
  parseTimestampMs,
  extractRecordTimestamp,
} from '../../db/roomDatabase';
import { getMovements } from '../../db/cashLedger';
import { getInternalConsumptions } from '../walletService';
import { getRoleDefinitionsUpdatedAt } from '../roleNavigationService';
import { SyncEnvelope } from '../sync/SyncEnvelope';
import { ENTITY_REGISTRY } from '../sync/EntityRegistry';

/**
 * Look up existing record in RoomDatabase so SyncCore.ingest() can strictly enforce
 * T1 append-only dedupe and T2 60-second LWW before any write hits the database.
 */
export function lookupExistingRecordForEnvelope(envelope: SyncEnvelope): any {
  const spec = ENTITY_REGISTRY[envelope.entityType];
  if (!spec) return undefined;

  if (envelope.action === 'DELETE') {
    return undefined;
  }

  const cleanId = String(envelope.entityId || '').trim();
  const cleanUpper = cleanId.toUpperCase();
  const data: any = envelope.data || {};

  if (spec.class === 'T2') {
    switch (envelope.entityType) {
      case 'inventory_item': {
        const found = getRawStoredInventoryItems().find(
          (it: any) =>
            String(it.itemId || it.id || '').trim().toUpperCase() === cleanUpper
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
          (c: any) =>
            String(c.customerId || c.id || '').trim().toUpperCase() === cleanUpper
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
          (a: any) =>
            String(a.account_id || a.id || '').trim().toUpperCase() === cleanUpper
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
          ...cats.map((c: any) =>
            parseTimestampMs(c.updatedAt || c.lastUpdated || c.timestamp || 0)
          ),
          0
        );
        return maxTs > 0 ? { updatedAt: maxTs } : undefined;
      }
      case 'credit_group': {
        const found = getCreditGroups().find(
          (g: any) =>
            String(g.id || g.groupId || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'supplier': {
        const found = getRawStoredSuppliers().find(
          (s: any) =>
            String(s.supplierId || s.id || s.SupplierID || '')
              .trim()
              .toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'stocktake_session': {
        const found = getRawStoredStocktakeSessions().find(
          (s: any) =>
            String(s.sessionId || s.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'daily_blind_config': {
        const found = getRawStoredDailyBlindConfigs().find(
          (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'daily_blind_count': {
        const found = getRawStoredDailyBlindCounts().find(
          (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'casual_worker': {
        const casuals = getTemporaryCasuals();
        const maxTs = Math.max(
          ...casuals.map((c: any) => extractRecordTimestamp(c)),
          0
        );
        return maxTs > 0 ? { updatedAt: maxTs } : undefined;
      }
      default:
        return undefined;
    }
  }

  // T1 Append-Only Entities: check existing record, allowing legitimate state transitions
  switch (envelope.entityType) {
    case 'sale': {
      const isSaleUpdate =
        envelope.action === 'UPSERT' ||
        Boolean(envelope.meta?.isSaleUpdate) ||
        data?.status === 'Refunded' ||
        data?.status === 'Voided' ||
        data?.mobileVerificationStatus === 'VERIFIED' ||
        data?.mobileVerificationStatus === 'FLAGGED' ||
        Boolean(data?.hasExchanges);
      if (isSaleUpdate) return undefined;
      return getAllSales().find(
        (s: any) =>
          String(s.id || s.invoice_id || s.invoiceId || s.InvoiceID || s.invoiceNumber || '')
            .trim()
            .toUpperCase() === cleanUpper
      );
    }
    case 'expense': {
      const existing = getRawStoredExpenses().find(
        (e: any) => String(e.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged =
        (data?.status && data.status !== existing.status) ||
        envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'direct_grv': {
      const existing = getRawStoredDirectGrvs().find(
        (g: any) =>
          String(g.id || g.grvNumber || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged =
        (data?.status && data.status !== existing.status) ||
        envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'internal_consumption': {
      const existing = getInternalConsumptions().find(
        (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const statusChanged =
        (data?.status && data.status !== existing.status) ||
        envelope.action === 'UPSERT';
      return statusChanged ? undefined : existing;
    }
    case 'customer_change': {
      const existing = getRawStoredCustomerChanges().find(
        (c: any) =>
          String(c.id || c.changeId || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const sameCustomer =
        !data?.customerId ||
        !existing.customerId ||
        String(data.customerId).trim().toUpperCase() ===
          String(existing.customerId).trim().toUpperCase();
      const sameAmounts =
        Math.abs((Number(data?.in) || 0) - (Number(existing.in) || 0)) < 0.005 &&
        Math.abs((Number(data?.out) || 0) - (Number(existing.out) || 0)) < 0.005;
      const changed =
        !sameCustomer ||
        !sameAmounts ||
        (data?.status && data.status !== (existing as any).status) ||
        envelope.action === 'UPSERT';
      return changed ? undefined : existing;
    }
    case 'credit_sale': {
      const existing = getRawStoredCreditSales().find(
        (c: any) =>
          String(c.id || c.creditId || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const sameCustomer =
        !data?.customerId ||
        !existing.customerId ||
        String(data.customerId).trim().toUpperCase() ===
          String(existing.customerId).trim().toUpperCase();
      const sameAmounts =
        Math.abs(
          (Number(data?.out ?? data?.amount) || 0) -
            (Number((existing as any).out ?? (existing as any).amount) || 0)
        ) < 0.005 &&
        Math.abs((Number(data?.in) || 0) - (Number((existing as any).in) || 0)) <
          0.005;
      const changed =
        !sameCustomer ||
        !sameAmounts ||
        (data?.status && data.status !== (existing as any).status) ||
        (data?.paidAmount !== undefined &&
          data.paidAmount !== (existing as any).paidAmount) ||
        envelope.action === 'UPSERT';
      return changed ? undefined : existing;
    }
    case 'cash_log':
      return getRawStoredCashLogs().find(
        (c: any) =>
          String(c.id || `${c.date}_${c.timestamp}`).trim().toUpperCase() ===
          cleanUpper
      );
    case 'cash_movement':
      return getMovements().find(
        (m: any) => String(m.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'cash_lift':
      return getRawStoredCashLifts().find(
        (l: any) => String(l.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'cash_transfer': {
      const existing = getRawStoredCashTransfers().find(
        (t: any) =>
          String(t.transfer_id || t.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const existingTs = extractRecordTimestamp(existing);
      const incomingTs = envelope.updatedAt || extractRecordTimestamp(data);
      const changed =
        envelope.action === 'UPSERT' ||
        (data?.status && data.status !== (existing as any).status) ||
        (data?.amount !== undefined &&
          Math.abs(Number(data.amount) - Number((existing as any).amount || 0)) >
            0.005) ||
        incomingTs > existingTs;
      return changed ? undefined : existing;
    }
    case 'stock_movement':
      return getRawStoredStockMovements().find(
        (m: any) =>
          String(m.id || m.txnId || m.movementId || '')
            .trim()
            .toUpperCase() === cleanUpper
      );
    case 'goods_received':
      return getRawStoredGoodsReceived().find(
        (g: any) =>
          String(g.id || g.grnId || '').trim().toUpperCase() === cleanUpper
      );
    case 'supervisor_approval':
    case 'audit_log':
      return getRawStoredAuditLogs().find(
        (a: any) => String(a.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'reconciliation': {
      const existing = getRawStoredReconciliations().find(
        (r: any) => String(r.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const existingTs = extractRecordTimestamp(existing);
      const incomingTs = envelope.updatedAt || extractRecordTimestamp(data);
      const changed =
        envelope.action === 'UPSERT' ||
        (data?.status && data.status !== (existing as any).status) ||
        incomingTs > existingTs;
      return changed ? undefined : existing;
    }
    case 'admin_sales':
      return getRawStoredAdminSales().find(
        (a: any) => String(a.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'cash_count': {
      const existing = getRawStoredCashCounts().find(
        (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const existingTs = extractRecordTimestamp(existing);
      const incomingTs = Math.max(
        Number(envelope.updatedAt || 0),
        extractRecordTimestamp(data)
      );
      // Reject strictly older packets so stale replays never overwrite newer edits
      if (existingTs > 0 && incomingTs > 0 && incomingTs < existingTs) {
        return existing;
      }
      const totalChanged =
        data?.finalCashOutTotal !== undefined &&
        Math.abs(
          Number(data.finalCashOutTotal) -
            Number((existing as any).finalCashOutTotal || 0)
        ) > 0.005;
      const notesChanged =
        data?.notes !== undefined &&
        String(data.notes || '') !== String((existing as any).notes || '');
      const denomChanged =
        data?.denominations &&
        JSON.stringify(data.denominations) !==
          JSON.stringify((existing as any).denominations || {});
      const changed =
        envelope.action === 'UPSERT' ||
        incomingTs > existingTs ||
        totalChanged ||
        notesChanged ||
        denomChanged;
      return changed ? undefined : existing;
    }
    case 'supplier_invoice_voucher':
      return getRawStoredSupplierInvoiceVouchers().find(
        (v: any) =>
          String(v.voucherId || v.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'business_day_closure':
      return getRawStoredBusinessDayClosures().find(
        (b: any) => String(b.id || '').trim().toUpperCase() === cleanUpper
      );
    default:
      return undefined;
  }
}
