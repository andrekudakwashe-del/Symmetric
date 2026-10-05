import { GoodsReceivedNote, LandedCostItem, GrnLineItem } from '../types';

/**
 * Largest-remainder (Hamilton) method to allocate an integer amount of cents
 * across eligible line items according to their raw floating-point weights/shares.
 * Guarantees the sum of allocated cents equals totalCents exactly down to the cent.
 */
export function allocateCentsLargestRemainder(
  shares: { index: number; exactShare: number; maxCents?: number }[],
  totalCents: number
): Map<number, number> {
  const result = new Map<number, number>();
  if (shares.length === 0 || totalCents === 0) {
    return result;
  }

  const sumShares = shares.reduce((sum, s) => sum + s.exactShare, 0);
  if (sumShares <= 0) {
    // If all shares are 0, divide evenly
    const even = Math.floor(totalCents / shares.length);
    let rem = totalCents - even * shares.length;
    shares.forEach((s) => {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem--;
      result.set(s.index, even + extra);
    });
    return result;
  }

  let allocatedCentsSum = 0;
  const withRemainder = shares.map((s) => {
    const rawCents = (s.exactShare / sumShares) * totalCents;
    const baseCents = Math.floor(rawCents);
    const remainder = rawCents - baseCents;
    allocatedCentsSum += baseCents;
    return {
      index: s.index,
      baseCents,
      remainder,
    };
  });

  let leftoverCents = totalCents - allocatedCentsSum;

  // Sort descending by remainder
  withRemainder.sort((a, b) => b.remainder - a.remainder);

  for (const item of withRemainder) {
    const extra = leftoverCents > 0 ? 1 : 0;
    if (leftoverCents > 0) leftoverCents--;
    result.set(item.index, item.baseCents + extra);
  }

  return result;
}

/**
 * Compute standard (by_value) allocation for a landed cost line item.
 * Used for comparison and audit reporting.
 */
export function computeStandardByValue(
  landedCost: LandedCostItem,
  lineItems: GrnLineItem[]
): { [itemId: string]: number } {
  const result: { [itemId: string]: number } = {};
  const amount = Number(landedCost.amount) || 0;
  if (amount <= 0 || !lineItems || lineItems.length === 0) {
    lineItems.forEach((li, idx) => {
      result[li.itemId || `item_${idx}`] = 0;
    });
    return result;
  }

  const totalCents = Math.round(amount * 100);
  const eligible = lineItems
    .map((li, idx) => ({ li, idx }))
    .filter(({ li }) => (li.quantity || 0) > 0);

  if (eligible.length === 0) {
    lineItems.forEach((li, idx) => {
      result[li.itemId || `item_${idx}`] = 0;
    });
    return result;
  }

  const shares = eligible.map(({ li, idx }) => ({
    index: idx,
    exactShare: Math.max(0, li.subtotal || (li.quantity || 1) * li.unitCost),
  }));

  const centsMap = allocateCentsLargestRemainder(shares, totalCents);

  lineItems.forEach((li, idx) => {
    const cents = centsMap.get(idx) || 0;
    result[li.itemId || `item_${idx}`] = Number((cents / 100).toFixed(2));
  });

  return result;
}

/**
 * Allocates a landed cost line item using Margin Capacity ('by_margin').
 *
 * Implements:
 * 1. Absolute profit (sellingPrice - unitCost) or Margin % (marginPct * unitCost)
 * 2. Excludes items with profit <= 0 or no selling price ($0 allocated)
 * 3. Fallback to by_value if no items have positive profit
 * 4. Margin floor caps (marginFloorPercent, marginFloorAbsolute, or stricter of both)
 * 5. Iterative redistribution of excess to uncapped items
 * 6. Largest-remainder rounding to guarantee exact cent sum
 * 7. Records standardAllocation and allocatedAmount for audit and reversal safety
 */
