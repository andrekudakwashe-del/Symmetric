import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../../types';
import { Scale, Trash2, Plus, Minus, Check } from 'lucide-react';

interface ProductGestureCardProps {
  product: Product;
  quantityInCart: number;
  avatarBg: string;
  onTap: (product: Product) => void;
  onDecrement: (product: Product) => void;
  onRequestRemove: (product: Product) => void;
}

export const ProductGestureCard: React.FC<ProductGestureCardProps> = ({
  product,
  quantityInCart,
  avatarBg,
  onTap,
  onDecrement,
  onRequestRemove,
}) => {
  const inCart = quantityInCart > 0;
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
      className={`relative select-none rounded-2xl border p-3 sm:p-3.5 flex flex-col justify-between text-center cursor-pointer transition-all duration-150 shadow-sm min-h-[185px] touch-manipulation ${
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
        <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black shadow-lg flex items-center space-x-1 animate-scaleUp">
          <Plus className="w-3 h-3 stroke-[3]" />
          <span>Added</span>
        </div>
      )}

      {gestureToast === 'Removed' && (
        <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black shadow-lg flex items-center space-x-1 animate-scaleUp">
          <Minus className="w-3 h-3 stroke-[3]" />
          <span>Removed</span>
        </div>
      )}

      {/* Stock Indicator Top-Right Badge (matches screenshot) */}
      {product.sellByFraction ? (
        <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-0.5">
          <Scale className="w-2.5 h-2.5" />
          <span>By {product.fractionUnit || 'kg'}</span>
        </span>
      ) : product.stockQuantity === 0 && (!product.stockCases || product.stockCases === 0) ? (
        <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
          OOS
        </span>
      ) : (
        <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
          {product.stockQuantity} {product.unit || 'Each'}
        </span>
      )}

      {/* Circular Avatar / Cart Count (Matches Screenshot) */}
      <div className="flex justify-center mt-1 mb-2">
        <div
          className={`w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white shadow-md transition-all duration-200 ${
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
          style={{ width: '3.25rem', height: '3.25rem' }}
        >
          {inCart ? (
            <span className="text-sm font-black tracking-tighter">
              x {quantityInCart}
            </span>
          ) : (
            <span className="text-xs font-bold opacity-95">
              {initials}
            </span>
          )}
        </div>
      </div>

      {/* Product Name (Full Name Display, wrapping cleanly without truncation) */}
      <div className="w-full flex-1 flex flex-col justify-center my-1">
        <h4 className="text-xs sm:text-sm font-black tracking-tight text-slate-900 leading-snug break-words">
          {product.name}
        </h4>

        {/* Variant / Category description */}
        <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium break-words mt-0.5">
          {product.category || 'General Merchandise'}
        </div>

        {/* Fractional quick indicator */}
        {product.sellByFraction && (
          <div className="mt-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              <Scale className="w-3 h-3" />
              <span>Weight / Price Factor</span>
            </span>
          </div>
        )}
      </div>

      {/* Bottom Row: Price & In-Cart Status Badge */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between mt-auto">
        <div className="font-mono-num font-black text-xs sm:text-sm text-[#1E40AF]">
          ${product.price % 1 === 0 ? product.price : product.price.toFixed(2)}
          {product.sellByFraction && (
            <span className="text-[10px] text-slate-500 font-normal block text-left">
              /{product.fractionUnit || 'kg'}
            </span>
          )}
        </div>

        {inCart ? (
          <span className="px-2 py-0.5 rounded-full bg-purple-100 text-[#6A4DFF] text-[10px] font-black border border-purple-200">
            {quantityInCart} in cart
          </span>
        ) : (
          <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-600">
            Tap to add
          </span>
        )}
      </div>
    </div>
  );
};
