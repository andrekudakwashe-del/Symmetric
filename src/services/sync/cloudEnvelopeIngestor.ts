import { SyncEnvelope } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { normalizeTombstoneEntityType } from './syncCore';
import {
  normalizeStockFields,
  resolveItemValuationUnitCost,
  roundUnitCost,
} from '../../utils/inventoryMath';
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
  reconcileCashAccountsFromTransfers,
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
  getStored,
  setStored,
  STORAGE_KEYS,
  updateProductStock,
  getRawStoredDailyBlindConfigs,
  getRawStoredDailyBlindCounts,
  ingestMeshDailyBlindConfig,
  ingestMeshDailyBlindCount,
  getRawStoredPurchaseOrders,
  ingestMeshPurchaseOrder,
} from '../../db/roomDatabase';
import { getMovements, addMovement } from '../../db/cashLedger';
import {
  getWallets,
  saveWallets,
  adjustWalletBalance,
  getWalletTransfers,
  getOwnerDrawings,
  WALLET_STORAGE_KEYS,
  getInternalConsumptions,
  ingestMeshInternalConsumption,
} from '../walletService';
import { payablesLedger } from '../payablesLedger';
import { getAllCustomerLedgerEntries, addCustomerLedgerEntry } from '../../db/customerLedger';
import { getAllTripManifests, saveTripManifest } from '../tripManifestService';
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

