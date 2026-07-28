// Keeping a keyboard user in place across a re-render, and telling a screen
// reader what just happened (issue #93).
//
// The Lists, Phrases and Itinerary views redraw themselves wholesale with
// `box.innerHTML = …` on every mutation, so the control you just operated is
// destroyed and rebuilt: focus falls back to <body> and the next Tab restarts
// from the top of the document. That is a 3.2.2 (On Input) failure, and it is
// what makes "tick things off as you go" impractical without sight.
//
// The fix stays with the redraw rather than replacing it — mutating the one
// affected row in place is the better end state, but a much larger change, and
// these views are cheap to redraw. What is needed is a stable identity that
// survives innerHTML: every control that is worth returning to carries
// `data-focus="<role>:<key>"`, this module reads it off the active element
// before the write and re-focuses the match after. If the helper starts
// accreting special cases, that is the signal to go and mutate in place.
//
// This cannot live in src/lib/ — it touches the DOM, and lib/ stays pure.
//
// The live region (4.1.3, Status Messages) is the other half. It is a single
// `#hlive` in the static markup on purpose: a region created and written in the
// same frame does not announce reliably, so it must be in the DOM long before
// anything writes to it.

/** The `data-focus` key of whatever currently has focus, or null. Reads the
    nearest marked ancestor, so a control can carry the attribute on a wrapper
    if the focusable element itself is generated. */
export function focusKey() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const marked = el.closest('[data-focus]');
  return marked ? marked.dataset.focus : null;
}

/** Focus the control carrying `key`, trying each fallback in turn. Returns the
    key that took focus, or null if none of them is on the page. */
export function focusTo(...keys) {
  for (const key of keys) {
    if (!key) continue;
    const el = document.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (el) { el.focus(); return key; }
  }
  return null;
}

/** Run a re-render with the focused control put back afterwards. The identity
    is the `data-focus` key, not a position: the Lists view re-sorts open items
    above done ones on every toggle, so the checkbox you pressed generally moves.
    `to` names where focus should land instead when the mutation deliberately
    moves it (a delete, whose row is gone, hands over to the Undo button). */
export function keepFocus(render, ...to) {
  const key = focusKey();
  render();
  if (key || to.length) focusTo(...to, key);
}

// Two identical strings in a row are a no-op to most screen readers — the
// region's text has not changed, so there is nothing to announce. Ticking two
// items off in a row produces exactly that, so a repeat gets an invisible
// suffix to make the text new. Callers and tests should match on the message,
// not compare the region's text for equality.
let last = '';

/** Say something in the shared polite live region. Never interrupts: everything
    announced here (a tick, a delete, an add) accompanies an action the user just
    took and can wait for a gap. */
export function announce(msg) {
  const region = document.getElementById('hlive');
  if (!region) return; // saved page fragments / tests that render a view alone
  const text = msg === last ? msg + ' ' : msg;
  last = text;
  region.textContent = text;
}
