/** Escape &, < and > for interpolation into HTML (issue #9: use this for any
    value that originates from the itinerary file or an AI response). */
export function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
