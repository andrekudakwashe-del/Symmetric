import React, { useState, useRef, useEffect } from 'react';
import { CartItem } from '../../types';
import { Pencil, Scale, Trash2 } from 'lucide-react';

interface CartItemGestureRowProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemoveItem: (productId: string) => void;
  onStartEdit: (item: CartItem) => void;
  onRequestRemoveDialog: (item: CartItem) => void;
}

export const CartItemGestureRow: React.FC<CartItemGestureRowProps> = ({
  item,
  onUpdateQuantity,
  onRemoveItem,
  onStartEdit,
  onRequestRemoveDialog,
}) => {
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

  // Clear timers on unmount
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
    }, 1200);
  };

  const triggerScale = (type: 'up' | 'down') => {
    setScaleAnim(type);
    if (scaleTimeoutRef.current) clearTimeout(scaleTimeoutRef.current);
    scaleTimeoutRef.current = setTimeout(() => {
      setScaleAnim('idle');
    }, 250);
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
    // Only primary button (mouse left-click or touch)
    if (e.button !== 0) return;

    cancelTimers();
    isPointerDownRef.current = true;
    fired500Ref.current = false;
    fired2sRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setIsHolding(true);

    // 1. Long press 500ms: decrease quantity by 1, vibrate, show "Removed", scale down
    timer500Ref.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired500Ref.current = true;

      // Vibrate
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(60);
        }
      } catch (_) {}

      triggerScale('down');
      triggerToast('Removed');

      if (item.quantity <= 1) {
        onRemoveItem(item.product.id);
      } else {
        onUpdateQuantity(item.product.id, -1);
      }
    }, 500);

    // 2. Long press 2 seconds: trigger Remove Item dialog
    timer2sRef.current = setTimeout(() => {
      if (!isPointerDownRef.current) return;
      fired2sRef.current = true;
      setIsHolding(false);

      // Distinct haptic vibration pattern for 2s confirmation
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
      } catch (_) {}

      onRequestRemoveDialog(item);
    }, 2000);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Prevent accidental triggers: only trigger long press if finger stays within bounds
    if (isPointerDownRef.current && startPosRef.current) {
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      // If moved more than 10 pixels, user is scrolling or moved out of bounds
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

    // If released before 500ms and 2s, this is ON TAP / CLICK
    if (!was500Fired && !was2sFired) {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(35);
        }
      } catch (_) {}

      triggerScale('up');
      triggerToast('Added');
      onUpdateQuantity(item.product.id, 1);
    }
  };

  const handlePointerLeave = () => {
    cancelTimers();
  };

  const handlePointerCancel = () => {
    cancelTimers();
  };

  const unitPrice =
    item.customPrice !== undefined ? item.customPrice : item.product.price;
  const lineTotal = unitPrice * item.quantity;
  const isOOS = item.product.stockQuantity === 0;
  const isFractional = item.isFractional || item.product.sellByFraction;
  const unitLabel = item.fractionUnit || item.product.fractionUnit || item.product.unit || 'unit';

  return (
    <div
      id={`cart-item-${item.product.id}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      className={`relative p-3 sm:p-3.5 transition select-none cursor-pointer flex flex-col justify-between ${
        isHolding
          ? 'bg-purple-50/70 ring-1 ring-purple-300'
          : 'hover:bg-slate-50/80 bg-white'
      }`}
      style={{ touchAction: 'pan-y' }}
      title="Tap to +1 • Hold 500ms to -1 • Hold 2s to remove"
    >
      {/* Floating Gesture Toast Badge */}
      {gestureToast && (
        <div
          className={`absolute top-2 right-12 z-20 px-2.5 py-0.5 rounded-full text-[10px] font-black shadow-md flex items-center gap-1 animate-bounce transition-all ${
            gestureToast === 'Added'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          <span>{gestureToast === 'Added' ? '+1 Added' : '-1 Removed'}</span>
        </div>
      )}

      {/* Top Line: Item Name & Edit Pencil */}
      <div className="flex items-start justify-between space-x-2">
        <div className="flex-1 min-w-0 pr-2">
          <h4 className="text-xs sm:text-sm font-black text-slate-900 leading-snug break-words">
            {item.product.name}
          </h4>
          {isFractional && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 inline-flex items-center gap-0.5">
                <Scale className="w-2.5 h-2.5" />
                <span>Fractional ({unitLabel})</span>
              </span>
            </div>
          )}
        </div>

        {/* Edit Button with stopPropagation so edit modal opens instead of quantity gesture */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit(item);
          }}
          title="Edit item price, discount or custom quantity"
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Line: Multiplier (with Scale Animation) & Line Total */}
      <div className="flex items-end justify-between mt-1 pt-1">
        <div>
          <div className="flex items-center space-x-1.5 font-mono-num text-xs sm:text-sm">
            {/* Animated Quantity Scale display */}
            <span
              className={`font-black inline-block transition-transform duration-200 ease-out origin-center ${
                scaleAnim === 'up'
                  ? 'scale-125 text-emerald-600 font-extrabold'
                  : scaleAnim === 'down'
                  ? 'scale-75 text-rose-600 font-extrabold'
                  : 'scale-100 text-[#2E7D32]'
              }`}
            >
              {typeof item.quantity === 'number'
                ? item.quantity % 1 === 0
                  ? item.quantity
                  : item.quantity.toFixed(3).replace(/\.?0+$/, '')
                : String(item.quantity)}{' '}
              {isFractional ? unitLabel : ''} x
            </span>

            <span className="font-bold text-slate-900">
              ${unitPrice % 1 === 0 ? unitPrice : unitPrice.toFixed(2)}
              {isFractional ? `/${unitLabel}` : ''}
            </span>
          </div>

          {/* Stock Status */}
          {isOOS ? (
            <div className="text-[9px] font-black text-rose-600 uppercase tracking-tight mt-0.5">
              OUT OF STOCK
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 font-medium mt-0.5">
              In stock: {item.product.stockQuantity} {isFractional ? unitLabel : ''}
            </div>
          )}
        </div>

        {/* Line Total */}
        <div className="text-right">
          <span className="font-mono-num text-sm sm:text-base font-black text-slate-900">
            ${lineTotal % 1 === 0 ? lineTotal : lineTotal.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};
