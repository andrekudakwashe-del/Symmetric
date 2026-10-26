/**
 * dateUtils.ts
 * Bulletproof, crash-resilient date & timestamp helpers.
 * Never throws "timestamp.slice is not a function" regardless of whether the
 * input is undefined, null, a number (Unix ms integer), a Date object, an ISO string,
 * or an object from Firebase/P2P sync.
 */

export function toIsoStringSafe(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';

  if (typeof val === 'number') {
    if (isNaN(val)) return '';
    try {
      return new Date(val).toISOString();
    } catch {
      return '';
    }
  }

  if (val instanceof Date) {
    try {
      return isNaN(val.getTime()) ? '' : val.toISOString();
    } catch {
      return '';
    }
  }

  if (typeof val === 'object' && val !== null) {
    // Firestore Timestamp or similar { seconds, nanoseconds } or { toDate: () => Date }
    if ('toDate' in val && typeof (val as any).toDate === 'function') {
      try {
        return (val as any).toDate().toISOString();
      } catch {}
    }
    if ('seconds' in val && typeof (val as any).seconds === 'number') {
      try {
        return new Date((val as any).seconds * 1000).toISOString();
      } catch {}
    }
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return '';
    // Check if it's a numeric string like "1730000000000"
    if (/^\d{10,13}$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!isNaN(num)) {
        try {
          return new Date(num).toISOString();
        } catch {}
      }
    }
    return trimmed;
  }

  try {
    return String(val);
  } catch {
    return '';
  }
}

/**
 * Safely extracts a substring slice from any date/timestamp value.
 * Guaranteed to return a string without throwing.
 */
export function safeDateSlice(val: unknown, start: number = 0, end?: number): string {
  const str = toIsoStringSafe(val);
  if (!str) return '';
  return end !== undefined ? str.slice(start, end) : str.slice(start);
}

/**
 * Safely extracts YYYY-MM-DD from any date, timestamp, or number.
 */
export function toDateStringSafe(val: unknown): string {
  const slice = safeDateSlice(val, 0, 10);
  // If format is like YYYY-MM-DD
  if (slice.length >= 10 && slice[4] === '-' && slice[7] === '-') {
    return slice;
  }
  // Try parsing into Date if format is non-standard
  if (val) {
    try {
      const d = new Date(val as any);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch {}
  }
  return slice;
}

/**
 * Safely extracts HH:mm from any timestamp or date.
 */
export function toTimeStringSafe(val: unknown): string {
  const iso = toIsoStringSafe(val);
  if (!iso) return '';
  const tIdx = iso.indexOf('T');
  if (tIdx !== -1 && iso.length >= tIdx + 6) {
    return iso.slice(tIdx + 1, tIdx + 6);
  }
  return '';
}

/**
 * Checks whether an item's date or timestamp matches a target date string (YYYY-MM-DD).
 * Resilient against numbers, nulls, missing fields, and UTC/local offset variance.
 */
export function isSameDaySafe(itemDate: unknown, itemTimestamp: unknown, targetDate: string): boolean {
  if (!targetDate) return false;
  if (typeof itemDate === 'string' && itemDate === targetDate) return true;
  if (itemDate && String(itemDate).startsWith(targetDate)) return true;

  if (itemTimestamp !== undefined && itemTimestamp !== null) {
    const extractedDate = toDateStringSafe(itemTimestamp);
    if (extractedDate === targetDate) return true;

    // Check local date equivalent in case UTC shifted the date
    try {
      const d = new Date(itemTimestamp as any);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        if (`${y}-${m}-${day}` === targetDate) return true;
      }
    } catch {}
  }

  return false;
}
