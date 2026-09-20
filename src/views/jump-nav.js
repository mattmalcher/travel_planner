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
  updateJumpOverflow(nav);
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
  bindJumpDrag();
  if (spied.has(viewId)) return;
  spied.add(viewId);
  addEventListener('scroll', () => updateActiveChip(viewId), { passive: true });
}

/* ---- reaching the overflow with a mouse (issue #113) --------------------
   The strip scrolls in its own box with the scrollbar hidden, which a touch
   screen solves by itself: a finger flicks it. A mouse had nothing — no
   scrollbar, no wheel axis, and on a wide screen the chips simply stopped
   mid-chip at the column edge with no hint that more were there. So the
   pointer drags the strip, and the edges it can still scroll towards fade
   out, which is also what tells the reader the cut is deliberate. */

/** Mark which edges a strip can still scroll towards; the fades and the grab
    cursor are those classes in styles.css. Pure CSS cannot ask whether a flex
    row overflows, so it is settled here and re-settled after every render (see
    updateActiveChip) and on every scroll of the strip. */
export function updateJumpOverflow(nav) {
  if (!nav) return;
  const max = nav.scrollWidth - nav.clientWidth;
  nav.classList.toggle('hj-scrollable', max > 1);
  nav.classList.toggle('hj-can-l', nav.scrollLeft > 1);
  nav.classList.toggle('hj-can-r', nav.scrollLeft < max - 1);
}

// The drag in progress, and whether the last one actually moved — a drag that
// ends over a chip must not also jump to it.
let drag = null;
let dragged = false;

function onPointerDown(e) {
  dragged = false;
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const nav = e.target.closest?.('.hjump-nav');
  if (!nav || nav.scrollWidth - nav.clientWidth <= 1) return;
  drag = { nav, x: e.clientX, left: nav.scrollLeft, moved: false };
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 4) return;   // a click wobbles a pixel or two
  drag.moved = true;
  drag.nav.classList.add('hj-drag');
  drag.nav.scrollLeft = drag.left - dx;
  e.preventDefault();                            // no text selection mid-drag
}

function onPointerUp() {
  if (!drag) return;
  drag.nav.classList.remove('hj-drag');
  dragged = drag.moved;
  drag = null;
}

// Capture, so the chip's own onclick never runs for a click that was a drag.
function onClickCapture(e) {
  if (!dragged) return;
  dragged = false;
  if (e.target.closest?.('.hjump-nav')) { e.stopPropagation(); e.preventDefault(); }
}

// Scroll does not bubble, so the strips' own scrolling is caught on the way
// down; one listener covers every strip, including ones rendered later.
function onScrollCapture(e) {
  const nav = e.target;
  if (nav?.classList?.contains('hjump-nav')) updateJumpOverflow(nav);
}

let navBound = false;
function bindJumpDrag() {
  if (navBound) return;
  navBound = true;
  addEventListener('pointerdown', onPointerDown);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  addEventListener('pointercancel', onPointerUp);
  addEventListener('click', onClickCapture, true);
  addEventListener('scroll', onScrollCapture, true);
  addEventListener('resize', () => document.querySelectorAll('.hjump-nav').forEach(updateJumpOverflow));
}
