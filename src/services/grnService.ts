import {
  GoodsReceivedNote,
  DirectGrv,
  SupplierInvoiceVoucher,
  CashMovement,
  LandedCostItem,
} from '../types';
import { landedCostService } from './landedCostService';
import { costingService } from './costingService';
import { payablesLedger } from './payablesLedger';
import {
  addMovement,
  updateMovement,
  getAllMovements,
  getShiftId,
} from '../db/cashLedger';
import {
  saveGoodsReceivedNote,
  directGrvToGrn,
  grnToDirectGrv,
  supplierInvoiceToGrn,
  grnToSupplierInvoice,
  getAllGoodsReceivedNotes,
} from '../db/goodsReceivedNotes';
import {
  getCurrentCompanyId,
  getCurrentBranchId,
  getDirectGrvById,
  saveDirectGrv,
  getAllDirectGrvs,
} from '../db/roomDatabase';

export interface PostGrnOptions {
  sourceTemplate?: 'direct_delivery' | 'general_grv';
  paymentMode?: 'cash_immediate' | 'credit_account' | 'already_paid';
  requiresApproval?: boolean;
}

/**
 * Unified posting function for all Goods Received Notes.
 * Handles:
 * 1. Landed cost allocation (no-op if grn.landedCosts is empty)
 * 2. Inventory cost update via costingService
 * 3. Cash handling (byte-identical supplier_payment movement via cashLedger.addMovement)
 * 4. Payables generation for credit accounts
 * 5. Status management and persistence
 */
