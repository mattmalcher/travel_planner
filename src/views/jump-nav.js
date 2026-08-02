// Sticky "jump to" strips. The Itinerary view's day chips (issue #21) and the
// Lists view's list chips (issue #69) are one widget over different anchors,
// so the scrolling and the scroll-spy that marks the current chip live here.
//
// The contract a view opts into: render a `.hjump-nav` holding `.hjump-chip`
// buttons, and give each anchor the `.hjump-a` class. Both carry a `data-k`
// key, which rides in a data attribute rather than an inline JS string so an
// itinerary-supplied key can't break out of the onclick (issue #9). The strip
// is a `<nav>` with its own aria-label ("Jump to day"/"Jump to list"/…), so a
// screen reader can skip it and knows which strip it landed in (issue #92).

import { esc } from '../lib/escape.js';

const anchors = viewId => [...document.querySelectorAll(`#${viewId} .hjump-a`)];

/**
 * One chip. `key` rides in `data-k` and is read back off the dataset by the
 * handler, never interpolated into the onclick string — an itinerary-supplied
 * key would otherwise break straight out of it (issue #9).
 * `label` is HTML: a caller passing document text escapes it first.
 */
export function jumpChip(key, handler, label, { icon, cls } = {}) {
  return `<button class="hjump-chip${cls ? ' ' + cls : ''}" data-k="${esc(key)}" onclick="${handler}(this.dataset.k)">${
    icon ? `<i class="ti ${icon}" aria-hidden="true"></i> ` : ''}${label}</button>`;
}

/**
 * The strip itself. Each view decides *whether* it has enough anchors to be
 * worth showing one — the Itinerary counts days, not chips, because its Today
 * shortcut is an extra chip over the same one day.
 */
export function jumpStrip(ariaLabel, chips) {
  return `<nav class="hjump-nav" aria-label="${ariaLabel}">${chips.join('')}</nav>`;
}

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
  // The `on` class is colour alone, which is invisible to assistive tech (and
  // to anyone who cannot tell the two greys apart) — aria-current carries the
  // same fact, and is settled here so the two can never disagree (issue #92).
  nav.querySelectorAll('.hjump-chip').forEach(c => {
    const on = !!cur && c.dataset.k === cur.dataset.k;
    c.classList.toggle('on', on);
    if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
  });
}

/** One passive scroll listener per view, bound on its first render. */
const spied = new Set();
export function bindJumpSpy(viewId) {
  if (spied.has(viewId)) return;
  spied.add(viewId);
  addEventListener('scroll', () => updateActiveChip(viewId), { passive: true });
}
