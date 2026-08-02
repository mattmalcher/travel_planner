// Turn the http(s) URLs inside a piece of free prose into clickable links
// (issue #109). Notes are where a reference ends up — a booking page, a
// timetable PDF, the operator's disruption page — and selecting a bare URL out
// of an 11px note to paste it into a browser is the annoying part.
//
// This is the escaping boundary for the text it is given: it escapes every
// non-URL run itself and gates each link through safeUrl(), so a caller swaps
// `esc(x)` for `linkify(x)` and gains nothing to get wrong. Only text that is
// rendered as prose should go through it — a value in an attribute, a <code>
// ref or anything that must stay literal keeps using esc().
import { esc, safeUrl } from './escape.js';

// Deliberately narrow: an explicit http(s):// scheme only, matching safeUrl's
// contract, and stopping at whitespace or a character that could only be
// markup. A bare "example.com" is not linked — guessing at a scheme would turn
// ordinary prose ("we changed at Lyon Part-Dieu, see p.4") into links.
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

// Punctuation that ends a sentence rather than the URL. Brackets are only
// dropped when they are unbalanced within the match: a Wikipedia URL really can
// end in ")", and "(see https://x/a_(b))" really does close the prose bracket.
const PLAIN_TRAILING = '.,;:!?«»„“”‘’\'"';
const PAIRS = { ')': '(', ']': '[', '}': '{' };

function trimTrailing(url) {
  let end = url.length;
  while (end > 0) {
    const c = url[end - 1];
    if (PLAIN_TRAILING.includes(c)) { end--; continue; }
    if (PAIRS[c]) {
      const body = url.slice(0, end);
      const opens = body.split(PAIRS[c]).length - 1;
      const closes = body.split(c).length - 1;
      if (closes > opens) { end--; continue; }
    }
    break;
  }
  return url.slice(0, end);
}

/** Escape `s` for HTML and render any http(s) URL in it as an anchor.
    Returns HTML — the result is already escaped, so never wrap it in esc(). */
export function linkify(s) {
  const text = String(s == null ? '' : s);
  let out = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = trimTrailing(m[0]);
    // A match trimmed down to a bare scheme ("https://." in prose) is not a
    // link — an href of "https://" would silently resolve to this page.
    const href = /^https?:\/\/[^\s/]/i.test(url) ? safeUrl(url) : '';
    // Advance past the trimmed match, not the raw one, so trailing punctuation
    // is emitted as prose rather than swallowed.
    URL_RE.lastIndex = m.index + url.length;
    if (!href) continue;
    out += esc(text.slice(last, m.index));
    // target=_blank keeps the itinerary open (this is a reference you glance at
    // mid-trip); rel=noopener is the usual precaution for an untrusted target.
    out += `<a class="hlink" href="${esc(href)}" target="_blank" rel="noopener">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + esc(text.slice(last));
}
