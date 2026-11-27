import { InventoryItem } from '../types';

export interface CanonicalStockBreakdown {
  stockCases: number;
  stockSingles: number;
  totalUnits: number;
  unitsPerCase: number;
}

export interface PortfolioValuationSummary<T extends Partial<InventoryItem> = InventoryItem> {
  totalValuationCents: number;
  totalValuationDollars: number;
  positiveCases: number;
  positiveSingles: number;
  positiveTotalUnits: number;
  negativeSkuCount: number;
  negativeTotalUnits: number;
  negativeExposureCents: number;
  negativeExposureDollars: number;
  negativeItems: T[];
}

export type GrvCostEntryMode = 'LINE_TOTAL' | 'UNIT_COST';

export interface GrvLineCostingInput {
  receiveAs: 'Cases' | 'Singles' | 'Variant';
  qty: number;
  unitsPerCase: number;
  variantUnitsPerPack?: number;
  costEntryMode: GrvCostEntryMode;
  enteredUnitOrCaseCost: number;
  enteredLineTotal: number;
  allocatedLandedCost?: number;
}

export interface GrvLineCostingResult {
  receivedCases: number;
  receivedSingles: number;
  totalUnits: number;
  lineTotalCents: number;
  lineTotal: number;
  allocatedLandedCents: number;
  totalLineCents: number;
  totalLineCost: number;
  costPerUnit: number;
  costPerCase: number;
  displayPackCost: number;
  landedCostPerUnit: number;
  totalUnitCost: number;
  totalCaseCost: number;
}

const EPSILON = 0.001;

export const roundStockUnits = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Rounds a unit cost to 4 decimal places (sub-cent precision, e.g. $0.0417).
 */
export const roundUnitCost = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Rounds a currency amount to 2 decimal places (cents).
 */
export const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Formats a unit cost with 2–4 decimal places so whole-cent costs display cleanly ($1.50)
 * while sub-cent unit costs preserve full 4-decimal precision ($0.0417, $0.3333, $1.255).
 */
export const formatUnitCost = (
  value: unknown,
  options?: { minDecimals?: number; maxDecimals?: number; fixed?: boolean }
): string => {
  const num = Number(value);
  const minDec = options?.minDecimals ?? 2;
  const maxDec = options?.maxDecimals ?? 4;
  if (!Number.isFinite(num)) return (0).toFixed(minDec);
  const rounded = roundUnitCost(num);
  if (options?.fixed) {
    return rounded.toFixed(maxDec);
  }
  const fixed4 = rounded.toFixed(maxDec);
  // Trim trailing zeros beyond minDecimals
  let trimmed = fixed4;
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx >= 0) {
    while (trimmed.length - dotIdx - 1 > minDec && trimmed.endsWith('0')) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
};

/**
 * Sanitizes free-typed decimal input while preserving trailing dot and up to maxDecimals digits.
 */
export const sanitizeDecimalInput = (raw: string, maxDecimals = 4): string => {
  let clean = String(raw ?? '').replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  if (parts.length > 2) {
    clean = parts[0] + '.' + parts.slice(1).join('');
  }
  const [intPart, decPart] = clean.split('.');
  if (decPart !== undefined && decPart.length > maxDecimals) {
    return `${intPart}.${decPart.slice(0, maxDecimals)}`;
  }
  return clean;
};

/**
 * Canonical "One Number, Two Views" decomposition:
 * - Invariant: totalUnits === (stockCases * unitsPerCase) + stockSingles
 * - Negative stock rule: whenever totalUnits < 0, stockCases MUST be 0 and stockSingles === totalUnits.
 *   (e.g. -19 units is always 0 cases, -19 singles — never -1 case, +5 singles).
 */
export const decomposeStockUnits = (
  totalUnits: number,
  unitsPerCase: number,
  options?: { keepCasesZero?: boolean }
): { stockCases: number; stockSingles: number; totalUnits: number } => {
  const upc = Math.max(1, Number(unitsPerCase) || 1);
  const total = roundStockUnits(Number(totalUnits) || 0);

  if (total < 0) {
    return {
      stockCases: 0,
      stockSingles: total,
      totalUnits: total,
    };
  }

  if (upc <= 1 || options?.keepCasesZero) {
    return {
      stockCases: 0,
      stockSingles: total,
      totalUnits: total,
    };
  }

  const stockCases = Math.floor(total / upc);
  const stockSingles = roundStockUnits(total - stockCases * upc);
  return {
    stockCases,
    stockSingles,
    totalUnits: roundStockUnits(stockCases * upc + stockSingles),
  };
};

