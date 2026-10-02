import { flushSync } from 'react-dom';

export const MOTION = { feedback: 160, enter: 260, exit: 160, indicator: 300, distance: 8, easing: 'cubic-bezier(.22, 1, .36, 1)' };
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Transition = { ready: Promise<void>; finished: Promise<void>; skipTransition(): void };
type MotionDocument = Document & { startViewTransition?: (update: () => void) => Transition };
let active: { finish: () => void } | undefined;

/** Snapshot only the changing region; the canvas and surrounding controls stay live. */
export function transitionUI(elements: () => (HTMLElement | null)[], direction: number, update: () => void, afterUpdate?: () => void) {
  // A skipped browser transition still invokes its callback. Commit it exactly once
  // before capturing the next state, so rapid or overlapping navigation cannot replay.
  active?.finish();
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    flushSync(update);
    afterUpdate?.();
  };
  const targets = elements().filter((element): element is HTMLElement => !!element && element.getClientRects().length > 0);
  const doc = document as MotionDocument;
  if (reducedMotion() || !targets.length) { commit(); return; }

  if (!doc.startViewTransition) {
    commit();
    const animations = elements().map((element) => element?.animate?.([
      { opacity: .55, transform: `translateX(${Math.sign(direction) * MOTION.distance}px)` },
      { opacity: 1, transform: 'translateX(0)' }
    ], { duration: MOTION.enter, easing: MOTION.easing }));
    const pending = { finish: () => { animations.forEach((animation) => animation?.cancel()); if (active === pending) active = undefined; } };
    active = pending;
    void Promise.all(animations.map((animation) => animation?.finished.catch(() => {}))).then(() => { if (active === pending) active = undefined; });
    return;
  }

  const previousNames = targets.map((element) => element.style.getPropertyValue('view-transition-name'));
  targets.forEach((element, index) => element.style.setProperty('view-transition-name', `ui-content-${index}`));
  document.documentElement.style.setProperty('--motion-offset', `${Math.sign(direction) * MOTION.distance}px`);
  const restore = () => targets.forEach((element, index) => {
    if (previousNames[index]) element.style.setProperty('view-transition-name', previousNames[index]);
    else element.style.removeProperty('view-transition-name');
  });
  try {
    const transition = doc.startViewTransition(commit);
    const pending = { finish: () => { transition.skipTransition(); commit(); restore(); if (active === pending) active = undefined; } };
    active = pending;
    void transition.ready.catch(() => { /* Hidden tabs and interrupted snapshots may skip animation. */ });
    void transition.finished.catch(() => {}).then(() => {
      if (active === pending) { restore(); active = undefined; }
    });
  } catch {
    restore();
    commit();
  }
}
