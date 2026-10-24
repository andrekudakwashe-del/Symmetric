import { InventoryItem, Product, SaleItem } from '../types';
import { getAllGoodsReceivedNotes } from '../db/goodsReceivedNotes';

export interface ResolvedItemCost {
  avgCost: number; // AVCO cost basis (per sold item, whether unit, pack, or case)
  latestCost: number; // Latest purchase price cost basis
  itemType: 'unit' | 'case' | 'pack';
  matchedItemId?: string;
  matchedItemName?: string;
  matchedSku?: string;
  category: string;
  currentStock: number;
  stockStatus: 'Out of Stock' | 'Low Stock' | 'In Stock';
  canonicalKey: string;
  displayName: string;
}

/**
 * Cache of latest GRN purchase costs to guarantee true replacement cost
 */
let latestGrnCostCache: Map<string, number> | null = null;
let lastGrnCacheTime = 0;

export function getLatestGrnUnitCost(itemId: string, sku?: string): number | undefined {
  const now = Date.now();
  if (!latestGrnCostCache || now - lastGrnCacheTime > 4000) {
    latestGrnCostCache = new Map<string, number>();
    lastGrnCacheTime = now;
    try {
      const grns = getAllGoodsReceivedNotes();
      const sorted = [...grns].sort((a, b) => {
        const da = new Date(a.dateReceived || a.createdAt).getTime();
        const db = new Date(b.dateReceived || b.createdAt).getTime();
        return db - da;
      });
      for (const g of sorted) {
        if (g.lineItems && Array.isArray(g.lineItems)) {
          for (const li of g.lineItems) {
            const cost = Number(li.unitCost) || 0;
            if (cost > 0) {
              const idKey = (li.itemId || '').toUpperCase();
              const skuKey = (li.sku || '').toUpperCase();
              if (idKey && !latestGrnCostCache.has(idKey)) {
                latestGrnCostCache.set(idKey, cost);
              }
              if (skuKey && !latestGrnCostCache.has(skuKey)) {
                latestGrnCostCache.set(skuKey, cost);
              }
            }
          }
        }
      }
    } catch {
      // Safe fallback
    }
  }

  const cleanId = (itemId || '').toUpperCase();
  const cleanSku = (sku || '').toUpperCase();
  if (cleanId && latestGrnCostCache.has(cleanId)) return latestGrnCostCache.get(cleanId);
  if (cleanSku && latestGrnCostCache.has(cleanSku)) return latestGrnCostCache.get(cleanSku);
  return undefined;
}

/**
 * Normalizes a product or variant name by removing packaging suffixes for base item matching
 */
export function normalizeRootName(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b(case|each|single|singles|unit|units|pack|packs|pk|pks|prepack|prepacks)\b/gi, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/[$]\s*[\d.]+/g, '') // remove price tags like ($1.00)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * High-precision cost and stock resolver that accurately maps sold items
 * (singles, cases, prepacks/variants like 'Ninja packs', Cremora, Ellis Brown)
 * to their live Inventory Master values.
 */
