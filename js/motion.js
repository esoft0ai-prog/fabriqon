// 3D motion helpers: page-enter transition and touch tilt on tappable cards.
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TILT_TARGETS = '.card-link, .stat, .option-card, .job, a.list-item';
const MAX_DEG = 7;

/** Lets the next page's content rise in from depth. Call before rendering. */
export function playViewTransition(el) {
  if (!el || reduced()) return;
  clearTimeout(el._viewTimer);
  el.classList.remove('view-3d');
  void el.offsetWidth; // restart animations
  el.classList.add('view-3d');
  // Stop animating after the entry so later in-page refreshes don't replay it.
  el._viewTimer = setTimeout(() => el.classList.remove('view-3d'), 1400);
}

/** Cards lean toward the finger while pressed (touch and pen only). */
export function initTouchTilt(root = document) {
  let active = null;
  const release = () => {
    if (!active) return;
    active.classList.remove('pressing');
    active.style.setProperty('--rx', '0deg');
    active.style.setProperty('--ry', '0deg');
    active.style.setProperty('--ts', '1');
    active = null;
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || reduced()) return;
    const el = e.target.closest(TILT_TARGETS);
    if (!el) return;
    release();
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
    const y = (e.clientY - r.top) / r.height - 0.5;
    // Big items (rows, wide cards) tilt less so they don't look warped.
    const k = Math.min(1, 260 / Math.max(r.width, 1));
    el.classList.add('tilt', 'pressing');
    el.style.setProperty('--rx', `${(-y * MAX_DEG * 2).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(x * MAX_DEG * 2 * k).toFixed(2)}deg`);
    el.style.setProperty('--ts', '0.97');
    active = el;
  }, { passive: true });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'scroll', 'dragstart']) {
    root.addEventListener(type, release, { passive: true, capture: type === 'scroll' });
  }
}
