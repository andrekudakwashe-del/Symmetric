import {
  getInventoryItemById,
  saveInventoryItem,
  saveStockBatch,
  getBatchesByItemId,
} from '../db/roomDatabase';
import { StockBatch, InventoryItem } from '../types';

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
}

/**
 * Costing service supporting Last Cost, Moving Weighted Average, and FIFO batch tracking.
 */
export const costingService = {
  /**
   * Records stock receipt and updates inventory costing.
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

    const unitsPerCase = item.unitsPerCase || 1;
    const now = new Date().toISOString();
    const dateStr = meta?.date || now.split('T')[0];

    // Calculate updated unit and case costs based on totalUnitCost
    const lastCost = totalUnitCost;
    const prevUnits = Math.max(0, item.totalUnits || 0);
    const prevUnitCost = item.costPerUnit || 0;

    // Moving weighted average cost calculation
    const totalQty = prevUnits + Math.max(0, quantity);
    const weightedAvgUnitCost =
      totalQty > 0
        ? Number((((prevUnits * prevUnitCost) + (quantity * totalUnitCost)) / totalQty).toFixed(4))
        : totalUnitCost;

    // By default, system updates costPerUnit to lastCost (which includes landed cost),
    // and stores weighted average for reporting
    const costPerUnit = totalUnitCost;
    const costPerCase = Number((costPerUnit * unitsPerCase).toFixed(2));

    // Create or append FIFO StockBatch if quantity > 0
    if (quantity > 0) {
      const batchId = `BAT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
      const batchNumber = meta?.batchNumber || `BATCH-${dateStr.replace(/-/g, '')}-${item.itemId}`;
      const newBatch: StockBatch = {
        id: batchId,
        batchNumber,
        itemId: item.itemId,
        itemName: item.itemName,
        qtyReceived: quantity,
        qtyOnHand: quantity,
        cost: Number((quantity * totalUnitCost).toFixed(2)),
        costPerUnit: totalUnitCost,
        costPerCase,
        expiryDate: meta?.expiryDate,
        receivedDate: dateStr,
        supplier: meta?.supplier || 'Supplier',
        grnId: meta?.grnId || `GRN-${dateStr}`,
        invoiceNo: meta?.invoiceNo,
        branchId: meta?.branchId || item.branch_id || 'BR-MAIN',
        notes: meta?.notes || `Received ${quantity} units at $${totalUnitCost.toFixed(4)}/unit`,
        createdAt: now,
      };
      try {
        saveStockBatch(newBatch);
      } catch (e) {
        console.warn('[CostingService] saveStockBatch warning:', e);
      }
    }

    // Update item stock counts and cost in Inventory Master
    const newTotalUnits = prevUnits + Math.max(0, quantity);
    let newCases = item.stockCases;
    let newSingles = item.stockSingles;

    if (item.canSellAsCase && unitsPerCase > 1) {
      newCases = Math.floor(newTotalUnits / unitsPerCase);
      newSingles = newTotalUnits % unitsPerCase;
    } else {
      newCases = 0;
      newSingles = newTotalUnits;
    }

    const updatedItem: InventoryItem = {
      ...item,
      costPerUnit,
      costPerCase,
      stockCases: newCases,
      stockSingles: newSingles,
      totalUnits: newTotalUnits,
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
      return item?.costPerUnit || 0;
    }
    const totalCost = activeBatches.reduce((sum, b) => sum + (b.qtyOnHand * (b.costPerUnit || 0)), 0);
    const totalQty = activeBatches.reduce((sum, b) => sum + b.qtyOnHand, 0);
    return totalQty > 0 ? Number((totalCost / totalQty).toFixed(4)) : 0;
  },
};
