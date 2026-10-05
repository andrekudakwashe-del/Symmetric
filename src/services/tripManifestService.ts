import {
  ProcurementTripManifest,
  TripLandedCost,
  TripGrnAllocationSummary,
  TripItemAllocation,
  GoodsReceivedNote,
  GrnLineItem,
  LandedCostItem,
} from '../types';
import {
  getAllGoodsReceivedNotes,
  saveGoodsReceivedNote,
} from '../db/goodsReceivedNotes';
import {
  allocateCentsLargestRemainder,
  allocateByMargin,
  computeStandardByValue,
} from './landedCostService';
import { costingService } from './costingService';
import { payablesLedger } from './payablesLedger';
import { addMovement, getShiftId } from '../db/cashLedger';
import { getCurrentBranchId, getCurrentCompanyId } from '../db/roomDatabase';

export const TRIP_MANIFEST_STORAGE_KEY = 'saimetric_room_procurement_trips';

let memoryTrips: ProcurementTripManifest[] = [];

/**
 * Retrieve all procurement trip manifests
 */
export function getAllTripManifests(): ProcurementTripManifest[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryTrips;
  }
  try {
    const raw = window.localStorage.getItem(TRIP_MANIFEST_STORAGE_KEY);
    if (!raw) return memoryTrips;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const sanitized = parsed.map((t: any) => ({
        ...t,
        tripNumber: t.tripNumber || t.id || 'TRIP-UNKNOWN',
        tripName: t.tripName || 'Town Run Manifest',
        date: t.date || new Date().toISOString().split('T')[0],
        status: t.status || 'DRAFT',
        linkedGrnIds: Array.isArray(t.linkedGrnIds) ? t.linkedGrnIds : [],
        landedCosts: Array.isArray(t.landedCosts) ? t.landedCosts : [],
        totalGoodsPurchased: Number(t.totalGoodsPurchased) || 0,
        totalTripLandedCosts: Number(t.totalTripLandedCosts) || 0,
        totalTripCost: Number(t.totalTripCost) || 0,
        supplierCount: Number(t.supplierCount) || 0,
      }));
      memoryTrips = sanitized;
      return sanitized;
    }
    return memoryTrips;
  } catch (err) {
    console.error('[TripManifestService] Error reading trips:', err);
    return memoryTrips;
  }
}

/**
 * Persist trip manifests to storage
 */
export function saveAllTripManifests(trips: ProcurementTripManifest[]): void {
  memoryTrips = trips;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(TRIP_MANIFEST_STORAGE_KEY, JSON.stringify(trips));
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('saimetric_trips_updated', {
            detail: { count: trips.length },
          })
        );
      }
    } catch (err) {
      console.error('[TripManifestService] Error saving trips:', err);
    }
  }
}

/**
 * Save or update a single procurement trip manifest
 */
export function saveTripManifest(trip: ProcurementTripManifest): ProcurementTripManifest {
  const all = getAllTripManifests();
  const idx = all.findIndex((t) => t.id === trip.id || t.tripNumber === trip.tripNumber);
  let updated: ProcurementTripManifest[];
  if (idx >= 0) {
    updated = [...all];
    updated[idx] = trip;
  } else {
    updated = [trip, ...all];
  }
  saveAllTripManifests(updated);
  return trip;
}

/**
 * Get a trip manifest by ID or trip number
 */
export function getTripManifestById(idOrNumber: string): ProcurementTripManifest | undefined {
  return getAllTripManifests().find(
    (t) => t.id === idOrNumber || t.tripNumber === idOrNumber
  );
}

/**
 * Generate a sequential trip number for a given date
 */
