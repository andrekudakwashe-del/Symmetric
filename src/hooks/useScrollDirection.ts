import { useState, useEffect, useRef } from 'react';

interface UseScrollDirectionOptions {
  threshold?: number;
  initialVisible?: boolean;
}

/**
 * useScrollDirection
 * Detects whether the user is scrolling up or down.
 * - When scrolling down: isVisible becomes false (hides search/controls)
 * - When scrolling up or at top: isVisible becomes true (reveals search/controls)
 */
export function useScrollDirection(options: UseScrollDirectionOptions = {}) {
  const { threshold = 10, initialVisible = true } = options;
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down' | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(initialVisible);
  const [scrollY, setScrollY] = useState<number>(0);
  const lastScrollY = useRef<number>(0);
  const ticking = useRef<boolean>(false);

  useEffect(() => {
    lastScrollY.current = window.scrollY || 0;

    const updateScrollDir = () => {
      const currentScrollY = window.scrollY || 0;
      setScrollY(currentScrollY);

      // Always visible near top of page
      if (currentScrollY <= 40) {
        setIsVisible(true);
        setScrollDirection(null);
        lastScrollY.current = currentScrollY;
        ticking.current = false;
        return;
      }

      const diff = currentScrollY - lastScrollY.current;

      if (Math.abs(diff) >= threshold) {
        if (diff > 0) {
          // Scrolling down -> hide
          setScrollDirection('down');
          setIsVisible(false);
        } else {
          // Scrolling up -> reveal
          setScrollDirection('up');
          setIsVisible(true);
        }
        lastScrollY.current = currentScrollY;
      }

      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDir);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  const forceReveal = () => {
    setIsVisible(true);
  };

  return {
    scrollDirection,
    isVisible,
    scrollY,
    isAtTop: scrollY <= 40,
    forceReveal,
  };
}
