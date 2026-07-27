/**
 * Share links, the browser half (issue #81): turning the open trip into a link
 * and handing it over, and opening one that arrives in the fragment. The
 * encoding itself is pure and lives in lib/sharelink.js.
 *
 * A link is an immutable snapshot, and that is the feature: there is no sync
 * and no conflict resolution, only two people with copies that each know their
 * own `trip_id` and `rev` (issue #80). That is enough for the app to *tell*
 * you when two copies have diverged, which for two people is the right amount
 * of machinery.
 *
 * Worth being plain about, since the UI copy has to be: anyone holding the
 * link holds the whole itinerary, booking references included. It is a
 * shared secret, not a private page.
 */
import { state, H_SCHEMA_VERSION } from './state.js';
import { loadUpload, loadSaved, showUploadWarning } from './app.js';
import { revisionDoc } from './store.js';
import { renderRecent } from './views/library.js';
import { esc } from './lib/escape.js';
import {
  readShareFragment, hasShareLink, decodeShare, shareUrl, shareDocument, isOverlong,
} from './lib/sharelink.js';

/* --- producing ----------------------------------------------------------- */

/** Share the open trip — the document as it stands, including edits made
    since it was last downloaded, which is the point of sharing a link. */
export function shareTrip() {
  return state.HD ? shareDoc(state.HD) : Promise.resolve();
}

/** Share one revision out of a trip's history, next to its Download. */
export async function shareRevision(tripId, rev) {
  const doc = await revisionDoc(tripId, rev);
  if (!doc) { alert('That revision is no longer stored.'); return; }
  await shareDoc(doc);
}

/**
 * Build the link and hand it over: the system share sheet where there is one
 * (a phone, which is where a trip actually gets sent), the clipboard
 * otherwise.
 */
async function shareDoc(doc) {
  let url;
  try { url = await shareUrl(location.href, shareDocument(doc, H_SCHEMA_VERSION)); }
  catch (e) { alert('Could not build a share link: ' + e.message); return; }
  if (isOverlong(url) && !confirm(
    `This link is about ${Math.round(url.length / 1024)} kB long, which some messaging apps `
    + 'truncate — the person opening it would get a broken link rather than the trip. '
    + 'Send it anyway?')) return;
  const name = (doc.trip && doc.trip.name) || 'Itinerary';
  if (navigator.share) {
    try {
      await navigator.share({ title: name, text: `${name} — itinerary`, url });
      return;
    } catch (e) {
      // A cancelled share sheet is a decision, not a failure. Anything else
      // (a platform that won't take a URL this long) falls back to the copy.
      if (e && e.name === 'AbortError') return;
    }
  }
  await copyLink(url);
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    shareToast('Link copied. Anyone with it can open the whole itinerary — booking references included.');
  } catch (e) {
    // No clipboard access (an insecure context, or a refused permission):
    // hand the link over in a box that can be copied by hand rather than
    // losing it.
    window.prompt('Copy this share link:', url);
  }
}

let toastTimer = null;

/** A brief note that the link is on its way out, with the warning that goes
    with it. Dismissed by tapping it, and self-dismissing either way. */
export function shareToast(message) {
  const el = document.getElementById('hshare-toast');
  if (!el) return;
  el.innerHTML = `<i class="ti ti-link" aria-hidden="true"></i> <span>${esc(message)}</span>`;
  el.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 9000);
}

export function shareToastClose() {
  const el = document.getElementById('hshare-toast');
  if (el) el.style.display = 'none';
  clearTimeout(toastTimer);
}

/* --- consuming ----------------------------------------------------------- */

/**
 * Boot: a share link in the fragment takes precedence over the trip that was
 * open, and goes through loadUpload() rather than load() — a link is untrusted
 * input from a possibly older deployment exactly as a file is, and deserves
 * the same schema-version and ajv guards. From there loadImport() decides how
 * it lands against the library (issue #80): a new trip, a no-op re-open, or a
 * replace/keep-both decision.
 *
 * Resolves to whether a link was handled, which is only of interest to tests.
 */
export function boot() {
  watchFragment();
  const fragment = readShareFragment(location.hash);
  if (!fragment) { loadSaved(); return Promise.resolve(false); }
  // The opening screen is where a link that fails to open leaves you, so its
  // list of saved trips wants to be there — the saved trip is deliberately not
  // auto-loaded over the top, since that would hide the warning with it.
  renderRecent();
  return decodeShare(fragment).then(doc => {
    // Clear the fragment before loading: a refresh must not re-import a stale
    // snapshot over edits made since. The document is in hand by now, so
    // nothing is lost by dropping it from the URL.
    clearFragment();
    // No waiting on a validator any more: ajv and the schema are compiled into
    // the bundle and main.js sets the validators up before calling boot(), so
    // loadUpload's schema guard is always in place by the time a link gets
    // here — which is the point, since a link is the least trusted way a
    // document arrives.
    loadUpload(doc);
    return true;
  }).catch(e => {
    clearFragment();
    showUploadWarning(`<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-alert-triangle" aria-hidden="true"></i> That share link could not be opened</div>
      ${esc(e.message || String(e))}. Ask whoever sent it for the link again — some apps shorten a long link, which breaks it.`,
    ['<button onclick="hUploadCancel()" class="htool">Dismiss</button>']);
    return false;
  });
}

/**
 * A link can also arrive at a page that is already open — following one while
 * the app is on screen changes the fragment and nothing else, which no browser
 * treats as a new page load, so without this the link would appear to do
 * nothing at all.
 *
 * Reloading is the honest response rather than importing in place: every
 * document is already saved (persist() is the single write path), boot() above
 * is then the one route a link takes in, and the import decision it may raise
 * belongs on the opening screen where it can actually be seen. Clearing the
 * fragment can't loop back through here — replaceState fires no hashchange,
 * and the fallback leaves no link behind to react to.
 */
function watchFragment() {
  window.addEventListener('hashchange', () => {
    if (hasShareLink(location.hash)) location.reload();
  });
}

/** Drop our payload from the address bar, keeping path and query. */
function clearFragment() {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { location.hash = ''; } // file:// in some browsers refuses replaceState
}