export function allocateByMargin(
  landedCost: LandedCostItem,
  lineItems: GrnLineItem[]
): Map<number, number> {
  const amount = Number(landedCost.amount) || 0;
  const totalCents = Math.round(amount * 100);
  const result = new Map<number, number>();

  if (totalCents <= 0 || !lineItems || lineItems.length === 0) {
    lineItems.forEach((_, idx) => result.set(idx, 0));
    return result;
  }

  // Check if manual overrides exist and sum to the total amount exactly
  if (landedCost.manualOverrides && Object.keys(landedCost.manualOverrides).length > 0) {
    let overrideSumCents = 0;
    let validOverrides = true;
    const itemOverrideCents = new Map<number, number>();

    lineItems.forEach((li, idx) => {
      const key = li.itemId || `item_${idx}`;
      if (landedCost.manualOverrides![key] !== undefined) {
        const c = Math.round(Number(landedCost.manualOverrides![key]) * 100);
        itemOverrideCents.set(idx, c);
        overrideSumCents += c;
      } else {
        itemOverrideCents.set(idx, 0);
      }
    });

    if (overrideSumCents === totalCents) {
      itemOverrideCents.forEach((cents, idx) => result.set(idx, cents));
      return result;
    }
  }

  // 1. Compute profit and margin percent per item
  const withProfit = lineItems.map((item, index) => {
    const qty = item.quantity || 0;
    const sellPrice = item.sellingPrice || 0;
    const unitCost = item.unitCost || 0;
    const profit = sellPrice - unitCost;
    const marginPct = sellPrice > 0 ? profit / sellPrice : 0;

    return {
      index,
      item,
      quantity: qty,
      unitCost,
      sellingPrice: sellPrice,
      profit,
      marginPct,
    };
  });

  // 2. Identify eligible items (positive profit and selling price > 0 and qty > 0)
  const eligible = withProfit.filter((i) => i.profit > 0 && i.sellingPrice > 0 && i.quantity > 0);
  const excluded = withProfit.filter((i) => i.profit <= 0 || i.sellingPrice <= 0 || i.quantity <= 0);

  // Set excluded items to 0
  for (const ex of excluded) {
    result.set(ex.index, 0);
  }

  // 3. Fallback: if no eligible items, allocate by value across items with quantity > 0
  if (eligible.length === 0) {
    const validQtyItems = lineItems
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => (it.quantity || 0) > 0);

    if (validQtyItems.length === 0) {
      lineItems.forEach((_, idx) => result.set(idx, 0));
      return result;
    }

    const shares = validQtyItems.map(({ it, idx }) => ({
      index: idx,
      exactShare: Math.max(0, it.subtotal || (it.quantity || 1) * it.unitCost),
    }));
    return allocateCentsLargestRemainder(shares, totalCents);
  }

  // 4. Compute weight based on marginBasis
  // Default is 'absolute_profit'. If 'margin_percent': weight = marginPct * unitCost
  const isPercentBasis = landedCost.marginBasis === 'margin_percent';
  const itemWeights = new Map<number, number>();

  for (const it of eligible) {
    let w: number;
    if (isPercentBasis) {
      w = it.marginPct * it.unitCost;
      if (w <= 0) w = it.profit;
    } else {
      w = it.profit;
    }
    itemWeights.set(it.index, Math.max(0.0001, w));
  }

  // 5. Compute margin floor caps for each eligible item
  // Cap = maximum landed cost (in cents) that keeps the post-allocation margin at or above the floor
  const floorPct = landedCost.marginFloorPercent != null ? Number(landedCost.marginFloorPercent) : null;
  const floorAbs = landedCost.marginFloorAbsolute != null ? Number(landedCost.marginFloorAbsolute) : null;
  const hasFloor = (floorPct != null && !isNaN(floorPct)) || (floorAbs != null && !isNaN(floorAbs));

  const maxCentsMap = new Map<number, number>();

  if (hasFloor) {
    for (const it of eligible) {
      let capDollars = Infinity;

      // Percentage floor: (sellingPrice - (unitCost + alloc / qty)) / sellingPrice >= floorPct / 100
      // => alloc / qty <= sellingPrice * (1 - floorPct / 100) - unitCost
      if (floorPct != null && !isNaN(floorPct)) {
        const minMarginRatio = floorPct / 100;
        const maxUnitAlloc = it.sellingPrice * (1 - minMarginRatio) - it.unitCost;
        const maxTotalAlloc = Math.max(0, maxUnitAlloc * it.quantity);
        capDollars = Math.min(capDollars, maxTotalAlloc);
      }

      // Absolute dollar floor: sellingPrice - (unitCost + alloc / qty) >= floorAbs
      // => alloc / qty <= sellingPrice - unitCost - floorAbs
      if (floorAbs != null && !isNaN(floorAbs)) {
        const maxUnitAlloc = it.sellingPrice - it.unitCost - floorAbs;
        const maxTotalAlloc = Math.max(0, maxUnitAlloc * it.quantity);
        capDollars = Math.min(capDollars, maxTotalAlloc);
      }

      const maxCents = isFinite(capDollars) ? Math.max(0, Math.floor(capDollars * 100)) : Infinity;
      maxCentsMap.set(it.index, maxCents);
    }
  }

  // 6. Iterative allocation with capping & excess redistribution
  let activeItems = [...eligible];
  const allocatedExact = new Map<number, number>();
  activeItems.forEach((it) => allocatedExact.set(it.index, 0));

  let remainingCentsToDistribute = totalCents;

  if (hasFloor) {
    const isCapped = new Set<number>();
    let converged = false;
    let iterations = 0;

    while (!converged && iterations < 50) {
      iterations++;
      const uncapped = activeItems.filter((it) => !isCapped.has(it.index));
      if (uncapped.length === 0) {
        break;
      }

      const uncappedWeightTotal = uncapped.reduce((sum, it) => sum + (itemWeights.get(it.index) || 0), 0);
      if (uncappedWeightTotal <= 0) {
        break;
      }

      // Allocate remaining cents among uncapped items
      let newlyCapped = false;
      for (const it of uncapped) {
        const share = ((itemWeights.get(it.index) || 0) / uncappedWeightTotal) * remainingCentsToDistribute;
        const currentTotal = (allocatedExact.get(it.index) || 0) + share;
        const cap = maxCentsMap.get(it.index) ?? Infinity;

        if (currentTotal > cap) {
          allocatedExact.set(it.index, cap);
          isCapped.add(it.index);
          newlyCapped = true;
        }
      }

      if (newlyCapped) {
        // Recompute remaining cents to distribute from totalCents minus capped allocations
        let sumCapped = 0;
        isCapped.forEach((idx) => {
          sumCapped += allocatedExact.get(idx) || 0;
        });
        remainingCentsToDistribute = Math.max(0, totalCents - sumCapped);
      } else {
        // All uncapped items are within their caps
        for (const it of uncapped) {
          const share = ((itemWeights.get(it.index) || 0) / uncappedWeightTotal) * remainingCentsToDistribute;
          allocatedExact.set(it.index, (allocatedExact.get(it.index) || 0) + share);
        }
        converged = true;
      }
    }
  } else {
    // No floor cap, allocate directly by weight
    const totalWeight = activeItems.reduce((sum, it) => sum + (itemWeights.get(it.index) || 0), 0);
    for (const it of activeItems) {
      const share = ((itemWeights.get(it.index) || 0) / totalWeight) * totalCents;
      allocatedExact.set(it.index, share);
    }
  }

  // 7. Apply Largest-Remainder Rounding so sum equals totalCents exactly
  const sharesForRounding = activeItems.map((it) => ({
    index: it.index,
    exactShare: allocatedExact.get(it.index) || 0,
  }));

  const roundedMap = allocateCentsLargestRemainder(sharesForRounding, totalCents);
  roundedMap.forEach((cents, idx) => {
    result.set(idx, cents);
  });

  return result;
}

