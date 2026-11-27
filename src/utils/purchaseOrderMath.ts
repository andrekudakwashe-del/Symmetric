import { InventoryItem, PurchaseOrderLine } from '../types';
import {
  computeGrvLineCosting,
  formatUnitCost,
  GrvCostEntryMode,
  roundCurrency,
  roundUnitCost,
} from './inventoryMath';

export type PoPackType = 'Cases' | 'Singles';

export interface CatalogPoCostResolution {
  unitsPerCase: number;
  unitCost: number;
  caseCost: number;
}

/**
 * Safely resolves canonical catalog unit cost & case cost for a Purchase Order line.
 * Protects against legacy items where `costPerCase` accidentally stored a single-unit cost
 * while `unitsPerCase > 1`.
 */
export function resolveCatalogPoCosts(item: Partial<InventoryItem> | any): CatalogPoCostResolution {
  const upc = Math.max(1, Math.round(Number(item?.unitsPerCase || 1)) || 1);
  const rawUnit = Number(
    item?.costPerUnit ??
      item?.costPriceUnit ??
      item?.averageCostPerUnit ??
      item?.lastCostPrice ??
      item?.costPrice ??
      0
  );
  const rawCase = Number(item?.costPerCase ?? item?.costPriceCase ?? 0);

  const safeUnit = Number.isFinite(rawUnit) && rawUnit > 0 ? rawUnit : 0;
  const safeCase = Number.isFinite(rawCase) && rawCase > 0 ? rawCase : 0;

  if (safeUnit > 0 && safeCase > 0) {
    // Guard: if a multi-unit product has costPerCase identical to costPerUnit, compute true caseCost from unitCost
    if (upc > 1 && Math.abs(safeCase - safeUnit) < 0.005) {
      return {
        unitsPerCase: upc,
        unitCost: roundUnitCost(safeUnit),
        caseCost: roundUnitCost(safeUnit * upc),
      };
    }
    return {
      unitsPerCase: upc,
      unitCost: roundUnitCost(safeUnit),
      caseCost: roundUnitCost(safeCase),
    };
  }

  if (safeUnit > 0) {
    return {
      unitsPerCase: upc,
      unitCost: roundUnitCost(safeUnit),
      caseCost: roundUnitCost(safeUnit * upc),
    };
  }

  if (safeCase > 0) {
    return {
      unitsPerCase: upc,
      unitCost: roundUnitCost(safeCase / upc),
      caseCost: roundUnitCost(safeCase),
    };
  }

  return {
    unitsPerCase: upc,
    unitCost: 0,
    caseCost: 0,
  };
}

/**
 * Determines the effective pack type label for a Purchase Order line.
 */
export function resolvePoLinePackType(
  line: Pick<PurchaseOrderLine, 'orderAs' | 'orderCases' | 'orderSingles'>
): 'Cases' | 'Singles' | 'Cases+Singles' {
  const cases = Number(line.orderCases || 0);
  const singles = Number(line.orderSingles || 0);
  if (cases > 0 && singles > 0) return 'Cases+Singles';
  if (cases > 0) return 'Cases';
  if (singles > 0) return 'Singles';
  return line.orderAs === 'Singles' ? 'Singles' : 'Cases';
}

export interface ComputePoLineInput {
  orderAs: PoPackType;
  qty: number;
  unitsPerCase: number;
  costEntryMode: GrvCostEntryMode;
  enteredPackCost: number; // cost per Case when orderAs='Cases', cost per Unit when orderAs='Singles'
  enteredLineTotal: number;
}

export interface ComputePoLineResult {
  orderAs: PoPackType;
  orderCases: number;
  orderSingles: number;
  unitsPerCase: number;
  totalUnits: number;
  unitCost: number;
  caseCost: number;
  displayPackCost: number;
  lineTotal: number;
  lineTotalCents: number;
}

/**
 * Canonical Purchase Order line calculation shared with GRV costing math.
 * - In `Singles` mode, `enteredPackCost` is ALWAYS treated as cost per single unit
 *   (NEVER divided by `unitsPerCase`).
 * - In `Cases` mode, `enteredPackCost` is treated as cost per full case and
 *   `unitCost = caseCost / unitsPerCase` (4 decimals).
 * - In `LINE_TOTAL` mode, exact invoice/order line total is preserved and pack/unit
 *   costs are derived cleanly to 4 decimal places.
 */
export function computePurchaseOrderLine(input: ComputePoLineInput): ComputePoLineResult {
  const upc = Math.max(1, Math.round(Number(input.unitsPerCase) || 1));
  const qty = Math.max(0, Number(input.qty) || 0);

  const costing = computeGrvLineCosting({
    receiveAs: input.orderAs,
    qty,
    unitsPerCase: upc,
    costEntryMode: input.costEntryMode,
    enteredUnitOrCaseCost: Math.max(0, Number(input.enteredPackCost) || 0),
    enteredLineTotal: Math.max(0, Number(input.enteredLineTotal) || 0),
  });

  return {
    orderAs: input.orderAs,
    orderCases: costing.receivedCases,
    orderSingles: costing.receivedSingles,
    unitsPerCase: upc,
    totalUnits: Math.round(costing.totalUnits),
    unitCost: costing.costPerUnit,
    caseCost: costing.costPerCase,
    displayPackCost: costing.displayPackCost,
    lineTotal: roundCurrency(costing.lineTotal),
    lineTotalCents: costing.lineTotalCents,
  };
}

/**
 * Formats the accurate unit or case rate string for display on A4, 58mm, and PO detail screens.
 */
export function formatPoLineRateLabel(
  line: Pick<PurchaseOrderLine, 'orderAs' | 'orderCases' | 'orderSingles' | 'unitCost' | 'caseCost'>
): string {
  const packType = resolvePoLinePackType(line);
  if (packType === 'Singles') {
    return `$${formatUnitCost(line.unitCost)}/u`;
  }
  return `$${formatUnitCost(line.caseCost)}/cs`;
}