export function resolveItemCost(
  item: SaleItem | { id?: string; name?: string; sku?: string; unitPrice?: number; quantity?: number; total?: number; [key: string]: any },
  inventoryItems: InventoryItem[],
  products: Product[]
): ResolvedItemCost {
  const rawId = (item.id || '').trim();
  const rawName = (item.name || '').trim();
  const rawSku = (item.sku || '').trim();
  const itemQty = Number(item.quantity) || 1;
  const unitPrice =
    Number(item.unitPrice) ||
    (itemQty > 0 ? (Number(item.total) || 0) / itemQty : 0);

  const cleanId = rawId.toUpperCase();
  const cleanName = rawName.toLowerCase();
  const cleanSku = rawSku.toUpperCase();
  const rootName = normalizeRootName(cleanName);

  // 1. Detect packaging type: Case vs Pack/Variant vs Single/Unit
  const isCase =
    cleanId.endsWith('-CASE') ||
    cleanSku.endsWith('-CS') ||
    /\bcase\b/i.test(cleanName) ||
    /\bcs\b/i.test(cleanName) ||
    (item as any).isCase === true ||
    (item as any).unit?.toLowerCase().includes('case');

  const isPack =
    cleanId.includes('__') ||
    /\bpack(s)?\b/i.test(cleanName) ||
    /\bpk(s)?\b/i.test(cleanName) ||
    /\bprepack(s)?\b/i.test(cleanName) ||
    Boolean((item as any).variantId) ||
    Number((item as any).unitsPerPack) > 1;

  // 2. Derive base item ID
  let baseId = cleanId;
  if (baseId.endsWith('-CASE')) baseId = baseId.replace(/-CASE$/, '');
  if (baseId.endsWith('-UNIT')) baseId = baseId.replace(/-UNIT$/, '');
  if (baseId.includes('__')) baseId = baseId.split('__')[0];

  // 3. Find matching InventoryItem
  let matchedInv = inventoryItems.find((inv) => (inv.itemId || '').toUpperCase() === cleanId);
  if (!matchedInv && baseId) {
    matchedInv = inventoryItems.find((inv) => (inv.itemId || '').toUpperCase() === baseId);
  }
  if (!matchedInv && cleanSku) {
    matchedInv = inventoryItems.find((inv) => {
      const invSku = (inv.sku || '').toUpperCase();
      return (
        invSku === cleanSku ||
        invSku === cleanSku.replace(/-CS$/, '') ||
        invSku === cleanSku.replace(/-UNIT$/, '')
      );
    });
  }
  if (!matchedInv && cleanName) {
    matchedInv = inventoryItems.find((inv) => (inv.itemName || '').toLowerCase().trim() === cleanName);
  }
  if (!matchedInv && rootName) {
    matchedInv = inventoryItems.find((inv) => {
      const invRoot = normalizeRootName(inv.itemName || '');
      return (
        invRoot === rootName ||
        (invRoot.length >= 3 && rootName.startsWith(invRoot)) ||
        (rootName.length >= 3 && invRoot.startsWith(rootName))
      );
    });
  }
  if (!matchedInv && cleanName) {
    // Check if variant name inside any inventory item matches (e.g., 'Ninja packs', 'Pack of 10s')
    matchedInv = inventoryItems.find((inv) =>
      inv.packagingVariants?.some((v) => {
        const vName = (v.name || '').toLowerCase().trim();
        return (
          vName &&
          (cleanName.includes(vName) ||
            vName.includes(cleanName) ||
            cleanName.includes(normalizeRootName(vName)))
        );
      })
    );
  }

  // 4. Find matching Product
  const matchedProduct = products.find((p) => {
    const pId = (p.id || '').toUpperCase();
    const pName = (p.name || '').toLowerCase().trim();
    return (
      pId === cleanId ||
      pName === cleanName ||
      (rootName && normalizeRootName(pName) === rootName)
    );
  });

  // 5. Cost & stock calculation
  let avgCost = 0;
  let latestCost = 0;
  let currentStock = 0;
  let reorderLevel = 5;
  let itemType: 'unit' | 'case' | 'pack' = 'unit';
  let resolvedDisplayName = rawName || 'Unknown Product';
  let canonicalKey = cleanId || cleanName || 'UNKNOWN';

  if (matchedInv) {
    const unitsPerCase = Math.max(1, matchedInv.unitsPerCase || 1);
    const fallbackUnitCost =
      matchedInv.costPerUnit !== undefined && matchedInv.costPerUnit > 0
        ? matchedInv.costPerUnit
        : (matchedInv.costPerCase || 0) / unitsPerCase;

    const avgUnitCost =
      matchedInv.averageCostPerUnit !== undefined && matchedInv.averageCostPerUnit > 0
        ? matchedInv.averageCostPerUnit
        : fallbackUnitCost;

    const grnUnitCost = getLatestGrnUnitCost(matchedInv.itemId, matchedInv.sku);

    const latestUnitCost =
      grnUnitCost !== undefined && grnUnitCost > 0
        ? grnUnitCost
        : (matchedInv.latestCostPerUnit !== undefined && matchedInv.latestCostPerUnit > 0
            ? matchedInv.latestCostPerUnit
            : (matchedInv.costPerUnit && matchedInv.costPerUnit > 0
                ? matchedInv.costPerUnit
                : fallbackUnitCost));

    if (isCase) {
      itemType = 'case';
      const caseCostFallback =
        matchedInv.costPerCase !== undefined && matchedInv.costPerCase > 0
          ? matchedInv.costPerCase
          : fallbackUnitCost * unitsPerCase;

      avgCost =
        matchedInv.averageCostPerCase !== undefined && matchedInv.averageCostPerCase > 0
          ? matchedInv.averageCostPerCase
          : (avgUnitCost * unitsPerCase || caseCostFallback);

      const grnCaseCost = grnUnitCost ? grnUnitCost * unitsPerCase : undefined;
      latestCost =
        grnCaseCost !== undefined && grnCaseCost > 0
          ? grnCaseCost
          : (matchedInv.latestCostPerCase !== undefined && matchedInv.latestCostPerCase > 0
              ? matchedInv.latestCostPerCase
              : (matchedInv.costPerCase && matchedInv.costPerCase > 0
                  ? matchedInv.costPerCase
                  : latestUnitCost * unitsPerCase || caseCostFallback));

      currentStock =
        matchedInv.stockCases !== undefined
          ? matchedInv.stockCases
          : Math.floor((matchedInv.totalUnits || 0) / unitsPerCase);
      reorderLevel = matchedInv.reorderLevelCases ?? 2;
      canonicalKey = `${matchedInv.itemId}-CASE`;
      resolvedDisplayName = /\bcase\b/i.test(rawName)
        ? rawName
        : `${matchedInv.itemName} ${matchedInv.casePackageName || 'Case'}`;
    } else if (isPack) {
      itemType = 'pack';
      let variant = cleanId.includes('__')
        ? matchedInv.packagingVariants?.find(
            (v) => v.id && v.id.toUpperCase() === cleanId.split('__')[1]
          )
        : undefined;

      if (!variant && matchedInv.packagingVariants) {
        variant = matchedInv.packagingVariants.find((v) => {
          const vName = (v.name || '').toLowerCase().trim();
          return (
            vName &&
            (cleanName.includes(vName) ||
              vName.includes(cleanName) ||
              cleanName.includes(normalizeRootName(vName)))
          );
        });
      }

      // Detect units in pack (e.g. 10s, 5s, 2s, 10pk, 20pk)
      const packUnitsMatch = cleanName.match(/(\d+)\s*(s|pk|pack)/i);
      const unitsInPack =
        variant?.unitsPerPack ||
        Number((item as any).unitsPerPack) ||
        (packUnitsMatch ? Number(packUnitsMatch[1]) : (cleanName.includes('ninja') ? 10 : 1));

      const vCostFallback =
        variant?.costPrice !== undefined && variant.costPrice > 0
          ? variant.costPrice
          : fallbackUnitCost * unitsInPack;

      avgCost =
        variant?.costPrice !== undefined && variant.costPrice > 0
          ? variant.costPrice
          : (avgUnitCost * unitsInPack || vCostFallback);

      latestCost =
        variant?.costPrice !== undefined && variant.costPrice > 0
          ? variant.costPrice
          : (latestUnitCost * unitsInPack || vCostFallback);

      currentStock = Math.floor((matchedInv.totalUnits || 0) / Math.max(1, unitsInPack));
      reorderLevel = 5;
      canonicalKey = variant
        ? `${matchedInv.itemId}__${variant.id}`
        : `${matchedInv.itemId}__PACK_${unitsInPack}`;
      resolvedDisplayName = variant
        ? (rawName.includes(variant.name) ? rawName : `${matchedInv.itemName} (${variant.name})`)
        : rawName;
    } else {
      itemType = 'unit';
      avgCost = avgUnitCost;
      latestCost = latestUnitCost;
      currentStock = matchedInv.totalUnits ?? matchedInv.stockSingles ?? 0;
      reorderLevel = matchedInv.reorderLevelUnits ?? 5;
      canonicalKey =
        matchedInv.canSellAsCase || (matchedInv.packagingVariants && matchedInv.packagingVariants.length > 0)
          ? `${matchedInv.itemId}-UNIT`
          : matchedInv.itemId;
      resolvedDisplayName = rawName || `${matchedInv.itemName} Each`;
    }
  } else if (matchedProduct) {
    const prodCost = matchedProduct.costPrice || matchedProduct.costPerUnit || 0;
    const grnProdCost = getLatestGrnUnitCost(matchedProduct.id, matchedProduct.sku);
    if (prodCost > 0) {
      avgCost = prodCost;
      latestCost = grnProdCost !== undefined && grnProdCost > 0 ? grnProdCost : prodCost;
    } else if (grnProdCost !== undefined && grnProdCost > 0) {
      avgCost = grnProdCost;
      latestCost = grnProdCost;
    }
    currentStock = matchedProduct.stockQuantity ?? 0;
    canonicalKey = matchedProduct.id;
    resolvedDisplayName = matchedProduct.name;
    if (matchedProduct.id.endsWith('-CASE')) itemType = 'case';
    else if (matchedProduct.id.includes('__')) itemType = 'pack';
  }

  // 6. Fallback checks if cost from inventory master is not available
  if (avgCost <= 0) {
    const snapshotCost = (item as any).costPrice;
    if (snapshotCost !== undefined && Number(snapshotCost) > 0) {
      avgCost = Number(snapshotCost);
      latestCost = Number(snapshotCost);
    }
  }

  if (avgCost <= 0) {
    const snapAvg = Number((item as any).costPerUnitAverage);
    // Discard dummy 70% fallback if it was generated automatically
    const isDummyFallback = unitPrice > 0 && snapAvg > 0 && Math.abs(snapAvg - unitPrice * 0.7) < 0.001;
    if (snapAvg > 0 && !isDummyFallback) {
      avgCost = snapAvg;
      latestCost = Number((item as any).costPerUnitLatest) || snapAvg;
    }
  }

  // Also check if sale item has a recorded latest cost snapshot
  const itemLatestSnap = Number((item as any).costPerUnitLatest) || Number((item as any).latestCost);
  if (itemLatestSnap > 0) {
    latestCost = itemLatestSnap;
  }

  // Final emergency fallback if totally unknown
  if (avgCost <= 0) {
    avgCost = unitPrice > 0 ? Number((unitPrice * 0.7).toFixed(4)) : 0;
    latestCost = avgCost;
  }

  let stockStatus: 'Out of Stock' | 'Low Stock' | 'In Stock' = 'In Stock';
  if (currentStock <= 0) stockStatus = 'Out of Stock';
  else if (currentStock <= reorderLevel) stockStatus = 'Low Stock';

  return {
    avgCost,
    latestCost,
    itemType,
    matchedItemId: matchedInv?.itemId || matchedProduct?.id || rawId,
    matchedItemName: matchedInv?.itemName || matchedProduct?.name || rawName,
    matchedSku:
      matchedInv?.sku ||
      matchedProduct?.sku ||
      rawSku ||
      (rawId ? rawId.substring(0, 8) : 'N/A'),
    category:
      matchedInv?.category ||
      matchedProduct?.category ||
      (item as any).category ||
      'General',
    currentStock,
    stockStatus,
    canonicalKey,
    displayName: resolvedDisplayName,
  };
}
