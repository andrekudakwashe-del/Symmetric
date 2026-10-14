import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../../types';
import { getCurrentUser, isSupervisorOrAbove } from '../../db/roomDatabase';
import { Scale, Trash2, Plus, Minus, Check } from 'lucide-react';

interface ProductGestureCardProps {
  product: Product;
  quantityInCart: number;
  avatarBg: string;
  density?: 'compact' | 'standard' | 'dense';
  onTap: (product: Product) => void;
  onDecrement: (product: Product) => void;
  onRequestRemove: (product: Product) => void;
}

export const ProductGestureCard: React.FC<ProductGestureCardProps> = ({
  product,
  quantityInCart,
  avatarBg,
  density = 'compact',
  onTap,
  onDecrement,
  onRequestRemove,
}) => {
  const inCart = quantityInCart > 0;
  const isCompact = density === 'compact';
  const isDense = density === 'dense';
  const [scaleAnim, setScaleAnim] = useState<'idle' | 'up' | 'down'>('idle');
  const [gestureToast, setGestureToast] = useState<'Added' | 'Removed' | null>(null);
  const [isHolding, setIsHolding] = useState<boolean>(false);

  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const fired500Ref = useRef<boolean>(false);
  const fired2sRef = useRef<boolean>(false);
  const timer500Ref = useRef<NodeJS.Timeout | null>(null);
  const timer2sRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scaleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timer500Ref.current) clearTimeout(timer500Ref.current);
      if (timer2sRef.current) clearTimeout(timer2sRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (scaleTimeoutRef.current) clearTimeout(scaleTimeoutRef.current);
    };
  }, []);

  const triggerToast = (msg: 'Added' | 'Removed') => {
    setGestureToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setGestureToast(null);
    }, 1100);
  };

  const triggerScale = (type: 'up' | 'down') => {
    setScaleAnim(type);
    if (scaleTimeoutRef.current) clearTimeout(scaleTimeoutRef.current);
    scaleTimeoutRef.current = setTimeout(() => {
      setScaleAnim('idle');
    }, 220);
  };

  const cancelTimers = () => {
    if (timer500Ref.current) {
      clearTimeout(timer500Ref.current);
      timer500Ref.current = null;
    }
    if (timer2sRef.current) {
      clearTimeout(timer2sRef.current);
      timer2sRef.current = null;
    }
    isPointerDownRef.current = false;
    startPosRef.current = null;
    setIsHolding(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button (left mouse click or touch)
    if (e.button !== 0) return;

    cancelTimers();
    isPointerDownRef.current = true;
    fired500Ref.current = false;
    fired2sRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setIsHolding(true);

    // 1. Long Press 500ms:
    // Decrements quantity by 1, vibrates (60ms), shows "Removed" toast, animates scale-down
    timer500Ref.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired500Ref.current = true;

      // Haptic feedback
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(60);
        }
      } catch (_) {}

      triggerScale('down');
      triggerToast('Removed');

      if (quantityInCart > 0) {
        onDecrement(product);
      }
    }, 500);

    // 2. Long Press 2 Seconds (2000ms):
    // Prompts Remove confirmation dialog if in cart
    timer2sRef.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired2sRef.current = true;
      setIsHolding(false);

      // Distinct haptic pattern for 2s hold
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
      } catch (_) {}

      if (quantityInCart > 0) {
        onRequestRemove(product);
      }
    }, 2000);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Prevent accidental triggers when user is scrolling the item grid
    if (isPointerDownRef.current && startPosRef.current) {
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > 10 || dy > 10) {
        cancelTimers();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;

    const was500Fired = fired500Ref.current;
    const was2sFired = fired2sRef.current;
    cancelTimers();

    // If released before 500ms and 2s -> ON QUICK TAP:
    // Adds +1 to cart, vibrates briefly, shows "Added" toast, animates scale-up
    if (!was500Fired && !was2sFired) {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(30);
        }
      } catch (_) {}

      triggerScale('up');
      triggerToast('Added');
      onTap(product);
    }
  };

  const handlePointerLeave = () => {
    cancelTimers();
  };

  const handlePointerCancel = () => {
    cancelTimers();
  };

  const initials = product.name.replace(/^[* ]+/, '').slice(0, 2).toUpperCase();

  return (
    <div
      id={`product-card-${product.id}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      className={`relative select-none rounded-2xl border text-center cursor-pointer transition-all duration-150 shadow-xs touch-manipulation flex flex-col justify-between ${
        isDense
          ? 'p-1 min-h-[82px] max-h-[110px]'
          : isCompact
          ? 'p-1.5 sm:p-2 min-h-[96px] max-h-[128px]'
          : 'p-3 sm:p-3.5 min-h-[160px]'
      } ${
        scaleAnim === 'up'
          ? 'scale-105 ring-4 ring-emerald-400/50 bg-emerald-50/40'
          : scaleAnim === 'down'
          ? 'scale-95 ring-4 ring-rose-400/50 bg-rose-50/40'
          : isHolding
          ? 'scale-[0.98] ring-2 ring-purple-400 bg-purple-50/30'
          : inCart
          ? 'bg-slate-50 border-purple-400 text-slate-950 ring-2 ring-[#6A4DFF]/30'
          : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Floating Gesture Feedback Badges */}
      {gestureToast === 'Added' && (
        <div
          className={`absolute z-20 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-black shadow-lg flex items-center space-x-0.5 animate-scaleUp ${
            isDense || isCompact ? 'top-1 left-1 text-[7.5px]' : 'top-2 left-2 text-[10px]'
          }`}
        >
          <Plus className="w-2.5 h-2.5 stroke-[3]" />
          <span>Added</span>
        </div>
      )}

      {gestureToast === 'Removed' && (
        <div
          className={`absolute z-20 px-1.5 py-0.5 rounded-full bg-rose-600 text-white font-black shadow-lg flex items-center space-x-0.5 animate-scaleUp ${
            isDense || isCompact ? 'top-1 left-1 text-[7.5px]' : 'top-2 left-2 text-[10px]'
          }`}
        >
          <Minus className="w-2.5 h-2.5 stroke-[3]" />
          <span>Removed</span>
        </div>
      )}

      {/* Stock Indicator Top-Right Badge (Blind for cashiers to prevent theft/count cheating) */}
      {(() => {
        const user = getCurrentUser();
        const canSeeRawStock = isSupervisorOrAbove(user?.role) || Boolean(user?.permissions?.canManageInventory);
        const isOOS = product.stockQuantity === 0 && (!product.stockCases || product.stockCases === 0);
        const totalStockUnits = (Number(product.stockCases) || 0) * (product.unitsPerCase || 1) + (Number(product.stockQuantity) || 0);
        const reorderLimit = product.reorderLevelUnits || 5;
        const isLowStock = !isOOS && totalStockUnits <= reorderLimit;
        const badgeSize = isDense ? 'top-0.5 right-0.5 text-[7px] px-1 py-0.2' : isCompact ? 'top-1 right-1 text-[7.5px] px-1 py-0.2' : 'top-2 right-2 text-[9px] px-1.5 py-0.5';

        if (product.sellByFraction) {
          return (
            <span className={`absolute ${badgeSize} font-black rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-0.5`}>
              <Scale className="w-2 h-2" />
              <span>By {product.fractionUnit || 'kg'}</span>
            </span>
          );
        }

        if (isOOS) {
          return (
            <span className={`absolute ${badgeSize} font-black rounded bg-rose-100 text-rose-700`}>
              OOS
            </span>
          );
        }

        if (!canSeeRawStock) {
          return isLowStock ? (
            <span className={`absolute ${badgeSize} font-black rounded bg-amber-100 text-amber-800 border border-amber-300`}>
              Low
            </span>
          ) : (
            <span className={`absolute ${badgeSize} font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200`}>
              In Stock
            </span>
          );
        }

        return (
          <span className={`absolute ${badgeSize} font-bold rounded ${
            isLowStock ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-slate-100 text-slate-600'
          }`}>
            {product.stockQuantity} {product.unit || 'ea'}
          </span>
        );
      })()}

      {/* Circular Avatar / Cart Count */}
      <div className={`flex justify-center ${isDense ? 'mt-0.5 mb-0.5' : isCompact ? 'mt-0.5 mb-0.5' : 'mt-1 mb-2'}`}>
        <div
          className={`rounded-full flex items-center justify-center text-white shadow-sm transition-all duration-200 ${
            inCart
              ? 'bg-[#8B0000] scale-105 ring-2 ring-rose-400'
              : avatarBg
          } ${
            scaleAnim === 'up'
              ? 'scale-125 bg-emerald-600'
              : scaleAnim === 'down'
              ? 'scale-90 bg-rose-700'
              : ''
          }`}
          style={
            isDense
              ? { width: '1.6rem', height: '1.6rem' }
              : isCompact
              ? { width: '1.95rem', height: '1.95rem' }
              : { width: '3rem', height: '3rem' }
          }
        >
          {inCart ? (
            <span className={`font-black tracking-tighter ${isDense ? 'text-[9px]' : isCompact ? 'text-[10px]' : 'text-sm'}`}>
              x{quantityInCart}
            </span>
          ) : (
            <span className={`font-bold opacity-95 ${isDense ? 'text-[8.5px]' : isCompact ? 'text-[9.5px]' : 'text-xs'}`}>
              {initials}
            </span>
          )}
        </div>
      </div>

      {/* Product Name (Clean responsive clamp matching density) */}
      <div className={`w-full flex-1 flex flex-col justify-center ${isDense ? 'my-0.5' : isCompact ? 'my-0.5' : 'my-1'}`}>
        <h4 className={`font-black tracking-tight text-slate-900 ${
          isDense
            ? 'text-[9.5px] leading-tight line-clamp-1'
            : isCompact
            ? 'text-[10.5px] leading-tight line-clamp-2'
            : 'text-xs sm:text-sm leading-snug break-words'
        }`}>
          {product.name}
        </h4>

        {/* Variant / Category description */}
        {!isDense && (
          <div className={`text-slate-500 font-medium truncate ${isCompact ? 'text-[8.5px] mt-0.2' : 'text-[10px] sm:text-[11px] mt-0.5'}`}>
            {product.category || 'General'}
          </div>
        )}

        {/* Fractional quick indicator */}
        {product.sellByFraction && !isDense && (
          <div className="mt-0.5">
            <span className="inline-flex items-center gap-0.5 text-[8px] sm:text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
              <Scale className="w-2.5 h-2.5" />
              <span>By {product.fractionUnit || 'kg'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Bottom Row: Price & In-Cart Status Badge */}
      <div className={`border-t border-slate-100 flex items-center justify-between mt-auto ${isDense ? 'pt-0.5' : isCompact ? 'pt-0.5' : 'pt-2'}`}>
        <div className={`font-mono-num font-black text-[#1E40AF] ${isDense ? 'text-[9.5px]' : isCompact ? 'text-[10.5px]' : 'text-xs sm:text-sm'}`}>
          ${product.price % 1 === 0 ? product.price : product.price.toFixed(2)}
          {product.sellByFraction && (
            <span className="text-[7.5px] text-slate-500 font-normal inline sm:block">
              /{product.fractionUnit || 'kg'}
            </span>
          )}
        </div>

        {inCart ? (
          <span className={`rounded-full bg-purple-100 text-[#6A4DFF] font-black border border-purple-200 ${
            isDense ? 'px-1 py-0.2 text-[7.5px]' : isCompact ? 'px-1.5 py-0.2 text-[8px]' : 'px-2 py-0.5 text-[10px]'
          }`}>
            {quantityInCart} in cart
          </span>
        ) : (
          <span className={`font-bold text-slate-400 group-hover:text-slate-600 ${
            isDense ? 'text-[7.5px]' : isCompact ? 'text-[8px]' : 'text-[10px]'
          }`}>
            {isDense || isCompact ? '+ Add' : 'Tap to add'}
          </span>
        )}
      </div>
    </div>
  );
};
