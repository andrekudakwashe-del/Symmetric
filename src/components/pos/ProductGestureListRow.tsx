import React, { useState, useRef, useEffect } from 'react';
import { Product } from '../../types';
import { Scale, Plus, Minus } from 'lucide-react';

interface ProductGestureListRowProps {
  product: Product;
  quantityInCart: number;
  avatarBg: string;
  onTap: (product: Product) => void;
  onDecrement: (product: Product) => void;
  onRequestRemove: (product: Product) => void;
}

export const ProductGestureListRow: React.FC<ProductGestureListRowProps> = ({
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
    if (e.button !== 0) return;

    cancelTimers();
    isPointerDownRef.current = true;
    fired500Ref.current = false;
    fired2sRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setIsHolding(true);

    // 500ms Hold -> Decrement 1
    timer500Ref.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired500Ref.current = true;

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

    // 2s Hold -> Remove prompt
    timer2sRef.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired2sRef.current = true;
      setIsHolding(false);

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

    // Quick Tap -> Add +1
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

  const initials = product.name.replace(/^[* ]+/, '').slice(0, 2).toUpperCase();

  return (
    <div
      id={`product-list-row-${product.id}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={cancelTimers}
      onPointerCancel={cancelTimers}
      className={`relative select-none p-3 rounded-2xl border flex items-center justify-between transition-all duration-150 cursor-pointer touch-manipulation ${
        scaleAnim === 'up'
          ? 'scale-[1.02] ring-2 ring-emerald-400 bg-emerald-50/40'
          : scaleAnim === 'down'
          ? 'scale-[0.98] ring-2 ring-rose-400 bg-rose-50/40'
          : isHolding
          ? 'scale-[0.99] ring-2 ring-purple-400 bg-purple-50/30'
          : inCart
          ? 'bg-purple-50/40 border-purple-300 ring-1 ring-purple-300/40'
          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 shadow-sm'
      }`}
    >
      {/* Toast Feedback */}
      {gestureToast === 'Added' && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black shadow-lg flex items-center space-x-1 animate-scaleUp">
          <Plus className="w-3 h-3 stroke-[3]" />
          <span>Added</span>
        </div>
      )}
      {gestureToast === 'Removed' && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black shadow-lg flex items-center space-x-1 animate-scaleUp">
          <Minus className="w-3 h-3 stroke-[3]" />
          <span>Removed</span>
        </div>
      )}

      {/* Avatar & Title */}
      <div className="flex items-center space-x-3 min-w-0 flex-1 pr-3">
        <div
          className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0 shadow-sm transition-transform ${
            inCart ? 'bg-[#8B0000] ring-2 ring-rose-400' : avatarBg
          } ${
            scaleAnim === 'up' ? 'scale-110 bg-emerald-600' : scaleAnim === 'down' ? 'scale-90 bg-rose-700' : ''
          }`}
        >
          {inCart ? `x${quantityInCart}` : initials}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-xs sm:text-sm font-black text-slate-900 truncate">
            {product.name}
          </h4>
          <div className="flex items-center space-x-2 text-[11px] text-slate-500 mt-0.5">
            <span>{product.category || 'General'}</span>
            <span>•</span>
            <span className="font-bold text-slate-600">
              {product.sellByFraction
                ? `By ${product.fractionUnit || 'kg'}`
                : `${product.stockQuantity} ${product.unit || 'Each'}`}
            </span>
          </div>
        </div>
      </div>

      {/* Price & Cart Status */}
      <div className="text-right shrink-0">
        <div className="font-mono-num font-black text-sm text-[#1E40AF]">
          ${product.price % 1 === 0 ? product.price : product.price.toFixed(2)}
        </div>
        {inCart ? (
          <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-purple-100 text-[#6A4DFF] text-[10px] font-black">
            {quantityInCart} in cart
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 font-medium">Tap +1</span>
        )}
      </div>
    </div>
  );
};
