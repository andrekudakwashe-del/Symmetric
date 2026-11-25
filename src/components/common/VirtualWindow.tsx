import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface VirtualTableSliceOptions {
  totalCount: number;
  estimateRowHeight: number;
  overscan?: number;
  /** Minimum row count before virtualization activates (small lists render natively). */
  virtualizeThreshold?: number;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

export interface VirtualTableSliceResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  isVirtualized: boolean;
}

/**
 * Windowing hook for native HTML <table><tbody> elements.
 * Uses top and bottom spacer <tr> elements inside a scrollable container so column widths,
 * sticky <thead> headers, and horizontal scroll remain 100% native while keeping DOM nodes O(1).
 */
export function useVirtualTableSlice({
  totalCount,
  estimateRowHeight,
  overscan = 8,
  virtualizeThreshold = 45,
  scrollContainerRef,
}: VirtualTableSliceOptions): VirtualTableSliceResult {
  const rowH = Math.max(24, Math.floor(estimateRowHeight));
  const shouldVirtualize = totalCount > virtualizeThreshold;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !shouldVirtualize) return;

    const syncMetrics = () => {
      setScrollTop(el.scrollTop);
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
      }
    };

    syncMetrics();

    const handleScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (el.clientHeight > 0) {
          setViewportHeight(el.clientHeight);
        }
      });
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (ro) ro.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollContainerRef, shouldVirtualize]);

  // Clamp scrollTop when filter reduces totalCount drastically
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !shouldVirtualize) return;
    const maxScroll = Math.max(0, totalCount * rowH - viewportHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = 0;
      setScrollTop(0);
    }
  }, [totalCount, rowH, viewportHeight, scrollContainerRef, shouldVirtualize]);

  if (!shouldVirtualize) {
    return {
      startIndex: 0,
      endIndex: totalCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      isVirtualized: false,
    };
  }

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowH));
  const rawStart = Math.floor(scrollTop / rowH);
  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(totalCount, rawStart + visibleCount + overscan);
  const topSpacerHeight = startIndex * rowH;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * rowH);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    isVirtualized: true,
  };
}

export interface VirtualListProps<T> {
  items: T[];
  estimateRowHeight: number;
  overscan?: number;
  virtualizeThreshold?: number;
  /** CSS max-height class or explicit pixel height for the scroll viewport */
  containerClassName?: string;
  innerClassName?: string;
  gapPx?: number;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

/**
 * Lightweight zero-dependency virtualized feed/card list.
 * Supports variable-height cards cleanly via dynamic spacer padding (no absolute overlap bugs)
 * while keeping mounted DOM nodes bounded to viewport + overscan.
 */
export function VirtualList<T>({
  items,
  estimateRowHeight,
  overscan = 6,
  virtualizeThreshold = 45,
  containerClassName = 'max-h-[70vh] overflow-y-auto',
  innerClassName = '',
  gapPx = 0,
  getKey,
  renderItem,
}: VirtualListProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectiveRowHeight = Math.max(24, estimateRowHeight + gapPx);

  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, isVirtualized } =
    useVirtualTableSlice({
      totalCount: items.length,
      estimateRowHeight: effectiveRowHeight,
      overscan,
      virtualizeThreshold,
      scrollContainerRef: containerRef,
    });

  const renderSlice = useCallback(() => {
    const out: React.ReactNode[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const item = items[i];
      if (item === undefined) continue;
      out.push(
        <React.Fragment key={getKey(item, i)}>
          {renderItem(item, i)}
        </React.Fragment>
      );
    }
    return out;
  }, [items, startIndex, endIndex, getKey, renderItem]);

  if (!isVirtualized) {
    return (
      <div ref={containerRef} className={containerClassName}>
        <div className={innerClassName}>{renderSlice()}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={containerClassName}>
      {topSpacerHeight > 0 && (
        <div style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" />
      )}
      <div className={innerClassName}>{renderSlice()}</div>
      {bottomSpacerHeight > 0 && (
        <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true" />
      )}
    </div>
  );
}
