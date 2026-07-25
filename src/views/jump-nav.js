// Sticky "jump to" strips. The Itinerary view's day chips (issue #21) and the
// Lists view's list chips (issue #69) are one widget over different anchors,
// so the scrolling and the scroll-spy that marks the current chip live here.
//
// The contract a view opts into: render a `.hjump-nav` holding `.hjump-chip`
// buttons, and give each anchor the `.hjump-a` class. Both carry a `data-k`
// key, which rides in a data attribute rather than an inline JS string so an
// itinerary-supplied key can't break out of the onclick (issue #9).

const anchors = viewId => [...document.querySelectorAll(`#${viewId} .hjump-a`)];

/** Scroll the anchor keyed `key` in `viewId` to the top of the view. */
export function jumpTo(viewId, key, behavior = 'smooth') {
  const el = anchors(viewId).find(a => a.dataset.k === key);
  if (el) el.scrollIntoView({ behavior, block: 'start' });
}

/** Mark the chip for whichever anchor currently sits under the sticky strip.
    A hidden view has nothing measurable, so it is left alone until it is
    switched to (see switchView). */
export function updateActiveChip(viewId) {
  const view = document.getElementById(viewId);
  if (!view || !view.classList.contains('on')) return;
  const nav = view.querySelector('.hjump-nav');
  if (!nav) return;
  let cur = null;
  for (const a of anchors(viewId)) if (!cur || a.getBoundingClientRect().top <= 64) cur = a;
  nav.querySelectorAll('.hjump-chip').forEach(c => c.classList.toggle('on', !!cur && c.dataset.k === cur.dataset.k));
}

/** One passive scroll listener per view, bound on its first render. */
const spied = new Set();
export function bindJumpSpy(viewId) {
  if (spied.has(viewId)) return;
  spied.add(viewId);
  addEventListener('scroll', () => updateActiveChip(viewId), { passive: true });
}