/**
 * Normalizes any raw inventory record into a mathematically consistent
 * { stockCases, stockSingles, totalUnits, unitsPerCase } tuple.
 *
 * - Preserves intentional non-negative case-break splits (e.g. 1 case + 15 singles = 27 totalUnits)
 *   when stockCases >= 0, stockSingles >= 0, and stockCases * upc + stockSingles === totalUnits.
 * - Self-heals Hub double-count corruption (where Hub updated totalUnits & stockSingles without
 *   recomputing stale stockCases) by decomposing from authoritative totalUnits.
 * - Enforces the negative stock rule (stockCases = 0, stockSingles = totalUnits) whenever totalUnits < 0.
 */
export const normalizeStockFields = (raw: {
  stockCases?: unknown;
  stockSingles?: unknown;
  totalUnits?: unknown;
  stockQuantity?: unknown;
  unitsPerCase?: unknown;
  UnitsPerCase?: unknown;
  canSellAsCase?: unknown;
}): CanonicalStockBreakdown => {
  const upc = Math.max(1, Number(raw?.unitsPerCase ?? raw?.UnitsPerCase ?? 1) || 1);

  const hasCases = raw?.stockCases !== undefined && raw?.stockCases !== null && raw?.stockCases !== '';
  const hasSingles = raw?.stockSingles !== undefined && raw?.stockSingles !== null && raw?.stockSingles !== '';
  const rawTotalCandidate =
    raw?.totalUnits !== undefined && raw?.totalUnits !== null && raw?.totalUnits !== ''
      ? raw.totalUnits
      : raw?.stockQuantity;
  const hasTotal = rawTotalCandidate !== undefined && rawTotalCandidate !== null && rawTotalCandidate !== '';

  const rawCases = hasCases ? Number(raw.stockCases) : NaN;
  const rawSingles = hasSingles ? Number(raw.stockSingles) : NaN;
  const rawTotal = hasTotal ? Number(rawTotalCandidate) : NaN;

  const casesFinite = Number.isFinite(rawCases);
  const singlesFinite = Number.isFinite(rawSingles);
  const totalFinite = Number.isFinite(rawTotal);

  if (casesFinite && singlesFinite && rawCases >= 0 && rawSingles >= 0) {
    const pairSum = roundStockUnits(rawCases * upc + rawSingles);
    if (!totalFinite || Math.abs(pairSum - rawTotal) < EPSILON) {
      return {
        stockCases: roundStockUnits(rawCases),
        stockSingles: roundStockUnits(rawSingles),
        totalUnits: pairSum,
        unitsPerCase: upc,
      };
    }
  }

  const resolvedTotal = totalFinite
    ? roundStockUnits(rawTotal)
    : roundStockUnits((casesFinite ? rawCases : 0) * upc + (singlesFinite ? rawSingles : 0));

  const keepCasesZero = upc <= 1 || (raw?.canSellAsCase === false && (!casesFinite || rawCases <= 0));
  const decomposed = decomposeStockUnits(resolvedTotal, upc, { keepCasesZero });

  return {
    ...decomposed,
    unitsPerCase: upc,
  };
};

/**
 * Resolves the canonical Moving Weighted Average Cost (MWAC) per unit for valuation (up to 4 decimals).
 * Falls back cleanly to latest costPerUnit, then costPerCase / unitsPerCase, then 0.
 */
export const resolveItemValuationUnitCost = (
  item: Partial<InventoryItem> | null | undefined
): number => {
  if (!item) return 0;
  const avg = Number(item.averageCostPerUnit);
  if (Number.isFinite(avg) && avg > 0) return roundUnitCost(avg);

  const cpu = Number(item.costPerUnit);
  if (Number.isFinite(cpu) && cpu > 0) return roundUnitCost(cpu);

  const cpc = Number(item.costPerCase);
  const upc = Math.max(1, Number(item.unitsPerCase) || 1);
  if (Number.isFinite(cpc) && cpc > 0) return roundUnitCost(cpc / upc);

  return 0;
};

