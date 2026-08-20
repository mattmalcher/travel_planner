/**
 * Share links, the browser half (issue #81): turning the open trip into a link
 * and handing it over, and opening one that arrives in the fragment. The
 * encoding itself is pure and lives in lib/sharelink.js.
 *
 * A `d1`/`u1`/`s1` link is an immutable snapshot, and that is still a feature:
 * there is no sync and no conflict resolution, only two people with copies that
 * each know their own `trip_id` and `rev` (issue #80), which is enough for the
 * app to *tell* you when two copies have diverged. "Send a copy" in the share
 * sheet is exactly that, and stays the right thing for most sharing.
 *
 * A **room** link (`w1`/`v1`, issue #124) is the other option: the same stored
 * blob made replaceable, so the link stays current and — with an edit link —
 * two people work on one plan. Everything about a room lives in room.js; this
 * file keeps what it always had, the fragment and the boot decision.
 *
 * Worth being plain about, since the UI copy has to be: anyone holding the
 * link holds the whole itinerary, booking references included. It is a
 * shared secret, not a private page.
 *
 * Two link shapes now (issue #116). A hosted `s1` link is the default — the
 * document is encrypted here, the ciphertext goes to the Worker in `worker/`,
 * and only an id and the key travel, in the fragment. A `d1`/`u1` link carries
 * the document itself and is the fallback whenever the store cannot be
 * reached. That fallback is not a legacy path: it is the only thing that works
 * offline, on `file://` and in a build with no store configured, so both
 * directions stay first-class here.
 */
import { state, H_SCHEMA_VERSION } from './state.js';
import { loadUpload, loadSaved, showUploadWarning } from './app.js';
import { revisionDoc } from './store.js';
import { renderRecent } from './views/library.js';
import { esc } from './lib/escape.js';
import {
  readShareFragment, hasShareLink, decodeShare, shareUrl, shareDocument, isOverlong,
  isHosted, isRoom, parseHosted, hostedUrl, parseShareDocument,
} from './lib/sharelink.js';
import { encryptShare, decryptShare } from './lib/share-crypto.js';
import { hasShareStore, putShare, getShare, SHARE_TTL_DAYS } from './share-store.js';
// Rooms (issue #124) are the other half of this file's job now: share.js still
// owns the fragment and the boot decision, room.js owns what a *mutable* share
// does once one arrives. The import runs both ways — room.js reaches back for
// the toast and the snapshot path — which is safe because every crossing is a
// hoisted function declaration, called long after both modules have evaluated.
import { roomDocument, renderRoom } from './room.js';

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
 *
 * Two link shapes, tried in that order (issue #116). A **hosted** link is
 * ~120 characters whatever the trip weighs, which is what gets it linkified by
 * WhatsApp on Android; a **fragment** link carries the document itself and is
 * what every build did before, still perfectly good for a small trip and the
 * only option with no network. The fallback is deliberately silent: a share
 * store that is down, blocked, offline or out of daily quota is not the
 * sharer's problem to read about, and they still get a link that works.
 */
export async function shareDoc(doc) {
  const payload = shareDocument(doc, H_SCHEMA_VERSION);
  const name = (doc.trip && doc.trip.name) || 'Itinerary';

  let url = await hostedLink(payload);
  const hosted = !!url;
  if (!url) {
    try { url = await shareUrl(location.href, payload); }
    catch (e) { alert('Could not build a share link: ' + e.message); return; }
  }
  // Only a fragment link can be too long, and only when the store was
  // unreachable — so before warning about a link that will arrive broken, try
  // sending the itinerary as a file instead. That is a share that cannot be
  // truncated, and it is the same JSON the app uploads.
  if (!hosted && isOverlong(url)) {
    if (await shareFile(payload, name)) return;
    if (!confirm(
      `This link is about ${Math.round(url.length / 1024)} kB long, which some messaging apps `
      + 'truncate — the person opening it would get a broken link rather than the trip. '
      + 'Send it anyway?')) return;
  }
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
  await copyLink(url, hosted);
}

/**
 * The short link: encrypt here, upload only the ciphertext, and keep the key
 * in the fragment. Returns null — never throws — when there is no store, no
 * network, no WebCrypto or no quota left, which is the caller's cue to fall
 * back to a link that carries the document.
 */
async function hostedLink(payload) {
  if (!hasShareStore()) return null;
  try {
    const { bytes, key } = await encryptShare(JSON.stringify(payload));
    const id = await putShare(bytes);
    return hostedUrl(location.href, id, key);
  } catch (e) {
    return null;
  }
}

/**
 * Hand over the itinerary as a file, for when no link would survive the trip.
 * Resolves true when the share sheet took it *or* the user cancelled — both
 * are outcomes — and false when this platform can't share a file at all.
 */
async function shareFile(payload, name) {
  if (!navigator.canShare || typeof File !== 'function') return false;
  const file = new File([JSON.stringify(payload, null, 2)],
    `${name.replace(/[^\w-]+/g, '_').toLowerCase() || 'itinerary'}.json`,
    { type: 'application/json' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ title: name, files: [file] });
    return true;
  } catch (e) {
    return !!(e && e.name === 'AbortError');
  }
}

