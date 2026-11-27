import {
  getInventoryItemById,
  saveInventoryItem,
  saveStockBatch,
  getBatchesByItemId,
} from '../db/roomDatabase';
import { StockBatch, InventoryItem } from '../types';
import {
  applyReceiptToValuePool,
  decomposeStockUnits,
  normalizeStockFields,
  resolveItemValuationUnitCost,
  roundUnitCost,
} from '../utils/inventoryMath';

export interface CostingReceiptMeta {
  grnId?: string;
  invoiceNo?: string;
  supplier?: string;
  date?: string;
  batchNumber?: string;
  expiryDate?: string;
  branchId?: string;
  notes?: string;
  costingMethod?: 'last_cost' | 'moving_weighted_average' | 'fifo';
  /** Exact total receipt cost in integer cents (invoice line + allocated landed costs) for zero-penny GL value-pool tracking. */
  lineTotalCents?: number;
  /** Optional exact total receipt cost in dollars (converted to integer cents if lineTotalCents is omitted). */
  lineTotal?: number;
}

/**
 * Costing service supporting Last Cost, Moving Weighted Average, integer-cent Value-Pool tracking, and FIFO batch tracking.
 */
export const costingService = {
  /**
   * Records stock receipt and updates inventory costing & stockValueCents value pool.
   */
  recordReceipt(
    itemId: string,
    quantity: number,
    totalUnitCost: number,
    meta?: CostingReceiptMeta
  ): InventoryItem | null {
    const item = getInventoryItemById(itemId);
    if (!item) {
      console.warn(`[CostingService] Item ${itemId} not found in inventory.`);
      return null;
    }

    const unitsPerCase = Math.max(1, Number(item.unitsPerCase) || 1);
    const now = new Date().toISOString();
    const dateStr = meta?.date || now.split('T')[0];

    const safeReceivedQty = Math.max(0, Number(quantity) || 0);
    const safeUnitCost = roundUnitCost(Math.max(0, Number(totalUnitCost) || 0));

    // Resolve exact integer-cent receipt total (prefer exact invoice+landed cents when provided)
    const receivedTotalCents =
      meta?.lineTotalCents !== undefined && Number.isFinite(Number(meta.lineTotalCents)) && Number(meta.lineTotalCents) >= 0
        ? Math.round(Number(meta.lineTotalCents))
        : meta?.lineTotal !== undefined && Number.isFinite(Number(meta.lineTotal)) && Number(meta.lineTotal) >= 0
        ? Math.round(Number(meta.lineTotal) * 100)
        : Math.round(safeReceivedQty * safeUnitCost * 100);

    // Normalize prior stock & apply receipt to integer-cent value pool (MWAC + zero-penny GL reconciliation)
    const currentStock = normalizeStockFields(item);
    const prevAvgUnitCost = resolveItemValuationUnitCost(item);

    const poolResult = applyReceiptToValuePool({
      prevTotalUnits: currentStock.totalUnits,
      prevStockValueCents: item.stockValueCents,
      prevAvgUnitCost,
      unitsPerCase,
      receivedUnits: safeReceivedQty,
      receivedTotalCents,
      fallbackUnitCost: safeUnitCost,
    });

    const latestCostPerUnit = poolResult.latestCostPerUnit;
    const latestCostPerCase = poolResult.latestCostPerCase;
    const averageCostPerUnit = poolResult.averageCostPerUnit;
    const averageCostPerCase = poolResult.averageCostPerCase;

    // Keep costPerUnit / costPerCase as latest landed cost (4-decimal unit precision) while persisting MWAC + stockValueCents
    const costPerUnit = latestCostPerUnit;
    const costPerCase = latestCostPerCase;

    // Create or append FIFO StockBatch if quantity > 0
    if (safeReceivedQty > 0) {
      const batchId = `BAT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
      const batchNumber = meta?.batchNumber || `BATCH-${dateStr.replace(/-/g, '')}-${item.itemId}`;
      const newBatch: StockBatch = {
        id: batchId,
        batchNumber,
        itemId: item.itemId,
        itemName: item.itemName,
        qtyReceived: safeReceivedQty,
        qtyOnHand: safeReceivedQty,
        cost: Number((receivedTotalCents / 100).toFixed(2)),
        costPerUnit: latestCostPerUnit,
        costPerCase,
        expiryDate: meta?.expiryDate,
        receivedDate: dateStr,
        supplier: meta?.supplier || 'Supplier',
        grnId: meta?.grnId || `GRN-${dateStr}`,
        invoiceNo: meta?.invoiceNo,
        branchId: meta?.branchId || item.branch_id || 'BR-MAIN',
        notes: meta?.notes || `Received ${safeReceivedQty} units at $${latestCostPerUnit.toFixed(4)}/unit`,
        createdAt: now,
      };
      try {
        saveStockBatch(newBatch);
      } catch (e) {
        console.warn('[CostingService] saveStockBatch warning:', e);
      }
    }

    // Update item stock counts canonically (preserving negative debt offset when receiving against negative stock)
    const decomposed = decomposeStockUnits(poolResult.newTotalUnits, unitsPerCase, {
      keepCasesZero: !(item.canSellAsCase && unitsPerCase > 1),
    });

    const updatedItem: InventoryItem = {
      ...item,
      costPerUnit,
      costPerCase,
      averageCostPerUnit,
      averageCostPerCase,
      latestCostPerUnit,
      latestCostPerCase,
      stockValueCents: poolResult.stockValueCents,
      stockCases: decomposed.stockCases,
      stockSingles: decomposed.stockSingles,
      totalUnits: decomposed.totalUnits,
      lastUpdated: now,
    };

    saveInventoryItem(updatedItem);
    return updatedItem;
  },

  /**
   * Calculate moving weighted average cost for an item based on its batches
   */
  calculateWeightedAverageCost(itemId: string): number {
    const batches = getBatchesByItemId(itemId);
    const activeBatches = batches.filter((b) => (b.qtyOnHand || 0) > 0);
    if (activeBatches.length === 0) {
      const item = getInventoryItemById(itemId);
      return resolveItemValuationUnitCost(item);
    }
    const totalCost = activeBatches.reduce((sum, b) => sum + (b.qtyOnHand * (b.costPerUnit || 0)), 0);
    const totalQty = activeBatches.reduce((sum, b) => sum + b.qtyOnHand, 0);
    return totalQty > 0 ? roundUnitCost(totalCost / totalQty) : 0;
  },
};