/**
 * Resolves the authoritative integer-cent inventory value pool for a positive-stock SKU.
 * - When `stockValueCents` is tracked on the item, uses it directly for zero-penny GL reconciliation.
 * - Falls back cleanly to `Math.round(totalUnits * unitCost * 100)` for legacy items without a pool.
 * - Always returns 0 when `totalUnits <= 0`.
 */
export const resolveItemStockValueCents = (
  item: Partial<InventoryItem> | null | undefined
): number => {
  if (!item) return 0;
  const { totalUnits } = normalizeStockFields(item);
  if (totalUnits <= 0) return 0;

  const unitCost = resolveItemValuationUnitCost(item);
  const rawPool = item.stockValueCents;
  if (rawPool !== undefined && rawPool !== null && rawPool !== '') {
    const poolCents = Math.round(Number(rawPool));
    if (Number.isFinite(poolCents) && poolCents >= 0) {
      // Guard against legacy zero-initialized pool when item has positive stock and positive cost
      if (poolCents === 0 && unitCost > 0) {
        return Math.round(totalUnits * unitCost * 100);
      }
      return poolCents;
    }
  }

  return Math.round(totalUnits * unitCost * 100);
};

/**
 * Applies a stock receipt (GRV, Direct GRV, or CostingService receipt) to an item's
 * integer-cent value pool (`stockValueCents`) and derives exact 4-decimal MWAC unit cost.
 *
 * Zero-penny reconciliation guarantee:
 * - For non-negative prior stock, `nextStockValueCents = prevStockValueCents + receivedTotalCents`
 *   using exact integer cents from the supplier invoice line (+ allocated landed costs).
 * - For negative prior stock, only the surplus positive units remaining after clearing the
 *   negative balance populate `stockValueCents` so negative balances never corrupt valuation.
 */
export const applyReceiptToValuePool = (params: {
  prevTotalUnits: number;
  prevStockValueCents?: number;
  prevAvgUnitCost: number;
  unitsPerCase: number;
  receivedUnits: number;
  receivedTotalCents: number;
  fallbackUnitCost?: number;
}): {
  newTotalUnits: number;
  stockValueCents: number;
  averageCostPerUnit: number;
  averageCostPerCase: number;
  latestCostPerUnit: number;
  latestCostPerCase: number;
} => {
  const upc = Math.max(1, Number(params.unitsPerCase) || 1);
  const prevTotal = roundStockUnits(Number(params.prevTotalUnits) || 0);
  const recQty = roundStockUnits(Math.max(0, Number(params.receivedUnits) || 0));
  const recCents = Math.max(0, Math.round(Number(params.receivedTotalCents) || 0));
  const prevAvg = Math.max(0, Number(params.prevAvgUnitCost) || 0);
  const fallbackUnit = Math.max(0, Number(params.fallbackUnitCost) || 0);

  const latestCostPerUnit =
    recQty > 0 && recCents > 0
      ? roundUnitCost(recCents / 100 / recQty)
      : roundUnitCost(fallbackUnit > 0 ? fallbackUnit : prevAvg);
  const latestCostPerCase = roundCurrency(latestCostPerUnit * upc);

  const newTotalUnits = roundStockUnits(prevTotal + recQty);

  const hasValidPrevPool =
    params.prevStockValueCents !== undefined &&
    params.prevStockValueCents !== null &&
    Number.isFinite(Number(params.prevStockValueCents)) &&
    Number(params.prevStockValueCents) >= 0 &&
    !(Number(params.prevStockValueCents) === 0 && prevTotal > 0 && prevAvg > 0);

  let nextPoolCents = 0;
  let averageCostPerUnit = latestCostPerUnit;

  if (prevTotal >= 0) {
    const prevPoolCents =
      prevTotal > 0
        ? hasValidPrevPool
          ? Math.round(Number(params.prevStockValueCents))
          : Math.round(prevTotal * prevAvg * 100)
        : 0;
    nextPoolCents = prevPoolCents + recCents;
    if (newTotalUnits > 0 && nextPoolCents > 0) {
      averageCostPerUnit = roundUnitCost(nextPoolCents / 100 / newTotalUnits);
    } else if (newTotalUnits > 0) {
      averageCostPerUnit = roundUnitCost(prevAvg > 0 ? prevAvg : latestCostPerUnit);
    } else {
      nextPoolCents = 0;
      averageCostPerUnit = roundUnitCost(latestCostPerUnit > 0 ? latestCostPerUnit : prevAvg);
    }
  } else {
    // Prior stock was negative: incoming units first clear the negative debt
    if (newTotalUnits <= 0) {
      nextPoolCents = 0;
      averageCostPerUnit = roundUnitCost(latestCostPerUnit > 0 ? latestCostPerUnit : prevAvg);
    } else {
      // Only the positive surplus units remain on the balance sheet
      nextPoolCents = recQty > 0 ? Math.round((recCents * newTotalUnits) / recQty) : 0;
      averageCostPerUnit =
        nextPoolCents > 0
          ? roundUnitCost(nextPoolCents / 100 / newTotalUnits)
          : roundUnitCost(latestCostPerUnit > 0 ? latestCostPerUnit : prevAvg);
    }
  }

  return {
    newTotalUnits,
    stockValueCents: Math.max(0, Math.round(nextPoolCents)),
    averageCostPerUnit,
    averageCostPerCase: roundCurrency(averageCostPerUnit * upc),
    latestCostPerUnit,
    latestCostPerCase,
  };
};