/**
 * Put the link where it can be used and say what it means. `note` overrides the
 * wording for a room (issue #124), where the sentence is a different one: a
 * live link keeps up with the trip, and an edit link hands over editing.
 */
export async function copyLink(url, hosted, note) {
  // The warning is the same for both shapes — the link is the secret either
  // way — but a hosted one also stops working, and that has to be said when it
  // goes out rather than discovered by whoever opens it in five weeks.
  const message = note
    || 'Link copied. Anyone with it can open the whole itinerary — booking references included.'
    + (hosted ? ` The link works for ${SHARE_TTL_DAYS} days.` : '');
  try {
    await navigator.clipboard.writeText(url);
    shareToast(message);
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
  return documentFrom(fragment).then(doc => {
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
    renderRoom(); // a room link leaves this trip with a status pill
    return true;
  }).catch(e => {
    clearFragment();
    // An expired share is not a broken link and must not be reported as one:
    // nothing is wrong with what was sent, it is simply past its 30 days, and
    // the only useful thing to say is "ask for a fresh one".
    if (e && e.expired) {
      showUploadWarning('clock-off', 'That share link has expired',
        `Shared links are kept for ${SHARE_TTL_DAYS} days, and this one is past that — the itinerary it pointed at has been deleted. `
        + 'Ask whoever sent it to share the trip again.',
        ['<button onclick="hUploadCancel()" class="htool">Dismiss</button>']);
      return false;
    }
    showUploadWarning('alert-triangle', 'That share link could not be opened',
      `${esc(e.message || String(e))}. Ask whoever sent it for the link again — some apps shorten a long link, which breaks it.`,
      ['<button onclick="hUploadCancel()" class="htool">Dismiss</button>']);
    return false;
  });
}

/**
 * The document a fragment names, whichever scheme it uses: decoded from the
 * link itself for `d1`/`u1`, or fetched and decrypted for a hosted `s1`.
 * Throws with `expired` set when the store no longer has it, which is the one
 * failure worth its own message.
 */
function documentFrom(fragment) {
  // A room link (issue #124) also names a stored blob, but joining it writes a
  // record as well as reading bytes, so room.js owns that half.
  if (isRoom(fragment)) return roomDocument(fragment);
  if (!isHosted(fragment)) return decodeShare(fragment);
  const { id, key } = parseHosted(fragment);
  return getShare(id)
    .then(bytes => decryptShare(bytes, key))
    // Same guard the fragment schemes apply once they have their text: how the
    // bytes arrived is the only thing that differs between the two paths.
    .then(parseShareDocument);
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