export interface CloudEnvelopeApplyOptions {
  /** Default true for cloud pulls; MUST be false for WhatsApp file imports so records flow to Hub/Cloud normally. */
  markCloudSynced?: boolean;
  /** Golden Rule of Balances: if entity already exists locally, IGNORE incoming absolute balance/quantity fields and update metadata only. */
  protectExistingBalances?: boolean;
  /** When true (WhatsApp file imports), newly ingested remote GRVs/GRNs apply their +qty stock delta once (idempotent via referenceId check). */
  applyRemoteT1StockDeltas?: boolean;
  /** Optional callback fired whenever an existing local entity's balance is protected from overwrite. */
  onBalanceProtected?: (entityType: string, entityId: string) => void;
}

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
        const envComp = String(d?.company_id || d?.companyId || envelope.meta?.companyId || '').trim().toUpperCase();
        const found = getRawStoredCashAccounts().find((a: any) => {
          if (String(a.account_id || a.id || '').trim().toUpperCase() !== cleanUpper) return false;
          const accComp = String(a.company_id || a.companyId || '').trim().toUpperCase();
          return !envComp || !accComp || accComp === envComp;
        });
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
      case 'purchase_order': {
        const found = getRawStoredPurchaseOrders().find(
          (p: any) =>
            String(p.id || '').trim().toUpperCase() === cleanUpper ||
            String(p.poNumber || '').trim().toUpperCase() === cleanUpper
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
        const canonBr = (b?: string) => {
          const u = String(b || '').trim().toUpperCase();
          return u === '1' || u === 'BR001' || u === 'BR-001' || u === 'BR-MAIN' || u === 'HQ-01' || u === 'MAIN' ? 'BR-MAIN' : u;
        };
        const targetCanon = canonBr(targetBr);
        const found =
          map[targetBr] ||
          Object.entries(map).find(([k, st]) => st && (canonBr(k) === targetCanon || canonBr(st.branchId) === targetCanon))?.[1];
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return ts > 0 ? { ...found, updatedAt: ts } : undefined;
      }
      case 'casual_worker': {
        const casuals = getTemporaryCasuals();
        const maxTs = Math.max(...casuals.map((c: any) => extractRecordTimestamp(c)), 0);
        return maxTs > 0 ? { updatedAt: maxTs } : undefined;
      }
      case 'stock_batch': {
        const batches = getStored<any[]>(STORAGE_KEYS.STOCK_BATCHES, []);
        const found = batches.find((b: any) => String(b.id || b.batchId || '').trim().toUpperCase() === cleanUpper);
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return { ...found, updatedAt: ts };
      }
      case 'procurement_trip': {
        const found = getAllTripManifests().find(
          (t: any) => String(t.id || t.tripNumber || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return { ...found, updatedAt: ts };
      }
      case 'packaging_variant': {
        const variants = getStored<any[]>('saimetric_packaging_variants', []);
        const found = variants.find((v: any) => String(v.id || '').trim().toUpperCase() === cleanUpper);
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return { ...found, updatedAt: ts };
      }
      case 'company': {
        const companies = getStored<any[]>(STORAGE_KEYS.COMPANIES, []);
        const found = companies.find(
          (c: any) => String(c.company_id || c.id || '').trim().toUpperCase() === cleanUpper
        );
        if (!found) return undefined;
        const ts = extractRecordTimestamp(found);
        return { ...found, updatedAt: ts };
      }
      case 'credit_policy': {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('saimetric_credit_policy') : null;
        if (!raw) return undefined;
        try {
          const parsed = JSON.parse(raw);
          const ts = extractRecordTimestamp(parsed);
          return ts > 0 ? { ...parsed, updatedAt: ts } : undefined;
        } catch {
          return undefined;
        }
      }
      default:
        return undefined;
    }
  }

  switch (envelope.entityType) {
    case 'sale': {
      const existing = getAllSales().find((s: any) => String(s.id || '').trim().toUpperCase() === cleanUpper);
      if (!existing) return undefined;
      const incomingExchanges = Array.isArray(d?.exchanges) ? d.exchanges.length : 0;
      const existingExchanges = Array.isArray((existing as any).exchanges) ? (existing as any).exchanges.length : 0;
      const statusAdvanced =
        (d?.status === 'Refunded' && existing.status !== 'Refunded') ||
        (d?.status === 'Voided' && existing.status !== 'Voided') ||
        (d?.mobileVerificationStatus === 'VERIFIED' && (existing as any).mobileVerificationStatus !== 'VERIFIED') ||
        (d?.mobileVerificationStatus === 'FLAGGED' && (existing as any).mobileVerificationStatus !== 'FLAGGED') ||
        incomingExchanges > existingExchanges;
      if (statusAdvanced) return undefined;
      return existing;
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
      const paymentChanged =
        (d?.paymentStatus && d.paymentStatus !== (existing as any).paymentStatus) ||
        (d?.unpaidBalance !== undefined && Number(d.unpaidBalance) !== Number((existing as any).unpaidBalance)) ||
        (Boolean(d?.paidVoucherId) && d.paidVoucherId !== (existing as any).paidVoucherId);
      const statusChanged =
        (d?.status && d.status !== existing.status) ||
        paymentChanged ||
        envelope.action === 'UPSERT';
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
    case 'cash_count': {
      const existing = getRawStoredCashCounts().find(
        (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const existingTs = Math.max(
        Number((existing as any).updatedAt || 0),
        Date.parse(String((existing as any).lastUpdated || existing.timestamp || '')) || 0
      );
      const incomingTs = Math.max(
        Number(envelope.updatedAt || 0),
        Number(d?.updatedAt || 0),
        Date.parse(String(d?.lastUpdated || d?.timestamp || '')) || 0
      );
      const totalChanged =
        d?.finalCashOutTotal !== undefined &&
        Math.abs(Number(d.finalCashOutTotal) - Number(existing.finalCashOutTotal || 0)) > 0.005;
      const notesChanged = d?.notes !== undefined && String(d.notes || '') !== String(existing.notes || '');
      const denomChanged =
        d?.denominations &&
        JSON.stringify(d.denominations) !== JSON.stringify(existing.denominations || {});
      if (incomingTs > existingTs || totalChanged || notesChanged || denomChanged || envelope.action === 'UPSERT') {
        return incomingTs < existingTs ? existing : undefined;
      }
      return existing;
    }
    case 'supplier_invoice_voucher': {
      const existing = getRawStoredSupplierInvoiceVouchers().find(
        (v: any) => String(v.voucherId || v.id || '').trim().toUpperCase() === cleanUpper
      );
      if (!existing) return undefined;
      const prevPaid = Math.max(Number((existing as any).paidAmount || 0), Number((existing as any).custodyPaidAmount || 0));
      const nextPaid = Math.max(Number(d?.paidAmount || 0), Number(d?.custodyPaidAmount || 0));
      const markedPaid =
        (d?.status === 'PAID' && (existing as any).status !== 'PAID') ||
        (d?.paymentStatus === 'PAID' && (existing as any).paymentStatus !== 'PAID') ||
        (Boolean(d?.paidVoucherId) && !(existing as any).paidVoucherId);
      if (nextPaid > prevPaid || markedPaid || envelope.action === 'UPSERT') {
        return undefined;
      }
      return existing;
    }
    case 'supplier_payable': {
      const existing = payablesLedger
        .getAllPayables()
        .find((p: any) => String(p.id || '').trim().toUpperCase() === cleanUpper);
      if (!existing) return undefined;
      const statusRank = (s?: string) => (s === 'PAID' ? 2 : s === 'PARTIAL' ? 1 : 0);
      if (statusRank(d?.status) > statusRank(existing.status)) return undefined;
      return existing;
    }
    case 'customer_ledger':
      return getAllCustomerLedgerEntries().find(
        (c: any) => String(c.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'wallet_transfer':
      return getWalletTransfers().find(
        (t: any) => String(t.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'owner_drawing':
      return getOwnerDrawings().find(
        (o: any) => String(o.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'business_day_closure':
      return getRawStoredBusinessDayClosures().find(
        (b: any) => String(b.id || '').trim().toUpperCase() === cleanUpper
      );
    case 'electronic_settlement':
      return getStored<any[]>(STORAGE_KEYS.ELECTRONIC_SETTLEMENTS, []).find(
        (e: any) => String(e.id || '').trim().toUpperCase() === cleanUpper
      );
    default:
      return undefined;
  }
}

export function applyCloudEnvelopeToRoomDb(
  envelope: SyncEnvelope,
  _originName: string = 'APPS_SCRIPT_CLOUD',
  options?: CloudEnvelopeApplyOptions
): void {
  if (!envelope || !envelope.entityType) return;
  const d: any = envelope.data || {};
  const compId = d?.company_id || d?.companyId || getCurrentCompanyId() || 'COMP-001';
  const branchId = d?.branch_id || d?.branchId || envelope.targetBranchId || getCurrentBranchId() || 'BR-MAIN';
  const markCloudSynced = options?.markCloudSynced !== false;
  const protectBalances = Boolean(options?.protectExistingBalances);
  const applyRemoteT1StockDeltas = Boolean(options?.applyRemoteT1StockDeltas);

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
      const saleId = String(d.id || d.InvoiceID || d.invoice_id || envelope.entityId || '').trim();
      if (!saleId || !d) return;
      const rawTs = d.timestamp || d.Timestamp || (envelope.updatedAt ? new Date(envelope.updatedAt).toISOString() : new Date().toISOString());
      const derivedDate =
        d.date ||
        d.Date ||
        (typeof rawTs === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawTs)
          ? rawTs.slice(0, 10)
          : new Date().toISOString().split('T')[0]);
      const resolvedTotal = Number(d.total ?? d.Total ?? d.subtotal ?? d.Subtotal ?? 0);
      const resolvedSubtotal = Number(d.subtotal ?? d.Subtotal ?? resolvedTotal);
      const resolvedDiscount = Number(d.discount ?? d.Discount ?? 0);
      const resolvedSummary = String(d.itemsSummary ?? d.ItemsSummary ?? '').trim();
      let resolvedItems = Array.isArray(d.items) ? d.items : [];
      if (resolvedItems.length === 0 && resolvedSummary) {
        // Reconstruct readable line items from legacy ItemsSummary (e.g. "10x Spuds, 2x Milk")
        const parts = resolvedSummary.split(',').map((s: string) => s.trim()).filter(Boolean);
        resolvedItems = parts.map((part: string, idx: number) => {
          const m = part.match(/^(\d+(?:\.\d+)?)\s*x\s*(.+)$/i);
          const qty = m ? Number(m[1]) || 1 : 1;
          const name = m ? m[2].trim() : part;
          const unitPrice = parts.length === 1 && qty > 0 ? Math.round((resolvedSubtotal / qty) * 100) / 100 : 0;
          return {
            id: `LEGACY-ITEM-${saleId}-${idx}`,
            name,
            quantity: qty,
            unitPrice,
            price: unitPrice,
            total: parts.length === 1 ? resolvedSubtotal : 0,
          };
        });
      }
      const resolvedTotalQty = Number(
        d.totalQty ??
          d.TotalQty ??
          (Array.isArray(resolvedItems)
            ? resolvedItems.reduce((sum: number, it: any) => sum + (Number(it?.quantity) || 0), 0)
            : 0)
      );
      const ingested = ingestMeshSale({
        ...d,
        id: saleId,
        date: derivedDate,
        timestamp: rawTs,
        time: d.time || d.Time || '',
        customerId: d.customerId || d.CustomerID || 'C_WALKIN',
        customerName: d.customerName || d.CustomerName || 'Walk-in Customer',
        items: resolvedItems,
        itemsSummary: resolvedSummary || (resolvedItems.length > 0 ? resolvedItems.map((it: any) => `${it.quantity}x ${it.name}`).join(', ') : ''),
        totalQty: resolvedTotalQty,
        subtotal: resolvedSubtotal,
        discount: resolvedDiscount,
        total: resolvedTotal,
        amountTendered: Number(d.amountTendered ?? d.AmountTendered ?? resolvedTotal),
        changeGiven: Number(d.changeGiven ?? d.ChangeGiven ?? 0),
        paymentMethod: d.paymentMethod || d.PaymentMethod || 'Cash',
        currency: d.currency || d.Currency || 'USD',
        exchangeRate: Number(d.exchangeRate ?? d.ExchangeRate ?? d.exchange_rate ?? 1),
        staffId: d.staffId || d.StaffID || 'USR-001',
        staffName: d.staffName || d.StaffName || 'Staff',
        status: d.status || d.Status || 'Completed',
        company_id: compId,
        branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
        isCloudSynced: markCloudSynced,
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
      const resolvedItemId = String(
        d?.itemId || d?.ItemID || d?.ProductID || d?.productId || d?.id || envelope.entityId || ''
      ).trim();
      if (!d || !resolvedItemId) return;
      // Guard against legacy corrupted rows where entityId collided on user_id ("USR-001") without an ItemID
      if (/^USR-/i.test(resolvedItemId) && !d.itemId && !d.ItemID && !d.ProductID) return;
      const existingInv = getRawStoredInventoryItems().find(
        (it: any) => String(it.itemId || it.id || '').trim().toUpperCase() === resolvedItemId.toUpperCase()
      );
      const existingTs = existingInv
        ? Math.max(
            parseTimestampMs((existingInv as any).hubTimestamp),
            parseTimestampMs((existingInv as any).updatedAt),
            parseTimestampMs((existingInv as any).lastUpdated)
          )
        : 0;
      const rawIncomingTs =
        parseTimestampMs(envelope.hubTimestamp ?? envelope.updatedAt ?? d.updatedAt ?? d.lastUpdated ?? d.LastUpdated) ||
        Date.now();
      // Preserve SyncCore-approved writes when version won despite slight clock skew
      const ts = existingInv && protectBalances ? Math.max(rawIncomingTs, existingTs) : rawIncomingTs;
      const unitsPerCase = Math.max(1, Number(d.unitsPerCase ?? d.UnitsPerCase ?? d.CaseSize ?? 1) || 1);
      const sellPriceUnit = Number(
        d.sellPriceUnit ?? d.SellPriceUnit ?? d.SellingPrice ?? d.price ?? 0
      );
      const sellPriceCase = Number(
        d.sellPriceCase ?? d.SellPriceCase ?? sellPriceUnit * unitsPerCase
      );
      const costPerUnit = roundUnitCost(Number(
        d.costPerUnit ?? d.CostPerUnit ?? d.costPriceUnit ?? d.CostPriceUnit ?? d.costPrice ?? d.CostPrice ?? 0
      ));
      const costPerCase = Number(
        d.costPerCase ?? d.CostPerCase ?? d.costPriceCase ?? d.CostPriceCase ?? costPerUnit * unitsPerCase
      );
      const avgUnitCost = roundUnitCost(resolveItemValuationUnitCost({
        averageCostPerUnit: d.averageCostPerUnit ?? d.AverageCostPerUnit ?? (protectBalances ? existingInv?.averageCostPerUnit : undefined),
        costPerUnit,
        costPerCase,
        unitsPerCase,
      }));
      const avgCaseCost = Number(
        d.averageCostPerCase ?? d.AverageCostPerCase ?? Number((avgUnitCost * unitsPerCase).toFixed(2))
      );

      // GOLDEN RULE OF BALANCES:
      // If inventory item ALREADY EXISTS locally during file import, IGNORE incoming stock snapshot & update metadata only!
      const incomingStock = normalizeStockFields({
        stockCases: d.stockCases ?? d.StockCases,
        stockSingles: d.stockSingles ?? d.StockSingles,
        totalUnits: d.totalUnits ?? d.TotalUnits ?? d.stockQuantity ?? d.StockQuantity,
        unitsPerCase,
        canSellAsCase: d.canSellAsCase ?? existingInv?.canSellAsCase,
      });
      let stockCases = incomingStock.stockCases;
      let stockSingles = incomingStock.stockSingles;
      let totalUnits = incomingStock.totalUnits;
      let stockValueCents: number | undefined =
        d.stockValueCents !== undefined && Number.isFinite(Number(d.stockValueCents))
          ? Math.max(0, Math.round(Number(d.stockValueCents)))
          : undefined;
      let safeBranchOverrides = d.branchOverrides;

      if (protectBalances && existingInv) {
        const existingStock = normalizeStockFields({ ...existingInv, unitsPerCase });
        stockCases = existingStock.stockCases;
        stockSingles = existingStock.stockSingles;
        totalUnits = existingStock.totalUnits;
        if (existingInv.stockValueCents !== undefined && Number.isFinite(Number(existingInv.stockValueCents))) {
          stockValueCents = Math.max(0, Math.round(Number(existingInv.stockValueCents)));
        }
        if (existingInv.branchOverrides || d.branchOverrides) {
          const mergedOverrides: Record<string, any> = { ...(existingInv.branchOverrides || {}) };
          if (d.branchOverrides && typeof d.branchOverrides === 'object') {
            for (const [bKey, incomingOv] of Object.entries<any>(d.branchOverrides)) {
              const curOv: any = mergedOverrides[bKey] || {};
              mergedOverrides[bKey] = {
                ...curOv,
                ...incomingOv,
                // Preserve any existing branch-level stock fields
                ...(curOv.totalUnits !== undefined ? { totalUnits: curOv.totalUnits } : {}),
                ...(curOv.stockCases !== undefined ? { stockCases: curOv.stockCases } : {}),
                ...(curOv.stockSingles !== undefined ? { stockSingles: curOv.stockSingles } : {}),
                ...(curOv.stockQuantity !== undefined ? { stockQuantity: curOv.stockQuantity } : {}),
              };
            }
          }
          safeBranchOverrides = mergedOverrides;
        }
        options?.onBalanceProtected?.('inventory_item', resolvedItemId);
      }

      const ingested = ingestMeshInventoryItem({
        ...d,
        id: resolvedItemId,
        itemId: resolvedItemId,
        itemName: d.itemName || d.ItemName || d.name || d.Name || resolvedItemId,
        sku: d.sku ?? d.SKU ?? '',
        barcode: d.barcode ?? d.Barcode ?? '',
        category: d.category || d.Category || 'General',
        unitsPerCase,
        sellPriceUnit,
        sellPriceCase,
        costPerUnit,
        costPerCase,
        averageCostPerUnit: avgUnitCost,
        averageCostPerCase: avgCaseCost,
        latestCostPerUnit: roundUnitCost(Number(d.latestCostPerUnit ?? costPerUnit)),
        latestCostPerCase: Number(d.latestCostPerCase ?? costPerCase),
        ...(stockValueCents !== undefined ? { stockValueCents } : {}),
        stockCases,
        stockSingles,
        totalUnits,
        ...(safeBranchOverrides !== undefined ? { branchOverrides: safeBranchOverrides } : {}),
        reorderLevelUnits: Number(d.reorderLevelUnits ?? d.reorderLevel ?? d.ReorderLevel ?? 5),
        updatedAt: ts,
        hubTimestamp: ts,
        lastUpdated: d.lastUpdated || d.LastUpdated || new Date(ts).toISOString(),
        company_id: compId,
        branch_id: d.branch_id || d.branchId || d.BranchID || 'ALL',
        isCloudSynced: markCloudSynced,
        fromMesh: true,
      });
      if (ingested && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated', { detail: d }));
        window.dispatchEvent(new Event('saimetric_products_updated'));
      }
      break;
    }

    case 'cash_log': {
      const logId = String(d.id || d.LogID || d.logId || envelope.entityId || '').trim();
      if (
        d &&
        ingestMeshCashLog({
          ...d,
          id: logId || undefined,
          timestamp: d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString(),
          date: d.date || d.Date || (typeof (d.timestamp || d.Timestamp) === 'string' ? String(d.timestamp || d.Timestamp).slice(0, 10) : new Date().toISOString().split('T')[0]),
          staffId: d.staffId || d.StaffID || '',
          staffName: d.staffName || d.StaffName || '',
          line: d.line || d.Line || 'Cash',
          description: d.description || d.Description || '',
          in: Number(d.in ?? d.In ?? 0),
          out: Number(d.out ?? d.Out ?? 0),
          reference: d.reference || d.Reference || '',
          category: d.category || d.Category || '',
          company_id: compId,
          branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
          isCloudSynced: markCloudSynced,
          fromMesh: true,
        } as any) &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
      break;
    }

    case 'customer_change': {
      const chgId = String(d.id || d.changeId || d.ChangeID || d.Reference || d.reference || envelope.entityId || '').trim();
      const chgTs = d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString();
      if (
        d &&
        chgId &&
        ingestMeshCustomerChange({
          ...d,
          id: chgId,
          changeId: chgId,
          timestamp: chgTs,
          date: d.date || d.Date || String(chgTs).slice(0, 10),
          staffId: d.staffId || d.StaffID || '',
          staffName: d.staffName || d.StaffName || '',
          customerId: d.customerId || d.CustomerID || '',
          customerName: d.customerName || d.CustomerName || '',
          in: Number(d.in ?? d.In ?? 0),
          out: Number(d.out ?? d.Out ?? 0),
          notes: d.notes || d.Notes || '',
          reference: d.reference || d.Reference || chgId,
          company_id: compId,
          branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
          isCloudSynced: markCloudSynced,
        }) &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('saimetric_customer_changes_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;
    }

    case 'credit_sale': {
      const crId = String(d.id || d.creditId || d.CreditID || envelope.entityId || '').trim();
      const crTs = d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString();
      if (
        d &&
        crId &&
        ingestMeshCreditSale({
          ...d,
          id: crId,
          creditId: crId,
          timestamp: crTs,
          date: d.date || d.Date || String(crTs).slice(0, 10),
          staffId: d.staffId || d.StaffID || '',
          staffName: d.staffName || d.StaffName || '',
          customerId: d.customerId || d.CustomerID || '',
          customerName: d.customerName || d.CustomerName || '',
          amount: Number(d.amount ?? d.Amount ?? 0),
          in: Number(d.in ?? d.In ?? 0),
          out: Number(d.out ?? d.Out ?? d.amount ?? d.Amount ?? 0),
          itemDescription: d.itemDescription || d.ItemDescription || '',
          dueDate: d.dueDate || d.DueDate || '',
          notes: d.notes || d.Notes || '',
          status: d.status || d.Status || 'Outstanding',
          company_id: compId,
          branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
          isCloudSynced: markCloudSynced,
        }) &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('saimetric_credit_sales_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;
    }

    case 'credit_group':
      if (d && ingestMeshCreditGroup({ ...d, isCloudSynced: markCloudSynced }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_credit_groups_updated', { detail: d }));
      }
      break;

    case 'stock_movement':
      if (d && ingestMeshStockMovement({ ...d, isCloudSynced: markCloudSynced }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;

    case 'direct_grv': {
      if (!d) break;
      const grvKey = String(d.grvNumber || d.id || envelope.entityId || '').trim().toUpperCase();
      const alreadyExists = getRawStoredDirectGrvs().some(
        (g: any) => String(g.grvNumber || g.id || '').trim().toUpperCase() === grvKey
      );
      const ingested = ingestMeshGRV({ ...d, isCloudSynced: markCloudSynced, fromMesh: true } as any);
      // Golden Rule T1 Ledger Delta: When a brand-new remote GRV arrives via WhatsApp file, apply its +qty delta ONCE
      if (
        ingested &&
        !alreadyExists &&
        applyRemoteT1StockDeltas &&
        String(d.status || '').toUpperCase() !== 'REJECTED' &&
        Array.isArray(d.items)
      ) {
        const refId = String(d.grvNumber || d.id || '').trim();
        const alreadyHasMov = getRawStoredStockMovements().some(
          (m: any) =>
            refId &&
            (String(m.referenceId || '').trim().toUpperCase() === refId.toUpperCase() ||
              String(m.reference || '').trim().toUpperCase() === refId.toUpperCase())
        );
        if (!alreadyHasMov) {
          for (const line of d.items) {
            const targetItemId = line?.itemId || line?.productId || line?.id;
            const unitsPerCase = Math.max(1, Number(line?.unitsPerCase) || 1);
            const qtyUnits =
              Number(line?.totalUnitsReceived ?? line?.totalUnits ?? line?.quantity) ||
              (Number(line?.casesReceived ?? line?.receivedCases ?? 0) * unitsPerCase +
                Number(line?.singlesReceived ?? line?.receivedSingles ?? 0));
            if (targetItemId && qtyUnits > 0) {
              updateProductStock(targetItemId, qtyUnits, undefined, undefined, {
                staffId: d.receivedById || d.staffId || 'ADMIN',
                staffName: d.receivedBy || d.staffName || 'Remote GRV',
                referenceId: refId,
                reason: `WhatsApp Sync GRV Receipt: +${qtyUnits} ${line.itemName || ''} (GRV #${refId})`,
                actionTaken: 'GRV_RECEIPT',
                txnType: 'ADJUSTMENT',
                fromMesh: true,
              });
            }
          }
        }
      }
      if (ingested && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_direct_grvs_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;
    }

    case 'goods_received': {
      const grnId = String(d.id || d.grnId || d.GRNID || d.reference || envelope.entityId || '').trim();
      const grnTs = d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString();
      if (!d || !grnId) break;
      const alreadyExists = getRawStoredGoodsReceived().some(
        (g: any) => String(g.id || g.grnId || g.reference || '').trim().toUpperCase() === grnId.toUpperCase()
      );
      const ingested = ingestMeshGoodsReceived({
        ...d,
        id: grnId,
        grnId,
        timestamp: grnTs,
        date: d.date || d.Date || String(grnTs).slice(0, 10),
        invoiceNo: d.invoiceNo || d.InvoiceNo || '',
        supplier: d.supplier || d.Supplier || d.supplierName || d.SupplierName || '',
        itemId: d.itemId || d.ItemID || '',
        itemName: d.itemName || d.ItemName || '',
        receivedCases: Number(d.receivedCases ?? d.ReceivedCases ?? 0),
        receivedSingles: Number(d.receivedSingles ?? d.ReceivedSingles ?? 0),
        costPerCase: Number(d.costPerCase ?? d.CostPerCase ?? 0),
        costPerUnit: Number(d.costPerUnit ?? d.CostPerUnit ?? 0),
        lineTotal: Number(d.lineTotal ?? d.LineTotal ?? d.totalAmount ?? d.TotalAmount ?? 0),
        staffId: d.staffId || d.StaffID || '',
        company_id: compId,
        branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
        isCloudSynced: markCloudSynced,
      });
      if (ingested && !alreadyExists && applyRemoteT1StockDeltas) {
        const alreadyHasMov = getRawStoredStockMovements().some(
          (m: any) => String(m.referenceId || m.reference || '').trim().toUpperCase() === grnId.toUpperCase()
        );
        const itemId = d.itemId || d.ItemID;
        if (!alreadyHasMov && itemId) {
          const invMatch = getRawStoredInventoryItems().find((it: any) => it.itemId === itemId || it.id === itemId);
          const upc = Math.max(1, Number(d.unitsPerCase || invMatch?.unitsPerCase || 1));
          const deltaUnits =
            Number(d.totalUnits ?? d.quantity) ||
            Number(d.receivedCases ?? d.ReceivedCases ?? 0) * upc + Number(d.receivedSingles ?? d.ReceivedSingles ?? 0);
          if (deltaUnits > 0) {
            updateProductStock(itemId, deltaUnits, undefined, undefined, {
              staffId: d.staffId || d.StaffID || 'ADMIN',
              staffName: d.staffName || 'Remote GRN',
              referenceId: grnId,
              reason: `WhatsApp Sync GRN Receipt: +${deltaUnits} ${d.itemName || ''} (GRN #${grnId})`,
              actionTaken: 'GRN_RECEIPT',
              txnType: 'ADJUSTMENT',
              fromMesh: true,
            });
          }
        }
      }
      if (ingested && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;
    }

    case 'expense': {
      const expId = String(d.id || d.ExpenseID || d.expenseId || envelope.entityId || '').trim();
      const expTs = d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString();
      if (d && expId) {
        addExpense(
          {
            ...d,
            id: expId,
            timestamp: expTs,
            date: d.date || d.Date || String(expTs).slice(0, 10),
            category: d.category || d.Category || 'General',
            vendorOrCustomer: d.vendorOrCustomer || d.VendorOrCustomer || '',
            amount: Number(d.amount ?? d.Amount ?? 0),
            paymentMethod: d.paymentMethod || d.PaymentMethod || 'Cash',
            staffId: d.staffId || d.StaffID || '',
            staffName: d.staffName || d.StaffName || '',
            description: d.description || d.Description || '',
            receiptRef: d.receiptRef || d.ReceiptRef || '',
            status: d.status || d.Status || 'approved',
            approvedByName: d.approvedByName || d.ApprovedBy || undefined,
            company_id: compId,
            branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
            isCloudSynced: markCloudSynced,
            fromMesh: true,
          } as any,
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      break;
    }

    case 'internal_consumption':
      if (d && d.id && ingestMeshInternalConsumption({ ...d, isCloudSynced: markCloudSynced }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_internal_consumption_updated', { detail: d }));
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      break;

    case 'cash_movement':
      if (d && d.id) {
        const cur = getMovements();
        if (!cur.some((m) => m.id === d.id)) {
          addMovement({ ...d, isCloudSynced: markCloudSynced, fromMesh: true });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          }
        }
      }
      break;

    case 'cash_lift':
      if (d && ingestMeshCashLift({ ...d, isCloudSynced: markCloudSynced }) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      break;

    case 'cash_transfer':
      if (d && ingestMeshCashTransfer({ ...d, isCloudSynced: markCloudSynced }) && typeof window !== 'undefined') {
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
          if (protectBalances) {
            // GOLDEN RULE: Wallet ALREADY EXISTS locally — preserve balance & expectedBalance; update metadata only
            const existingWallet = list[idx];
            list[idx] = {
              ...existingWallet,
              ...d,
              id: targetId as any,
              balance: existingWallet.balance,
              expectedBalance: existingWallet.expectedBalance,
            };
            options?.onBalanceProtected?.('wallet', targetId);
          } else {
            list[idx] = { ...list[idx], ...d, id: targetId as any };
          }
        } else {
          // NEW wallet locally — accept starting balance
          list.push({ ...d, id: targetId as any });
        }
        saveWallets(list);
      }
      break;
    }

    case 'wallet_transfer': {
      const trId = String(d.id || envelope.entityId || '').trim();
      if (d && trId) {
        const list = getWalletTransfers();
        if (!list.some((t) => String(t.id).toUpperCase() === trId.toUpperCase())) {
          const entry = { ...d, id: trId, isCloudSynced: markCloudSynced };
          setStored(WALLET_STORAGE_KEYS.TRANSFERS, [entry, ...list]);
          // Apply T1 wallet transfer delta ONCE
          const amt = Number(d.amount || 0);
          if (amt > 0 && d.fromWalletId && d.toWalletId) {
            adjustWalletBalance(d.fromWalletId, -amt);
            adjustWalletBalance(d.toWalletId, amt);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_wallets_updated'));
          }
        }
      }
      break;
    }

    case 'owner_drawing': {
      const drId = String(d.id || envelope.entityId || '').trim();
      if (d && drId) {
        const list = getOwnerDrawings();
        if (!list.some((o) => String(o.id).toUpperCase() === drId.toUpperCase())) {
          const entry = { ...d, id: drId, isCloudSynced: markCloudSynced };
          setStored(WALLET_STORAGE_KEYS.OWNER_DRAWINGS, [entry, ...list]);
          const amt = Number(d.amount || 0);
          if (amt > 0 && d.walletId) {
            adjustWalletBalance(d.walletId, -amt);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_wallets_updated'));
          }
        }
      }
      break;
    }

    case 'staff':
      if (d && d.id) {
        const staffTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        ingestMeshStaff({ ...d, isCloudSynced: markCloudSynced, fromMesh: true } as any, { fromSync: true });
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

    case 'customer': {
      const custId = String(d?.customerId || d?.CustomerID || d?.id || envelope.entityId || '').trim();
      if (d && custId) {
        const existingCust: any = getRawStoredCustomers().find(
          (c: any) => String(c.customerId || c.id || '').trim().toUpperCase() === custId.toUpperCase()
        );
        const custTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        const payload: any = {
          ...d,
          id: custId,
          customerId: custId,
          name: d.name || d.Name || d.CustomerName || '',
          phone: d.phone ?? d.Phone ?? '',
          email: d.email ?? d.Email ?? '',
          address: d.address ?? d.Address ?? '',
          createdDate: d.createdDate || d.CreatedDate || new Date().toISOString().split('T')[0],
          createdBy: d.createdBy || d.CreatedBy || '',
          company_id: compId,
          branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
          isCloudSynced: markCloudSynced,
          fromMesh: true,
        };
        if (protectBalances && existingCust) {
          // GOLDEN RULE: Preserve existing customer balance/debt/loyalty/store-credit fields; update metadata only
          if (existingCust.currentBalance !== undefined) payload.currentBalance = existingCust.currentBalance;
          if (existingCust.outstandingDebt !== undefined) payload.outstandingDebt = existingCust.outstandingDebt;
          if (existingCust.balance !== undefined) payload.balance = existingCust.balance;
          if (existingCust.loyaltyPoints !== undefined) payload.loyaltyPoints = existingCust.loyaltyPoints;
          if (existingCust.storeCredit !== undefined) payload.storeCredit = existingCust.storeCredit;
          const existingTs = extractRecordTimestamp(existingCust);
          if (existingTs > custTime) payload.updatedAt = existingTs;
          options?.onBalanceProtected?.('customer', custId);
        }
        ingestMeshCustomer(payload, { fromSync: true });
        if (custTime > 0) setLastCustomerSync(Math.max(getLastCustomerSync(), custTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        }
      }
      break;
    }

    case 'branch':
      if (d && isValidBranchRecord(d) && (d.branchId || d.id || d.branch_id || d.BranchID)) {
        const rawBrId = String(d.branchId || d.id || d.branch_id || d.BranchID || 'BR-MAIN').trim();
        const lowerBr = rawBrId.toLowerCase();
        const canonBrId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
        const brTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        const normalized = {
          ...d,
          branchId: canonBrId,
          id: canonBrId,
          branch_id: canonBrId,
          isCloudSynced: markCloudSynced,
          fromMesh: true,
        };
        saveBranch(normalized, { fromSync: true });
        if (brTime > 0) setLastBranchSync(Math.max(getLastBranchSync(), brTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_branches_updated', { detail: normalized }));
        }
      }
      break;

    case 'cash_account':
      if (d && (d.account_id || d.id)) {
        const accId = String(d.account_id || d.id).trim();
        const incComp = String(d.company_id || d.companyId || envelope.meta?.companyId || '').trim().toUpperCase();
        const existingAcc: any = getRawStoredCashAccounts().find((a: any) => {
          if (String(a.account_id || a.id || '').trim().toUpperCase() !== accId.toUpperCase()) return false;
          const aComp = String(a.company_id || a.companyId || '').trim().toUpperCase();
          return !incComp || !aComp || aComp === incComp;
        });
        const accTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
        const accPayload: any = { ...d, isCloudSynced: markCloudSynced, fromMesh: true };
        if (protectBalances && existingAcc) {
          // GOLDEN RULE: Preserve live local CashAccount balance (base USD & native mobile money); update metadata only
          accPayload.current_balance = existingAcc.current_balance;
          if (existingAcc.balance !== undefined) accPayload.balance = existingAcc.balance;
          if (existingAcc.native_balance !== undefined) accPayload.native_balance = existingAcc.native_balance;
          options?.onBalanceProtected?.('cash_account', accId);
        }
        saveCashAccount(accPayload, { fromSync: true });
        try {
          reconcileCashAccountsFromTransfers({ companyId: incComp || undefined, silent: true });
        } catch (_) {}
        if (accTime > 0) setLastCashAccountSync(Math.max(getLastCashAccountSync(), accTime));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        }
      }
      break;

    case 'supplier':
      if (d && (d.supplierId || d.id || d.SupplierID)) {
        const supId = String(d.supplierId || d.id || d.SupplierID).trim();
        const existingSup: any = getRawStoredSuppliers().find(
          (s: any) => String(s.supplierId || s.id || s.SupplierID || '').trim().toUpperCase() === supId.toUpperCase()
        );
        const supPayload: any = {
          ...d,
          supplierId: supId,
          name: d.name || d.Name || d.SupplierName || '',
          isCloudSynced: markCloudSynced,
        };
        if (protectBalances && existingSup) {
          // GOLDEN RULE: Preserve existing supplier balance fields; update supplier directory metadata only
          if (existingSup.balance !== undefined) supPayload.balance = existingSup.balance;
          if (existingSup.outstandingBalance !== undefined) supPayload.outstandingBalance = existingSup.outstandingBalance;
          if (existingSup.currentBalance !== undefined) supPayload.currentBalance = existingSup.currentBalance;
          options?.onBalanceProtected?.('supplier', supId);
        }
        addSupplier(supPayload, { fromSync: true });
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
        saveFinalCashCount(
          { ...d, id: d.id || envelope.entityId, company_id: compId, branch_id: branchId, isCloudSynced: markCloudSynced },
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cash_counts_updated', { detail: d }));
        }
      }
      break;

    case 'supplier_invoice_voucher':
      if (d && (d.voucherId || d.id)) {
        const vId = String(d.voucherId || d.id).trim();
        const existingV: any = getRawStoredSupplierInvoiceVouchers().find(
          (v: any) => String(v.voucherId || v.id || '').trim().toUpperCase() === vId.toUpperCase()
        );
        const voucherPayload: any = { ...d, voucherId: vId, isCloudSynced: markCloudSynced };
        if (protectBalances && existingV) {
          // Monotonic protection: never reduce paidAmount or revert PAID status
          const prevPaid = Number(existingV.paidAmount || 0);
          const nextPaid = Number(d.paidAmount || 0);
          if (nextPaid < prevPaid) {
            voucherPayload.paidAmount = prevPaid;
            if (existingV.balanceDue !== undefined) voucherPayload.balanceDue = existingV.balanceDue;
            if (existingV.remainingBalance !== undefined) voucherPayload.remainingBalance = existingV.remainingBalance;
            voucherPayload.status = existingV.status;
            options?.onBalanceProtected?.('supplier_invoice_voucher', vId);
          }
        }
        saveSupplierInvoiceVoucher(voucherPayload, { fromSync: true });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_vouchers_updated', { detail: d }));
          window.dispatchEvent(new Event('saimetric_supplier_invoices_updated'));
        }
      }
      break;

    case 'supplier_payable': {
      const pId = String(d.id || envelope.entityId || '').trim();
      if (d && pId) {
        const allPayables = payablesLedger.getRawStoredPayables();
        const idx = allPayables.findIndex((p) => String(p.id).toUpperCase() === pId.toUpperCase());
        if (idx >= 0) {
          const existing = allPayables[idx];
          const rank = (s?: string) => (s === 'PAID' ? 2 : s === 'PARTIAL' ? 1 : 0);
          if (protectBalances) {
            // Preserve payable amount; allow monotonic status advancement only
            const nextStatus = rank(d.status) > rank(existing.status) ? d.status : existing.status;
            allPayables[idx] = {
              ...existing,
              dueDate: d.dueDate ?? existing.dueDate,
              status: nextStatus,
              updatedAt: d.updatedAt || existing.updatedAt,
            };
            options?.onBalanceProtected?.('supplier_payable', pId);
          } else {
            allPayables[idx] = { ...existing, ...d, id: pId };
          }
          payablesLedger.saveAllPayables(allPayables);
        } else {
          payablesLedger.saveAllPayables([{ ...d, id: pId }, ...allPayables]);
        }
      }
      break;
    }

    case 'customer_ledger': {
      const clId = String(d.id || envelope.entityId || '').trim();
      if (d && clId) {
        const existing = getAllCustomerLedgerEntries().some(
          (e) => String(e.id).toUpperCase() === clId.toUpperCase()
        );
        if (!existing) {
          addCustomerLedgerEntry({ ...d, id: clId });
        }
      }
      break;
    }

    case 'stock_batch': {
      const bId = String(d.id || d.batchId || envelope.entityId || '').trim();
      if (d && bId) {
        const batches = getStored<any[]>(STORAGE_KEYS.STOCK_BATCHES, []);
        const idx = batches.findIndex((b: any) => String(b.id || b.batchId || '').toUpperCase() === bId.toUpperCase());
        if (idx >= 0) {
          const existing = batches[idx];
          if (protectBalances) {
            // GOLDEN RULE: Preserve live batch remainingUnits/qty; update metadata only
            batches[idx] = {
              ...existing,
              ...d,
              id: bId,
              ...(existing.remainingUnits !== undefined ? { remainingUnits: existing.remainingUnits } : {}),
              ...(existing.quantityRemaining !== undefined ? { quantityRemaining: existing.quantityRemaining } : {}),
              ...(existing.qty !== undefined ? { qty: existing.qty } : {}),
              ...(existing.unitsRemaining !== undefined ? { unitsRemaining: existing.unitsRemaining } : {}),
            };
            options?.onBalanceProtected?.('stock_batch', bId);
          } else {
            batches[idx] = { ...existing, ...d, id: bId };
          }
        } else {
          batches.unshift({ ...d, id: bId });
        }
        setStored(STORAGE_KEYS.STOCK_BATCHES, batches);
      }
      break;
    }

    case 'procurement_trip': {
      const tId = String(d.id || d.tripNumber || envelope.entityId || '').trim();
      if (d && tId) {
        const existing = getAllTripManifests().find(
          (t) => String(t.id || t.tripNumber).toUpperCase() === tId.toUpperCase()
        );
        if (existing && protectBalances) {
          const exStatus = String(existing.status || '').toUpperCase();
          if (exStatus === 'FINALIZED' || exStatus === 'COMPLETED') {
            // Protect finalized procurement trip financial totals from older drafts
            options?.onBalanceProtected?.('procurement_trip', tId);
            break;
          }
        }
        saveTripManifest({ ...d, id: d.id || tId });
      }
      break;
    }

    case 'packaging_variant': {
      const pvId = String(d.id || envelope.entityId || '').trim();
      if (d && pvId) {
        const list = getStored<any[]>('saimetric_packaging_variants', []);
        const idx = list.findIndex((v: any) => String(v.id || '').toUpperCase() === pvId.toUpperCase());
        if (idx >= 0) list[idx] = { ...list[idx], ...d, id: pvId };
        else list.push({ ...d, id: pvId });
        setStored('saimetric_packaging_variants', list);
      }
      break;
    }

    case 'company': {
      const cId = String(d.company_id || d.id || envelope.entityId || '').trim();
      if (d && cId) {
        const normalizedCompany = {
          ...d,
          company_id: cId,
          ...(d.company_name !== undefined && d.company_name !== null ? { company_name: String(d.company_name).trim() } : {}),
          ...(d.owner_email !== undefined && d.owner_email !== null ? { owner_email: String(d.owner_email).trim() } : {}),
          ...(d.owner_name !== undefined && d.owner_name !== null ? { owner_name: String(d.owner_name).trim() } : {}),
          ...(d.phone !== undefined && d.phone !== null ? { phone: String(d.phone) } : {}),
        };
        const list = getStored<any[]>(STORAGE_KEYS.COMPANIES, []);
        const idx = list.findIndex((c: any) => String(c.company_id || c.id || '').toUpperCase() === cId.toUpperCase());
        if (idx >= 0) list[idx] = { ...list[idx], ...normalizedCompany, company_id: cId };
        else list.push(normalizedCompany);
        setStored(STORAGE_KEYS.COMPANIES, list);
      }
      break;
    }

    case 'credit_policy': {
      if (d && typeof d === 'object' && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('saimetric_credit_policy', JSON.stringify(d));
        } catch {}
      }
      break;
    }

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
        const resolvedComp = d.company_id || d.companyId || (envelope as any).companyId || undefined;
        saveElectronicSettlement(
          {
            ...d,
            id: d.id || `SETTLE-${d.date}-${branchId}`,
            ...(resolvedComp ? { companyId: resolvedComp, company_id: resolvedComp } : {}),
          },
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
        // Ignore legacy misrouted inventory/operational payloads that landed in AuditLog before routing fix
        if ((d.ItemID || d.ProductID) && d.ItemName && !d.action && !d.Action) {
          break;
        }
        const ingested = ingestMeshSupervisorApproval({ ...d, fromMesh: true } as any);
        if (ingested && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_audit_log_updated', { detail: d }));
        }
      }
      break;

    case 'reconciliation': {
      if (d) {
        const recId = String(d.id || d.ReconID || d.reconId || envelope.entityId || `REC-${Date.now()}`).trim();
        const recTs = d.timestamp || d.Timestamp || new Date(envelope.updatedAt || Date.now()).toISOString();
        saveReconciliation(
          {
            ...d,
            id: recId,
            timestamp: recTs,
            date: d.date || d.Date || String(recTs).slice(0, 10),
            staffId: d.staffId || d.StaffID || '',
            staffName: d.staffName || d.StaffName || '',
            openingFloat: Number(d.openingFloat ?? d.OpeningFloat ?? 0),
            cashSales: Number(d.cashSales ?? d.CashSales ?? 0),
            otherCashIn: Number(d.otherCashIn ?? d.OtherCashIn ?? 0),
            cashExpenses: Number(d.cashExpenses ?? d.CashExpenses ?? 0),
            bankDrops: Number(d.bankDrops ?? d.BankDrops ?? 0),
            expectedCash: Number(d.expectedCash ?? d.ExpectedCash ?? 0),
            actualCashCount: Number(d.actualCashCount ?? d.ActualCashCount ?? 0),
            variance: Number(d.variance ?? d.Variance ?? 0),
            status: d.status || d.Status || 'submitted',
            notes: d.notes || d.Notes || '',
            company_id: compId,
            branch_id: d.branch_id || d.branchId || d.BranchID || branchId,
          } as any,
          { fromSync: true }
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_reconciliations_updated', { detail: d }));
        }
      }
      break;
    }

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
        if (protectBalances) {
          const existingSession: any = getRawStoredStocktakeSessions().find(
            (s: any) => String(s.sessionId || s.id || '').toUpperCase() === String(sId).toUpperCase()
          );
          const exStatus = String(existingSession?.status || '').toUpperCase();
          if (existingSession && (exStatus === 'FINALIZED' || exStatus === 'COMPLETED' || exStatus === 'APPROVED')) {
            options?.onBalanceProtected?.('stocktake_session', String(sId));
            break;
          }
        }
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

    case 'daily_blind_config': {
      if (d) {
        ingestMeshDailyBlindConfig({
          ...d,
          id: d.id || envelope.entityId,
          updatedAt: d.updatedAt || envelope.updatedAt || Date.now(),
        });
      }
      break;
    }

    case 'daily_blind_count': {
      if (d) {
        const recId = d.id || envelope.entityId;
        if (protectBalances) {
          const existing = getRawStoredDailyBlindCounts().find(
            (r: any) => String(r.id || '').toUpperCase() === String(recId).toUpperCase()
          );
          if (existing && existing.status === 'ARCHIVED' && d.status !== 'ARCHIVED') {
            options?.onBalanceProtected?.('daily_blind_count', String(recId));
            break;
          }
        }
        ingestMeshDailyBlindCount({
          ...d,
          id: recId,
          updatedAt: d.updatedAt || envelope.updatedAt || Date.now(),
        });
      }
      break;
    }

    case 'purchase_order': {
      if (d) {
        const recId = d.id || d.poNumber || envelope.entityId;
        ingestMeshPurchaseOrder({
          ...d,
          id: recId,
          poNumber: d.poNumber || recId,
          updatedAt: d.updatedAt || envelope.updatedAt || Date.now(),
        });
      }
      break;
    }

    default:
      break;
  }
}