/**
 * Applies a stock outflow (POS sale, manual removal, damage/loss, exchange replacement)
 * to an item's integer-cent value pool (`stockValueCents`).
 *
 * Zero-penny reconciliation guarantee:
 * - Partial outflows deduct proportional exact cents from the value pool.
 * - Depleting stock to 0 releases ALL remaining pool cents cleanly so zero penny dust remains.
 */
export const applyOutflowToValuePool = (params: {
  prevTotalUnits: number;
  prevStockValueCents?: number;
  prevAvgUnitCost: number;
  deductedUnits: number;
}): {
  newTotalUnits: number;
  stockValueCents: number;
  cogsCents: number;
  unitCostUsed: number;
} => {
  const prevTotal = roundStockUnits(Number(params.prevTotalUnits) || 0);
  const deduct = roundStockUnits(Math.max(0, Number(params.deductedUnits) || 0));
  const prevAvg = Math.max(0, Number(params.prevAvgUnitCost) || 0);
  const newTotalUnits = roundStockUnits(prevTotal - deduct);

  const hasValidPrevPool =
    params.prevStockValueCents !== undefined &&
    params.prevStockValueCents !== null &&
    Number.isFinite(Number(params.prevStockValueCents)) &&
    Number(params.prevStockValueCents) >= 0 &&
    !(Number(params.prevStockValueCents) === 0 && prevTotal > 0 && prevAvg > 0);

  if (deduct <= 0) {
    const existingPool =
      prevTotal > 0
        ? hasValidPrevPool
          ? Math.round(Number(params.prevStockValueCents))
          : Math.round(prevTotal * prevAvg * 100)
        : 0;
    return {
      newTotalUnits: prevTotal,
      stockValueCents: existingPool,
      cogsCents: 0,
      unitCostUsed: roundUnitCost(prevAvg),
    };
  }

  if (prevTotal <= 0) {
    // Already zero or negative: pool stays 0, COGS estimated at current MWAC
    const cogsCents = Math.round(deduct * prevAvg * 100);
    return {
      newTotalUnits,
      stockValueCents: 0,
      cogsCents,
      unitCostUsed: roundUnitCost(prevAvg),
    };
  }

  const prevPoolCents = hasValidPrevPool
    ? Math.round(Number(params.prevStockValueCents))
    : Math.round(prevTotal * prevAvg * 100);

  if (newTotalUnits <= 0) {
    // Full depletion of positive pool (plus any overflow into negative stock)
    const negativeOverflowUnits = Math.abs(Math.min(0, newTotalUnits));
    const overflowCents = Math.round(negativeOverflowUnits * prevAvg * 100);
    const cogsCents = prevPoolCents + overflowCents;
    return {
      newTotalUnits,
      stockValueCents: 0,
      cogsCents,
      unitCostUsed: deduct > 0 ? roundUnitCost(cogsCents / 100 / deduct) : roundUnitCost(prevAvg),
    };
  }

  // Partial depletion of positive pool: release proportional exact cents
  const cogsCents = Math.min(prevPoolCents, Math.round((prevPoolCents * deduct) / prevTotal));
  const remainingPoolCents = Math.max(0, prevPoolCents - cogsCents);

  return {
    newTotalUnits,
    stockValueCents: remainingPoolCents,
    cogsCents,
    unitCostUsed: deduct > 0 ? roundUnitCost(cogsCents / 100 / deduct) : roundUnitCost(prevAvg),
  };
};

