import { useLayoutEffect, useRef } from 'react';
import { MOTION, reducedMotion } from './motion';

/** One persistent highlight, measured from the real controls at every breakpoint. */
export function SlidingIndicator({ activeKey, selector, underline = false }: { activeKey: string | number; selector: string; underline?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation>();
  const placed = useRef(false);
  const position = useRef<(animate: boolean) => void>(() => {});

  position.current = (animate) => {
    const indicator = ref.current, parent = indicator?.parentElement;
    const target = parent?.querySelector<HTMLElement>(selector);
    if (!indicator || !parent) return;
    if (!target || !target.getClientRects().length) {
      indicator.style.opacity = '0'; placed.current = false; animation.current?.cancel(); return;
    }
    const from = placed.current ? indicator.getBoundingClientRect() : null;
    const rect = target.getBoundingClientRect(), container = parent.getBoundingClientRect();
    animation.current?.cancel();
    Object.assign(indicator.style, {
      left: `${rect.left - container.left - parent.clientLeft + parent.scrollLeft}px`,
      top: `${rect.top - container.top - parent.clientTop + parent.scrollTop + (underline ? rect.height - 2 : 0)}px`,
      width: `${rect.width}px`, height: `${underline ? 2 : rect.height}px`, opacity: '1'
    });
    if (animate && from && !reducedMotion() && indicator.animate) {
      const to = indicator.getBoundingClientRect();
      animation.current = indicator.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scaleX(${from.width / to.width})` },
        { transform: 'translate(0, 0) scaleX(1)' }
      ], { duration: MOTION.indicator, easing: MOTION.easing });
    }
    placed.current = true;
  };

  useLayoutEffect(() => { position.current(true); }, [activeKey, selector, underline]);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => position.current(animation.current?.playState === 'running'));
    observer.observe(parent);
    parent.querySelectorAll('a, button').forEach((element) => observer.observe(element));
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => position.current(false);
    preference.addEventListener('change', settle);
    return () => { observer.disconnect(); preference.removeEventListener('change', settle); animation.current?.cancel(); };
  }, []);
  return <span ref={ref} className={`sliding-indicator${underline ? ' is-underline' : ''}`} aria-hidden="true" />;
}