/**
 * Allocates landed costs across GRN line items.
 * Supports:
 * - by_value: allocated proportional to item.subtotal
 * - by_quantity: allocated proportional to item.quantity
 * - by_weight: allocated proportional to item.weight
 * - by_margin: allocated proportional to item profit/margin capacity with floor caps
 *
 * Edge cases handled:
 * - lineItem.quantity === 0: skipped ($0 allocated)
 * - by_weight with totalWeight === 0: fallbacks to by_value
 * - by_weight with mixed null/zero weight: unweighted items allocated residual by value,
 *   weighted items allocated by weight
 * - by_margin with all profits <= 0 or missing selling price: fallbacks to by_value
 * - Largest-remainder rounding guarantees exact cent matching.
 * - Stores standardAllocation and allocatedAmount on each landedCost for audit & reversal.
 */
export function allocateLandedCosts(
  grn: GoodsReceivedNote,
  isReversal: boolean = false
): GoodsReceivedNote {
  if (!grn.lineItems || grn.lineItems.length === 0) {
    return grn;
  }

  // Reset allocated landed costs
  grn.lineItems.forEach((item) => {
    item.landedCostAllocated = 0;
    item.totalUnitCost = item.unitCost;
  });

  if (!grn.landedCosts || grn.landedCosts.length === 0) {
    const subtotal = grn.lineItems.reduce((s, it) => s + (it.subtotal || it.quantity * it.unitCost), 0);
    const totalQuantity = grn.lineItems.reduce((s, it) => s + (it.quantity || 0), 0);
    grn.totals = {
      subtotal,
      totalLandedCosts: 0,
      totalInventoryValue: subtotal,
      totalQuantity,
    };
    return grn;
  }

  // Running sum of allocations per line item index in cents
  const totalAllocatedCentsPerItem = new Array<number>(grn.lineItems.length).fill(0);

  for (const lc of grn.landedCosts) {
    const lcAmount = Number(lc.amount) || 0;
    if (lcAmount <= 0) continue;

    const totalLcCents = Math.round(lcAmount * 100);

    // Compute standard (by_value) allocation for audit comparison
    lc.standardAllocation = computeStandardByValue(lc, grn.lineItems);

    // Reversal safety: If reversing and allocatedAmount is already stored, reuse it
    if (isReversal && lc.allocatedAmount && Object.keys(lc.allocatedAmount).length > 0) {
      grn.lineItems.forEach((it, idx) => {
        const key = it.itemId || `item_${idx}`;
        const storedDollars = lc.allocatedAmount![key] ?? 0;
        totalAllocatedCentsPerItem[idx] += Math.round(storedDollars * 100);
      });
      continue;
    }

    const eligibleIndices = grn.lineItems
      .map((it, idx) => ({ item: it, index: idx }))
      .filter(({ item }) => (item.quantity || 0) > 0);

    if (eligibleIndices.length === 0) continue;

    let method = lc.allocationMethod;

    if (method === 'by_quantity') {
      const shares = eligibleIndices.map(({ item, index }) => ({
        index,
        exactShare: Math.max(0, item.quantity || 0),
      }));
      const allocatedMap = allocateCentsLargestRemainder(shares, totalLcCents);
      const allocatedDollarsMap: { [itemId: string]: number } = {};
      allocatedMap.forEach((cents, idx) => {
        totalAllocatedCentsPerItem[idx] += cents;
        const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
        allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
      });
      lc.allocatedAmount = allocatedDollarsMap;
    } else if (method === 'by_weight') {
      const itemsWithWeight = eligibleIndices.filter(({ item }) => (item.weight || 0) > 0);
      const itemsWithoutWeight = eligibleIndices.filter(({ item }) => !(item.weight && item.weight > 0));

      const allocatedDollarsMap: { [itemId: string]: number } = {};

      if (itemsWithWeight.length === 0) {
        // Fallback to by_value if totalWeight is 0
        const shares = eligibleIndices.map(({ item, index }) => ({
          index,
          exactShare: Math.max(0, item.subtotal || item.quantity * item.unitCost),
        }));
        const allocatedMap = allocateCentsLargestRemainder(shares, totalLcCents);
        allocatedMap.forEach((cents, idx) => {
          totalAllocatedCentsPerItem[idx] += cents;
          const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
          allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
        });
      } else if (itemsWithoutWeight.length === 0) {
        // All items have weight
        const shares = itemsWithWeight.map(({ item, index }) => ({
          index,
          exactShare: item.weight || 0,
        }));
        const allocatedMap = allocateCentsLargestRemainder(shares, totalLcCents);
        allocatedMap.forEach((cents, idx) => {
          totalAllocatedCentsPerItem[idx] += cents;
          const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
          allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
        });
      } else {
        // Mixed: some have weight, some don't
        const valWeighted = itemsWithWeight.reduce(
          (sum, { item }) => sum + Math.max(0, item.subtotal || item.quantity * item.unitCost),
          0
        );
        const valUnweighted = itemsWithoutWeight.reduce(
          (sum, { item }) => sum + Math.max(0, item.subtotal || item.quantity * item.unitCost),
          0
        );
        const totalVal = valWeighted + valUnweighted;

        let unweightedCents = totalVal > 0 ? Math.round((valUnweighted / totalVal) * totalLcCents) : 0;
        let weightedCents = totalLcCents - unweightedCents;

        if (unweightedCents > 0) {
          const unweightedShares = itemsWithoutWeight.map(({ item, index }) => ({
            index,
            exactShare: Math.max(0, item.subtotal || item.quantity * item.unitCost),
          }));
          const unweightedMap = allocateCentsLargestRemainder(unweightedShares, unweightedCents);
          unweightedMap.forEach((cents, idx) => {
            totalAllocatedCentsPerItem[idx] += cents;
            const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
            allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
          });
        }

        if (weightedCents > 0) {
          const weightedShares = itemsWithWeight.map(({ item, index }) => ({
            index,
            exactShare: item.weight || 0,
          }));
          const weightedMap = allocateCentsLargestRemainder(weightedShares, weightedCents);
          weightedMap.forEach((cents, idx) => {
            totalAllocatedCentsPerItem[idx] += cents;
            const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
            allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
          });
        }
      }
      lc.allocatedAmount = allocatedDollarsMap;
    } else if (method === 'by_margin') {
      // STAGE 3: Margin Capacity Allocation
      const marginMap = allocateByMargin(lc, grn.lineItems);
      const allocatedDollarsMap: { [itemId: string]: number } = {};

      marginMap.forEach((cents, idx) => {
        totalAllocatedCentsPerItem[idx] += cents;
        const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
        allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
      });
      lc.allocatedAmount = allocatedDollarsMap;
    } else {
      // Default: by_value
      const shares = eligibleIndices.map(({ item, index }) => ({
        index,
        exactShare: Math.max(0, item.subtotal || item.quantity * item.unitCost),
      }));
      const allocatedMap = allocateCentsLargestRemainder(shares, totalLcCents);
      const allocatedDollarsMap: { [itemId: string]: number } = {};
      allocatedMap.forEach((cents, idx) => {
        totalAllocatedCentsPerItem[idx] += cents;
        const itemId = grn.lineItems[idx].itemId || `item_${idx}`;
        allocatedDollarsMap[itemId] = Number((cents / 100).toFixed(2));
      });
      lc.allocatedAmount = allocatedDollarsMap;
    }
  }

  // Set line item landedCostAllocated and totalUnitCost
  grn.lineItems.forEach((item, idx) => {
    const allocatedDollars = totalAllocatedCentsPerItem[idx] / 100;
    item.landedCostAllocated = allocatedDollars;
    if (item.quantity && item.quantity > 0) {
      item.totalUnitCost = Number((item.unitCost + allocatedDollars / item.quantity).toFixed(4));
    } else {
      item.totalUnitCost = item.unitCost;
    }
  });

  // Calculate totals
  const subtotal = grn.lineItems.reduce((s, it) => s + (it.subtotal || it.quantity * it.unitCost), 0);
  const totalLandedCosts = grn.landedCosts.reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
  const totalQuantity = grn.lineItems.reduce((s, it) => s + (it.quantity || 0), 0);
  const totalInventoryValue = Number((subtotal + totalLandedCosts).toFixed(2));

  grn.totals = {
    subtotal: Number(subtotal.toFixed(2)),
    totalLandedCosts: Number(totalLandedCosts.toFixed(2)),
    totalInventoryValue,
    totalQuantity,
  };

  return grn;
}

export const landedCostService = {
  allocateLandedCosts,
  allocateByMargin,
  computeStandardByValue,
};