/**
 * Applies a stock return/restock (sale refund, void reversal, returned exchange item)
 * to an item's integer-cent value pool (`stockValueCents`).
 */
export const applyReturnToValuePool = (params: {
  prevTotalUnits: number;
  prevStockValueCents?: number;
  prevAvgUnitCost: number;
  returnedUnits: number;
  returnUnitCost?: number;
}): {
  newTotalUnits: number;
  stockValueCents: number;
} => {
  const prevTotal = roundStockUnits(Number(params.prevTotalUnits) || 0);
  const retQty = roundStockUnits(Math.max(0, Number(params.returnedUnits) || 0));
  const unitCost = Math.max(
    0,
    Number(params.returnUnitCost) > 0 ? Number(params.returnUnitCost) : Number(params.prevAvgUnitCost) || 0
  );
  const newTotalUnits = roundStockUnits(prevTotal + retQty);

  if (newTotalUnits <= 0) {
    return { newTotalUnits, stockValueCents: 0 };
  }

  const hasValidPrevPool =
    params.prevStockValueCents !== undefined &&
    params.prevStockValueCents !== null &&
    Number.isFinite(Number(params.prevStockValueCents)) &&
    Number(params.prevStockValueCents) >= 0 &&
    !(Number(params.prevStockValueCents) === 0 && prevTotal > 0 && unitCost > 0);

  if (prevTotal >= 0) {
    const prevPoolCents =
      prevTotal > 0
        ? hasValidPrevPool
          ? Math.round(Number(params.prevStockValueCents))
          : Math.round(prevTotal * (Number(params.prevAvgUnitCost) || unitCost) * 100)
        : 0;
    const addedCents = Math.round(retQty * unitCost * 100);
    return {
      newTotalUnits,
      stockValueCents: prevPoolCents + addedCents,
    };
  }

  // Returned units brought stock from negative back to positive
  return {
    newTotalUnits,
    stockValueCents: Math.round(newTotalUnits * unitCost * 100),
  };
};

/**
 * Computes an aligned integer-cent value pool after a direct stock reset
 * (e.g., stocktake committal or manual Product setup stock edit).
 */
export const reconcileStockValueCents = (
  item: Partial<InventoryItem>,
  newTotalUnits: number,
  overrideUnitCost?: number
): number => {
  const safeTotal = roundStockUnits(Number(newTotalUnits) || 0);
  if (safeTotal <= 0) return 0;
  const unitCost =
    overrideUnitCost !== undefined && Number.isFinite(overrideUnitCost) && overrideUnitCost >= 0
      ? overrideUnitCost
      : resolveItemValuationUnitCost(item);
  return Math.max(0, Math.round(safeTotal * unitCost * 100));
};

/**
 * Canonical GRV line costing calculator supporting BOTH:
 * - `'LINE_TOTAL'` (Line-Total-First): user enters exact supplier invoice line total;
 *   4-decimal unit/case cost is derived from `lineTotal / qty` while exact cents are preserved.
 * - `'UNIT_COST'` (Unit/Case Cost-First): user enters up to 4-decimal unit/case/pack cost;
 *   line total is computed as `Math.round(qty * enteredCost * 100) / 100`.
 */