export function generateTripNumber(dateStr?: string): string {
  const d = dateStr || new Date().toISOString().split('T')[0];
  const cleanDate = d.replace(/-/g, '');
  const all = getAllTripManifests();
  const prefix = `TRIP-${cleanDate}-`;
  const matching = all.filter((t) => (t.tripNumber || '').startsWith(prefix));
  const nextSeq = matching.length + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * Create a new draft procurement trip manifest
 */
export function createDraftTripManifest(params: {
  tripName?: string;
  date?: string;
  carrierOrDriver?: string;
  vehicleReg?: string;
  destinationOrMarket?: string;
  createdBy: string;
  createdByName?: string;
  notes?: string;
  freightAmount?: number;
  transporterName?: string;
  paymentMethod?: TripLandedCost['paymentMethod'];
  allocationMethod?: TripLandedCost['allocationMethod'];
}): ProcurementTripManifest {
  const now = new Date().toISOString();
  const date = params.date || now.split('T')[0];
  const tripNumber = generateTripNumber(date);
  const id = `TRIP_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  const defaultLandedCost: TripLandedCost = {
    id: `lc_${Date.now()}_1`,
    description: 'Town Run Transport / Truck Hire',
    amount: params.freightAmount !== undefined ? params.freightAmount : 30.0,
    transporterName: params.transporterName || params.carrierOrDriver || 'Local Transport',
    paymentMethod: params.paymentMethod || 'cash_till',
    allocationMethod: params.allocationMethod || 'by_value',
    marginBasis: 'absolute_profit',
  };

  const trip: ProcurementTripManifest = {
    id,
    tripNumber,
    tripName: params.tripName || 'Town Run - Multi-Supplier Purchase',
    date,
    destinationOrMarket: params.destinationOrMarket || 'Town Wholesale District',
    carrierOrDriver: params.carrierOrDriver || 'Moyo Transport',
    vehicleReg: params.vehicleReg || '',
    status: 'DRAFT',
    createdBy: params.createdBy,
    createdByName: params.createdByName,
    companyId: getCurrentCompanyId(),
    branchId: getCurrentBranchId(),
    notes: params.notes || '',
    totalGoodsPurchased: 0,
    totalTripLandedCosts: defaultLandedCost.amount,
    totalTripCost: defaultLandedCost.amount,
    supplierCount: 0,
    landedCosts: [defaultLandedCost],
    linkedGrnIds: [],
    createdAt: now,
    updatedAt: now,
  };

  return saveTripManifest(trip);
}

/**
 * Core Cross-Supplier Allocation Engine
 *
 * Pools line items across all linked GRNs and apportions trip landed costs
 * (e.g. $30 transport) proportionally down to the exact cent across every product.
 *
 * Supports:
 * - by_value: Proportional to purchase subtotal ($600 supplier gets 60% of $30 = $18.00)
 * - by_quantity: Proportional to total units received
 * - by_weight: Proportional to line item weights
 * - by_margin: Proportional to item margin capacity with optional floor caps
 */
export function calculateTripCrossAllocation(
  trip: ProcurementTripManifest,
  grns: GoodsReceivedNote[]
): {
  summaries: TripGrnAllocationSummary[];
  totalAllocatedCents: number;
  totalTripLandedCents: number;
  isExactMatch: boolean;
} {
  const lcs = Array.isArray(trip?.landedCosts) ? trip.landedCosts : [];
  const safeGrns = Array.isArray(grns) ? grns : [];

  const totalTripLanded = lcs.reduce(
    (sum, lc) => sum + (Number(lc.amount) || 0),
    0
  );
  const totalTripLandedCents = Math.round(totalTripLanded * 100);

  // If no GRNs or zero landed cost, return zeroed breakdown
  if (safeGrns.length === 0 || totalTripLandedCents <= 0) {
    const emptySummaries: TripGrnAllocationSummary[] = safeGrns.map((g) => {
      const supp = (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier';
      const items = Array.isArray(g.lineItems) ? g.lineItems : [];
      const subtotal = items.reduce((s, it) => s + (Number(it.subtotal) || (Number(it.quantity) || 0) * (Number(it.unitCost) || 0)), 0);
      const totalQuantity = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      return {
        grnId: g.id,
        grnNumber: g.grnNumber || g.id,
        supplierName: supp,
        invoiceNo: g.paymentRef || g.grnNumber || g.id,
        date: g.dateReceived || '',
        paymentMode: g.paymentMode || 'credit_account',
        subtotal: Number(subtotal.toFixed(2)),
        itemCount: items.length,
        totalQuantity,
        valueSharePercent: 0,
        allocatedLandedCost: 0,
        effectiveTotalCost: Number(subtotal.toFixed(2)),
        itemAllocations: items.map((it) => ({
          itemId: it.itemId,
          itemName: it.itemName,
          grnId: g.id,
          supplierName: supp,
          quantity: it.quantity || 0,
          unitCost: it.unitCost || 0,
          subtotal: it.subtotal || (it.quantity || 0) * (it.unitCost || 0),
          weight: it.weight,
          sellingPrice: it.sellingPrice,
          allocatedLandedCost: 0,
          landedUnitCost: it.unitCost || 0,
        })),
      };
    });
    return {
      summaries: emptySummaries,
      totalAllocatedCents: 0,
      totalTripLandedCents,
      isExactMatch: totalTripLandedCents === 0,
    };
  }

  // 1. Flatten all line items across all linked GRNs into a unified pool
  interface PooledItem {
    globalIndex: number;
    grnId: string;
    grnNumber: string;
    supplierName: string;
    itemIndexInGrn: number;
    item: GrnLineItem;
    subtotal: number;
    quantity: number;
    unitCost: number;
    weight: number;
    sellingPrice?: number;
  }

  const pooledItems: PooledItem[] = [];
  let globalCounter = 0;

  for (const g of safeGrns) {
    const supp = (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier';
    const items = Array.isArray(g.lineItems) ? g.lineItems : [];
    items.forEach((it, idx) => {
      const qty = Number(it.quantity) || 0;
      if (qty > 0) {
        const uCost = Number(it.unitCost) || 0;
        const sub = Number(it.subtotal) || qty * uCost;
        pooledItems.push({
          globalIndex: globalCounter++,
          grnId: g.id,
          grnNumber: g.grnNumber || g.id,
          supplierName: supp,
          itemIndexInGrn: idx,
          item: it,
          subtotal: sub,
          quantity: qty,
          unitCost: uCost,
          weight: Number(it.weight) || 0,
          sellingPrice: it.sellingPrice,
        });
      }
    });
  }

  const totalGoodsValue = pooledItems.reduce((sum, p) => sum + p.subtotal, 0);

  // 2. Allocate each trip landed cost across the pooled items
  const allocatedCentsPerPooledItem = new Array<number>(pooledItems.length).fill(0);

  for (const lc of lcs) {
    const lcAmount = Number(lc.amount) || 0;
    if (lcAmount <= 0) continue;
    const lcCents = Math.round(lcAmount * 100);

    const method = lc.allocationMethod || 'by_value';

    if (method === 'by_quantity') {
      const shares = pooledItems.map((p) => ({
        index: p.globalIndex,
        exactShare: Math.max(0, p.quantity),
      }));
      const map = allocateCentsLargestRemainder(shares, lcCents);
      map.forEach((cents, idx) => {
        allocatedCentsPerPooledItem[idx] += cents;
      });
    } else if (method === 'by_weight') {
      const hasWeights = pooledItems.some((p) => p.weight > 0);
      if (!hasWeights) {
        // Fallback to value
        const shares = pooledItems.map((p) => ({
          index: p.globalIndex,
          exactShare: Math.max(0, p.subtotal),
        }));
        const map = allocateCentsLargestRemainder(shares, lcCents);
        map.forEach((cents, idx) => {
          allocatedCentsPerPooledItem[idx] += cents;
        });
      } else {
        const shares = pooledItems.map((p) => ({
          index: p.globalIndex,
          exactShare: Math.max(0, p.weight),
        }));
        const map = allocateCentsLargestRemainder(shares, lcCents);
        map.forEach((cents, idx) => {
          allocatedCentsPerPooledItem[idx] += cents;
        });
      }
    } else if (method === 'by_margin') {
      // Create synthesized GrnLineItem array for allocateByMargin
      const synthLineItems: GrnLineItem[] = pooledItems.map((p) => ({
        itemId: `${p.grnId}_${p.item.itemId || p.itemIndexInGrn}`,
        itemName: p.item.itemName,
        quantity: p.quantity,
        unitCost: p.unitCost,
        subtotal: p.subtotal,
        weight: p.weight,
        sellingPrice: p.sellingPrice,
      }));

      const synthLc: LandedCostItem = {
        description: lc.description,
        amount: lc.amount,
        allocationMethod: 'by_margin',
        marginBasis: lc.marginBasis,
        marginFloorPercent: lc.marginFloorPercent,
        marginFloorAbsolute: lc.marginFloorAbsolute,
        allocationReason: lc.allocationReason,
      };

      const map = allocateByMargin(synthLc, synthLineItems);
      map.forEach((cents, idx) => {
        allocatedCentsPerPooledItem[idx] += cents;
      });
    } else {
      // Default: by_value
      const shares = pooledItems.map((p) => ({
        index: p.globalIndex,
        exactShare: Math.max(0, p.subtotal),
      }));
      const map = allocateCentsLargestRemainder(shares, lcCents);
      map.forEach((cents, idx) => {
        allocatedCentsPerPooledItem[idx] += cents;
      });
    }
  }

  // 3. Aggregate allocations back to GRN summaries and item allocations
  let totalAllocatedCents = 0;
  const grnItemAllocMap = new Map<string, TripItemAllocation[]>();

  pooledItems.forEach((p, idx) => {
    const cents = allocatedCentsPerPooledItem[idx] || 0;
    totalAllocatedCents += cents;
    const allocatedDollars = Number((cents / 100).toFixed(2));
    const landedUnit = Number((p.unitCost + allocatedDollars / p.quantity).toFixed(4));

    const itemAlloc: TripItemAllocation = {
      itemId: p.item.itemId,
      itemName: p.item.itemName,
      grnId: p.grnId,
      supplierName: p.supplierName,
      quantity: p.quantity,
      unitCost: p.unitCost,
      subtotal: p.subtotal,
      weight: p.weight,
      sellingPrice: p.sellingPrice,
      allocatedLandedCost: allocatedDollars,
      landedUnitCost: landedUnit,
    };

    const currentList = grnItemAllocMap.get(p.grnId) || [];
    currentList.push(itemAlloc);
    grnItemAllocMap.set(p.grnId, currentList);
  });

  const summaries: TripGrnAllocationSummary[] = safeGrns.map((g) => {
    const supp = (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier';
    const items = Array.isArray(g.lineItems) ? g.lineItems : [];
    const itemAllocs = grnItemAllocMap.get(g.id) || [];
    const grnAllocatedDollars = Number(
      itemAllocs.reduce((s, it) => s + it.allocatedLandedCost, 0).toFixed(2)
    );
    const grnSubtotal = items.reduce(
      (s, it) => s + (Number(it.subtotal) || (Number(it.quantity) || 0) * (Number(it.unitCost) || 0)),
      0
    );
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const sharePct = totalGoodsValue > 0 ? (grnSubtotal / totalGoodsValue) * 100 : 0;

    return {
      grnId: g.id,
      grnNumber: g.grnNumber || g.id,
      supplierName: supp,
      invoiceNo: g.paymentRef || g.grnNumber || g.id,
      date: g.dateReceived || '',
      paymentMode: g.paymentMode || 'credit_account',
      subtotal: Number(grnSubtotal.toFixed(2)),
      itemCount: items.length,
      totalQuantity: totalQty,
      valueSharePercent: Number(sharePct.toFixed(2)),
      allocatedLandedCost: grnAllocatedDollars,
      effectiveTotalCost: Number((grnSubtotal + grnAllocatedDollars).toFixed(2)),
      itemAllocations: itemAllocs,
    };
  });

  const isExactMatch = totalAllocatedCents === totalTripLandedCents;

  return {
    summaries,
    totalAllocatedCents,
    totalTripLandedCents,
    isExactMatch,
  };
}

/**
 * Link an existing GRN to a trip manifest
 */
export function linkGrnToTrip(tripId: string, grnId: string): { success: boolean; message: string } {
  const trip = getTripManifestById(tripId);
  if (!trip) return { success: false, message: 'Trip manifest not found' };
  if (trip.status === 'COMPLETED') return { success: false, message: 'Cannot edit completed trip' };

  if (!Array.isArray(trip.linkedGrnIds)) {
    trip.linkedGrnIds = [];
  }

  if (!trip.linkedGrnIds.includes(grnId)) {
    trip.linkedGrnIds.push(grnId);
  }

  // Refresh totals
  const allGrns = getAllGoodsReceivedNotes();
  const linked = allGrns.filter((g) => trip.linkedGrnIds.includes(g.id));
  const totalGoods = linked.reduce((sum, g) => {
    return sum + (g.lineItems || []).reduce((s, it) => s + (it.subtotal || it.quantity * it.unitCost), 0);
  }, 0);

  const totalTripLanded = (trip.landedCosts || []).reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
  trip.totalGoodsPurchased = Number(totalGoods.toFixed(2));
  trip.totalTripCost = Number((totalGoods + totalTripLanded).toFixed(2));
  trip.supplierCount = new Set(linked.map((g) => (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier')).size;
  trip.updatedAt = new Date().toISOString();

  // Run allocation preview
  const { summaries } = calculateTripCrossAllocation(trip, linked);
  trip.allocationSummary = summaries;

  saveTripManifest(trip);
  return { success: true, message: 'GRN linked to trip' };
}

/**
 * Unlink a GRN from a trip manifest and reverse its trip landed costs
 */
export function unlinkGrnFromTrip(tripId: string, grnId: string): { success: boolean; message: string } {
  const trip = getTripManifestById(tripId);
  if (!trip) return { success: false, message: 'Trip manifest not found' };

  if (!Array.isArray(trip.linkedGrnIds)) {
    trip.linkedGrnIds = [];
  }

  trip.linkedGrnIds = trip.linkedGrnIds.filter((id) => id !== grnId);

  // Clean GRN trip link and remove trip-stamped landed cost
  const allGrns = getAllGoodsReceivedNotes();
  const grn = allGrns.find((g) => g.id === grnId);
  if (grn) {
    grn.tripManifestId = undefined;
    grn.tripManifestNumber = undefined;
    grn.tripManifestAllocatedFreight = undefined;

    // Filter out trip landed costs
    if (grn.landedCosts) {
      grn.landedCosts = grn.landedCosts.filter((lc) => !lc.id?.startsWith(`trip_freight_${trip.id}`));
    }

    // Recompute GRN allocations
    const subtotal = (grn.lineItems || []).reduce((s, it) => s + (it.subtotal || it.quantity * it.unitCost), 0);
    const otherLanded = (grn.landedCosts || []).reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
    grn.lineItems.forEach((it) => {
      it.landedCostAllocated = 0;
      it.totalUnitCost = it.unitCost;
    });
    grn.totals.totalLandedCosts = otherLanded;
    grn.totals.totalInventoryValue = Number((subtotal + otherLanded).toFixed(2));

    saveGoodsReceivedNote(grn);
  }

  // Refresh remaining linked GRNs
  const linked = allGrns.filter((g) => trip.linkedGrnIds.includes(g.id));
  const totalGoods = linked.reduce((sum, g) => {
    return sum + (g.lineItems || []).reduce((s, it) => s + (it.subtotal || it.quantity * it.unitCost), 0);
  }, 0);
  const totalTripLanded = (trip.landedCosts || []).reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
  trip.totalGoodsPurchased = Number(totalGoods.toFixed(2));
  trip.totalTripCost = Number((totalGoods + totalTripLanded).toFixed(2));
  trip.supplierCount = new Set(linked.map((g) => (g.suppliers && g.suppliers[0]) || (g as any).supplier || 'Supplier')).size;
  trip.updatedAt = new Date().toISOString();

  const { summaries } = calculateTripCrossAllocation(trip, linked);
  trip.allocationSummary = summaries;

  saveTripManifest(trip);
  return { success: true, message: 'GRN unlinked from trip' };
}

/**
 * Finalize & Post Procurement Trip Manifest:
 *
 * 1. Apportions trip freight across all linked GRNs and line items.
 * 2. Stamps each GRN with its allocated share of landed costs.
 * 3. Updates inventory unit cost valuation layers via costingService.
 * 4. Records transporter cash payment or accounts payable entry.
 * 5. Preserves each supplier's invoice balance strictly at their goods subtotal!
 */
export function finalizeAndPostTripManifest(
  tripId: string,
  options?: {
    staffId?: string;
    staffName?: string;
    tillDrawerId?: string;
  }
): {
  success: boolean;
  message: string;
  trip?: ProcurementTripManifest;
  updatedGrns?: GoodsReceivedNote[];
} {
  const trip = getTripManifestById(tripId);
  if (!trip) return { success: false, message: 'Trip manifest not found' };
  if (trip.linkedGrnIds.length === 0) {
    return { success: false, message: 'Trip manifest has no linked supplier invoices' };
  }

  const allGrns = getAllGoodsReceivedNotes();
  const linkedGrns = allGrns.filter((g) => trip.linkedGrnIds.includes(g.id));
  if (linkedGrns.length === 0) {
    return { success: false, message: 'Linked supplier invoices could not be found' };
  }

  // 1. Calculate precise cross-allocation
  const { summaries, totalAllocatedCents, totalTripLandedCents, isExactMatch } =
    calculateTripCrossAllocation(trip, linkedGrns);

  if (!isExactMatch && totalTripLandedCents > 0) {
    return {
      success: false,
      message: `Allocation cent mismatch: allocated ${(totalAllocatedCents / 100).toFixed(2)} vs trip freight ${(totalTripLandedCents / 100).toFixed(2)}`,
    };
  }

  const now = new Date().toISOString();
  const shiftDate = trip.date || now.split('T')[0];
  const staffId = options?.staffId || trip.createdBy || 'USR-001';
  const staffName = options?.staffName || trip.createdByName || 'Manager';
  const tillDrawerId = options?.tillDrawerId || 'Till 1';

  // 2. Update each linked GRN with its apportioned landed cost
  const updatedGrns: GoodsReceivedNote[] = [];

  for (const summary of summaries) {
    const grn = linkedGrns.find((g) => g.id === summary.grnId);
    if (!grn) continue;

    grn.tripManifestId = trip.id;
    grn.tripManifestNumber = trip.tripNumber;
    grn.tripManifestAllocatedFreight = summary.allocatedLandedCost;

    // Build item allocation dictionary
    const itemAllocMap: { [itemId: string]: number } = {};
    summary.itemAllocations.forEach((it) => {
      itemAllocMap[it.itemId] = it.allocatedLandedCost;
    });

    // Create stamped landed cost entry for this GRN
    const primaryLc: Partial<TripLandedCost> = trip.landedCosts[0] || {
      description: 'Trip Freight',
      allocationMethod: 'by_value',
    };

    const tripLcEntry: LandedCostItem = {
      id: `trip_freight_${trip.id}`,
      description: `${primaryLc.description} (Trip: ${trip.tripNumber})`,
      amount: summary.allocatedLandedCost,
      allocationMethod: primaryLc.allocationMethod,
      marginBasis: primaryLc.marginBasis,
      marginFloorPercent: primaryLc.marginFloorPercent,
      marginFloorAbsolute: primaryLc.marginFloorAbsolute,
      allocationReason: `Apportioned from Procurement Trip ${trip.tripNumber} (${summary.valueSharePercent}% share)`,
      standardAllocation: computeStandardByValue(
        { description: 'Standard Value', amount: summary.allocatedLandedCost, allocationMethod: 'by_value' },
        grn.lineItems
      ),
      allocatedAmount: itemAllocMap,
    };

    // Replace or add trip landed cost
    const existingLcs = (grn.landedCosts || []).filter(
      (lc) => !lc.id?.startsWith(`trip_freight_${trip.id}`)
    );
    grn.landedCosts = [...existingLcs, tripLcEntry];

    // Apply allocated landed cost to line items
    grn.lineItems.forEach((li) => {
      const allocated = itemAllocMap[li.itemId] || 0;
      li.landedCostAllocated = allocated;
      if (li.quantity && li.quantity > 0) {
        li.totalUnitCost = Number((li.unitCost + allocated / li.quantity).toFixed(4));
      } else {
        li.totalUnitCost = li.unitCost;
      }
    });

    // Recompute GRN totals
    const grnSubtotal = grn.lineItems.reduce(
      (s, it) => s + (it.subtotal || it.quantity * it.unitCost),
      0
    );
    const grnTotalLanded = grn.landedCosts.reduce(
      (s, lc) => s + (Number(lc.amount) || 0),
      0
    );
    grn.totals.subtotal = Number(grnSubtotal.toFixed(2));
    grn.totals.totalLandedCosts = Number(grnTotalLanded.toFixed(2));
    grn.totals.totalInventoryValue = Number((grnSubtotal + grnTotalLanded).toFixed(2));
    grn.updatedAt = now;

    // Update inventory cost valuation layers for this GRN's items
    for (const item of grn.lineItems) {
      if (item.quantity > 0) {
        costingService.recordReceipt(
          item.itemId,
          item.quantity,
          item.totalUnitCost || item.unitCost,
          {
            grnId: grn.grnNumber,
            invoiceNo: grn.paymentRef || grn.grnNumber,
            supplier: grn.suppliers[0] || 'Supplier',
            date: grn.dateReceived,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            branchId: grn.branchId,
            notes: `Landed cost applied from Trip ${trip.tripNumber}`,
          }
        );
      }
    }

    saveGoodsReceivedNote(grn);
    updatedGrns.push(grn);
  }

  // 3. Handle Transporter / Freight Payment Accounting
  for (const lc of trip.landedCosts) {
    const freightAmount = Number(lc.amount) || 0;
    if (freightAmount <= 0) continue;

    if (lc.paymentMethod === 'cash_till') {
      const shiftId = getShiftId(staffId, shiftDate);
      const movement = addMovement({
        shiftId,
        staffId,
        terminalId: tillDrawerId,
        date: shiftDate,
        timestamp: now,
        type: 'supplier_payment',
        amount: freightAmount,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'DirectGRV',
        sourceRef: trip.tripNumber,
        notes: `Procurement Trip Freight: ${lc.transporterName || 'Transporter'} - ${trip.tripName} (${trip.tripNumber})`,
        company_id: trip.companyId,
        branch_id: trip.branchId,
      });
      lc.cashMovementId = movement.id;
    } else if (lc.paymentMethod === 'payable_account') {
      const payableId = payablesLedger.createPayable({
        grnId: trip.tripNumber,
        amount: freightAmount,
        dueDate: shiftDate,
      });
      lc.payableId = payableId;
    } else if (lc.paymentMethod === 'petty_cash') {
      const shiftId = getShiftId(staffId, shiftDate);
      const movement = addMovement({
        shiftId,
        staffId,
        terminalId: tillDrawerId,
        date: shiftDate,
        timestamp: now,
        type: 'petty_cash',
        amount: freightAmount,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form2',
        sourceRef: trip.tripNumber,
        notes: `Petty Cash: Freight for ${trip.tripName} (${trip.tripNumber})`,
        company_id: trip.companyId,
        branch_id: trip.branchId,
      });
      lc.cashMovementId = movement.id;
    }
  }

  // 4. Mark trip manifest completed
  trip.status = 'COMPLETED';
  trip.allocationSummary = summaries;
  trip.updatedAt = now;
  saveTripManifest(trip);

  return {
    success: true,
    message: `Procurement Trip ${trip.tripNumber} posted successfully. $${(totalAllocatedCents / 100).toFixed(2)} freight apportioned across ${summaries.length} supplier invoices.`,
    trip,
    updatedGrns,
  };
}

export const tripManifestService = {
  getAllTripManifests,
  saveTripManifest,
  getTripManifestById,
  generateTripNumber,
  createDraftTripManifest,
  calculateTripCrossAllocation,
  linkGrnToTrip,
  unlinkGrnFromTrip,
  finalizeAndPostTripManifest,
};
