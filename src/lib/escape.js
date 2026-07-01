/** Escape &, <, >, " and ' for interpolation into HTML text or double/single
    quoted attributes (issue #9: use this for any value that originates from the
    itinerary file or an AI response). */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Validate a URL for use in an href/src: only absolute http(s) links pass.
    Returns the trimmed URL, or '' for anything else (javascript:, data:,
    relative, empty) so callers can drop the link entirely (issue #9). */
export function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}