export const computeGrvLineCosting = (input: GrvLineCostingInput): GrvLineCostingResult => {
  const upc = Math.max(1, Number(input.unitsPerCase) || 1);
  const variantPack = Math.max(0.001, Number(input.variantUnitsPerPack) || 1);
  const qty = Math.max(0, Number(input.qty) || 0);
  const allocatedLandedCents = Math.max(0, Math.round((Number(input.allocatedLandedCost) || 0) * 100));

  let receivedCases = 0;
  let receivedSingles = 0;
  let totalUnits = 0;

  if (input.receiveAs === 'Cases') {
    receivedCases = qty;
    receivedSingles = 0;
    totalUnits = roundStockUnits(qty * upc);
  } else if (input.receiveAs === 'Variant') {
    receivedCases = 0;
    receivedSingles = roundStockUnits(qty * variantPack);
    totalUnits = receivedSingles;
  } else {
    receivedCases = 0;
    receivedSingles = roundStockUnits(qty);
    totalUnits = receivedSingles;
  }

  let lineTotalCents = 0;
  let displayPackCost = 0;
  let costPerUnit = 0;
  let costPerCase = 0;

  if (input.costEntryMode === 'LINE_TOTAL') {
    const rawLineTotal = Math.max(0, Number(input.enteredLineTotal) || 0);
    lineTotalCents = Math.round(rawLineTotal * 100);
    const exactLineDollars = lineTotalCents / 100;

    if (totalUnits > 0) {
      costPerUnit = roundUnitCost(exactLineDollars / totalUnits);
      displayPackCost = qty > 0 ? roundUnitCost(exactLineDollars / qty) : 0;
      costPerCase =
        input.receiveAs === 'Cases'
          ? displayPackCost
          : roundUnitCost(costPerUnit * upc);
    } else {
      displayPackCost = roundUnitCost(Math.max(0, Number(input.enteredUnitOrCaseCost) || 0));
      costPerUnit =
        input.receiveAs === 'Cases'
          ? roundUnitCost(displayPackCost / upc)
          : input.receiveAs === 'Variant'
          ? roundUnitCost(displayPackCost / variantPack)
          : displayPackCost;
      costPerCase =
        input.receiveAs === 'Cases' ? displayPackCost : roundUnitCost(costPerUnit * upc);
    }
  } else {
    displayPackCost = roundUnitCost(Math.max(0, Number(input.enteredUnitOrCaseCost) || 0));
    lineTotalCents = Math.round(qty * displayPackCost * 100);

    if (input.receiveAs === 'Cases') {
      costPerCase = displayPackCost;
      costPerUnit = roundUnitCost(displayPackCost / upc);
    } else if (input.receiveAs === 'Variant') {
      costPerUnit = roundUnitCost(displayPackCost / variantPack);
      costPerCase = roundUnitCost(costPerUnit * upc);
    } else {
      costPerUnit = displayPackCost;
      costPerCase = roundUnitCost(displayPackCost * upc);
    }
  }

  const totalLineCents = lineTotalCents + allocatedLandedCents;
  const landedCostPerUnit =
    totalUnits > 0 ? roundUnitCost(allocatedLandedCents / 100 / totalUnits) : 0;
  const totalUnitCost =
    totalUnits > 0
      ? roundUnitCost(totalLineCents / 100 / totalUnits)
      : roundUnitCost(costPerUnit + landedCostPerUnit);
  const totalCaseCost = roundCurrency(totalUnitCost * upc);

  return {
    receivedCases,
    receivedSingles,
    totalUnits,
    lineTotalCents,
    lineTotal: lineTotalCents / 100,
    allocatedLandedCents,
    totalLineCents,
    totalLineCost: totalLineCents / 100,
    costPerUnit,
    costPerCase,
    displayPackCost,
    landedCostPerUnit,
    totalUnitCost,
    totalCaseCost,
  };
};

/**
 * Computes integer-cent inventory cost valuation for a single SKU.
 * Uses authoritative `stockValueCents` when present (zero-penny GL reconciliation),
 * falling back to `Math.round(totalUnits * MWAC * 100)`.
 * Negative stock contributes 0 cents to positive store valuation (tracked separately as negative exposure).
 */
export const computeItemValuationCents = (item: Partial<InventoryItem>): number => {
  return resolveItemStockValueCents(item);
};