export function postGRN(grn: GoodsReceivedNote): GoodsReceivedNote {
  // 1. Landed cost allocation (no-op if grn.landedCosts is empty)
  if (grn.landedCosts && grn.landedCosts.length > 0) {
    landedCostService.allocateLandedCosts(grn);
  } else {
    // Recompute standard totals if landed costs not provided
    const subtotal = (grn.lineItems || []).reduce(
      (sum, it) => sum + (it.subtotal || it.quantity * it.unitCost),
      0
    );
    const totalQuantity = (grn.lineItems || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
    grn.totals = {
      subtotal: Number(subtotal.toFixed(2)),
      totalLandedCosts: 0,
      totalInventoryValue: Number(subtotal.toFixed(2)),
      totalQuantity,
    };
  }

  // 2. Inventory cost update (unchanged from existing behavior)
  for (const item of grn.lineItems) {
    if (item.quantity > 0) {
      costingService.recordReceipt(item.itemId, item.quantity, item.totalUnitCost || item.unitCost, {
        grnId: grn.grnNumber,
        invoiceNo: grn.paymentRef || grn.grnNumber,
        supplier: grn.suppliers[0] || 'Supplier',
        date: grn.dateReceived,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        branchId: grn.branchId,
        notes: grn.notes,
      });
    }
  }

  // 3. Cash handling (must be BYTE-IDENTICAL to existing behavior)
  if (grn.paymentMode === 'cash_immediate') {
    const shiftDate = grn.dateReceived || new Date().toISOString().split('T')[0];
    const compId = grn.company_id || grn.companyId || getCurrentCompanyId();
    const brId = grn.branch_id || grn.branchId || getCurrentBranchId();
    const now = grn.createdAt || new Date().toISOString();

    const initialMovementStatus =
      grn.status === 'APPROVED' ? 'approved' : grn.requiresApproval ? 'pending' : 'approved';

    // If payments breakdown exists in raw record, respect each individual till payout
    const payments =
      grn._rawDirectGrv?.payments && grn._rawDirectGrv.payments.length > 0
        ? grn._rawDirectGrv.payments
        : [
            {
              userId: grn.receivedBy || 'USR-003',
              userName: grn.receivedBy || 'Cashier',
              amount: grn.totals.totalInventoryValue,
              drawerId: 'Till 1',
              pinConfirmed: true,
              confirmedAt: now,
            },
          ];

    const existingMovements = getAllMovements();
    let primaryMovementId: string | undefined;

    payments.forEach((p, pIdx) => {
      const pAmount = Number(p.amount) || 0;
      if (pAmount <= 0) return;

      const staffShiftId = getShiftId(p.userId, shiftDate);
      const voucherKey = payments.length > 1 ? `${grn.grnNumber}-P${pIdx + 1}` : grn.grnNumber;

      const existingM = existingMovements.find(
        (m) =>
          m.type === 'supplier_payment' &&
          (m.sourceRef === grn.grnNumber ||
            m.sourceRef === voucherKey ||
            m.sourceRef === grn.id ||
            (m.notes && m.notes.includes(grn.grnNumber)))
      );

      if (existingM) {
        primaryMovementId = existingM.id;
        updateMovement(existingM.id, {
          amount: pAmount,
          status: initialMovementStatus,
          affectsDrawer: true,
          direction: 'out',
        });
      } else {
        const createdM = addMovement({
          shiftId: staffShiftId,
          staffId: p.userId,
          terminalId: p.drawerId || 'Till 1',
          date: shiftDate,
          timestamp: now,
          type: 'supplier_payment',
          amount: pAmount,
          currency: 'USD',
          direction: 'out',
          affectsDrawer: true,
          status: initialMovementStatus,
          sourceModule: 'DirectGRV',
          sourceRef: grn.grnNumber,
          notes: `Direct Supplier Delivery: ${grn.suppliers.join(', ')} (${grn.grnNumber})`,
          company_id: compId,
          branch_id: brId,
        });
        if (!primaryMovementId) {
          primaryMovementId = createdM.id;
        }
      }
    });

    grn.cashMovementId = primaryMovementId;
  }

  if (grn.paymentMode === 'credit_account') {
    grn.payableId = payablesLedger.createPayable({
      grnId: grn.id,
      amount: grn.totals.totalInventoryValue,
      dueDate: grn.dueDate,
    });
  }

  // 4. Status
  if (!grn.status || grn.status === 'DRAFT') {
    grn.status = grn.requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED';
  }

  saveGoodsReceivedNote(grn);
  return grn;
}

/**
 * Thin wrapper for posting Direct Delivery via postGRN
 */
export function postDirectDelivery(dd: DirectGrv): DirectGrv {
  const grn = directGrvToGrn(dd);
  grn.sourceTemplate = 'direct_delivery';
  grn.paymentMode = 'cash_immediate';
  grn.requiresApproval = dd.status !== 'APPROVED';
  
  const postedGrn = postGRN(grn);
  return grnToDirectGrv(postedGrn);
}

/**
 * Thin wrapper for posting General GRV via postGRN
 */
export function postGeneralGRV(
  g: SupplierInvoiceVoucher,
  landedCosts?: LandedCostItem[]
): SupplierInvoiceVoucher {
  const grn = supplierInvoiceToGrn(g);
  grn.sourceTemplate = 'general_grv';
  const isPaid = (g.paymentTerms || '').toLowerCase().includes('paid');
  grn.paymentMode = isPaid ? 'already_paid' : 'credit_account';
  grn.requiresApproval = false;
  grn.status = 'APPROVED';
  if (landedCosts && landedCosts.length > 0) {
    grn.landedCosts = landedCosts;
  }

  const postedGrn = postGRN(grn);
  return grnToSupplierInvoice(postedGrn);
}

/**
 * Approval flip:
 * When supervisor approves a GRN:
 * - Update grn.status -> 'APPROVED'
 * - Update linked cashMovement's status -> 'approved' (so it contributes to computeExpectedCash)
 * - Do not create a new movement; flip the existing one
 */
export function approveGRN(
  id: string,
  approverId: string,
  approverName: string
): { success: boolean; message: string; grn?: GoodsReceivedNote } {
  const allGrns = getAllGoodsReceivedNotes();
  const grn = allGrns.find((g) => g.id === id || g.grnNumber === id);
  if (!grn) {
    return { success: false, message: 'GRN not found.' };
  }
  if (grn.status === 'APPROVED') {
    return { success: false, message: 'GRN is already approved.', grn };
  }

  const now = new Date().toISOString();
  grn.status = 'APPROVED';
  grn.approvedBy = approverName || approverId;
  grn.updatedAt = now;

  // Flip linked cash movement to 'approved'
  const movements = getAllMovements();
  let flipped = false;

  if (grn.cashMovementId) {
    const linked = movements.find((m) => m.id === grn.cashMovementId);
    if (linked) {
      updateMovement(linked.id, { status: 'approved' });
      flipped = true;
    }
  }

  if (!flipped) {
    // Fallback: search by sourceRef or grnNumber
    const fallbackM = movements.find(
      (m) =>
        m.type === 'supplier_payment' &&
        (m.sourceRef === grn.grnNumber || (m.notes && m.notes.includes(grn.grnNumber)))
    );
    if (fallbackM) {
      updateMovement(fallbackM.id, { status: 'approved' });
      grn.cashMovementId = fallbackM.id;
    }
  }

  saveGoodsReceivedNote(grn);
  return { success: true, message: 'GRN approved successfully.', grn };
}