/**
 * Computes integer-cent negative stock exposure (positive magnitude in cents) for a negative-balance SKU.
 */
export const computeNegativeExposureCents = (item: Partial<InventoryItem>): number => {
  const { totalUnits } = normalizeStockFields(item);
  if (totalUnits >= 0) return 0;
  const unitCost = resolveItemValuationUnitCost(item);
  return Math.round(Math.abs(totalUnits) * unitCost * 100);
};

/**
 * Aggregates portfolio-wide positive inventory valuation (value-pool / MWAC, integer-cent line rounding)
 * and isolates negative-stock SKUs into separate exposure metrics so they never corrupt
 * positive valuation or stock-on-hand counts.
 */
export const computePortfolioValuation = <T extends Partial<InventoryItem>>(
  items: T[]
): PortfolioValuationSummary<T> => {
  let totalValuationCents = 0;
  let positiveCases = 0;
  let positiveSingles = 0;
  let positiveTotalUnits = 0;

  let negativeSkuCount = 0;
  let negativeTotalUnits = 0;
  let negativeExposureCents = 0;
  const negativeItems: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const stock = normalizeStockFields(item);
    const unitCost = resolveItemValuationUnitCost(item);

    if (stock.totalUnits < 0) {
      negativeSkuCount += 1;
      negativeTotalUnits += stock.totalUnits;
      negativeExposureCents += Math.round(Math.abs(stock.totalUnits) * unitCost * 100);
      negativeItems.push(item);
    } else {
      positiveCases += stock.stockCases;
      positiveSingles += stock.stockSingles;
      positiveTotalUnits += stock.totalUnits;
      if (stock.totalUnits > 0) {
        totalValuationCents += resolveItemStockValueCents(item);
      }
    }
  }

  return {
    totalValuationCents,
    totalValuationDollars: totalValuationCents / 100,
    positiveCases: roundStockUnits(positiveCases),
    positiveSingles: roundStockUnits(positiveSingles),
    positiveTotalUnits: roundStockUnits(positiveTotalUnits),
    negativeSkuCount,
    negativeTotalUnits: roundStockUnits(negativeTotalUnits),
    negativeExposureCents,
    negativeExposureDollars: negativeExposureCents / 100,
    negativeItems,
  };
};

/**
 * Computes the unified base-unit reorder threshold for an item.
 * Handles products saved by ProductAddEditModal (which sets reorderLevelUnits = reorderLevelCases * unitsPerCase)
 * without double-counting, while respecting singles-only thresholds and explicit 0 values.
 */
export const computeReorderPointTotalUnits = (item: Partial<InventoryItem>): number => {
  if (!item) return 0;
  const upc = Math.max(1, Number(item.unitsPerCase) || 1);

  const hasCases = item.reorderLevelCases !== undefined && item.reorderLevelCases !== null;
  const hasUnits = item.reorderLevelUnits !== undefined && item.reorderLevelUnits !== null;

  if (!hasCases && !hasUnits) {
    return upc > 1 ? 2 * upc : 10;
  }

  const rawCases = hasCases ? Number(item.reorderLevelCases) : 0;
  const rawUnits = hasUnits ? Number(item.reorderLevelUnits) : 0;
  const safeCases = Number.isFinite(rawCases) && rawCases > 0 ? rawCases : 0;
  const safeUnits = Number.isFinite(rawUnits) && rawUnits > 0 ? rawUnits : 0;

  if (safeCases > 0 && upc > 1) {
    return Math.max(safeCases * upc, safeUnits);
  }
  if (safeUnits > 0) {
    return safeUnits;
  }
  if (safeCases > 0) {
    return safeCases * upc;
  }
  return 0;
};

/**
 * Base-unit reorder check: compares canonical totalUnits against the unified reorder threshold.
 * Eliminates false alarms when an item holds bulk cases with 0 loose singles.
 */
export const isItemBelowReorderPoint = (item: Partial<InventoryItem>): boolean => {
  if (!item) return false;
  const { totalUnits } = normalizeStockFields(item);
  const reorderPoint = computeReorderPointTotalUnits(item);
  if (reorderPoint <= 0) {
    return totalUnits < 0;
  }
  return totalUnits <= reorderPoint;
};
