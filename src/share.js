/**
 * Sharing a trip, the browser half (issues #81, #114): turning the open trip
 * into something you can send, and opening one that arrives. The encodings
 * themselves are pure — lib/sharelink.js for the link, lib/sharefile.js for
 * the file and the paste parser.
 *
 * What goes out is an immutable snapshot, and that is the feature: there is no
 * sync and no conflict resolution, only two people with copies that each know
 * their own `trip_id` and `rev` (issue #80). That is enough for the app to
 * *tell* you when two copies have diverged, which for two people is the right
 * amount of machinery.
 *
 * Worth being plain about, since the UI copy has to be: anyone holding the
 * file or the link holds the whole itinerary, booking references included. It
 * is a shared secret, not a private page.
 *
 * The ladder, in the order it is tried (issue #114). Every rung ends with the
 * trip somewhere the user can send it — there is no dead end and no dead UI:
 *
 *   1. `navigator.share({files})` — the OS share sheet with the JSON attached.
 *      An attachment has no length limit, which a link does.
 *   2. Download the file, and attach it by hand.
 *   3. Copy the compressed payload as text, to paste into any channel.
 *   4. Copy the old long link, kept working for anything already sent.
 *
 * Rungs 2–4 are offered together in the toast when rung 1 is unavailable, so a
 * desktop browser that cannot share files still reaches all of them in one tap.
 */
import { state, H_SCHEMA_VERSION } from './state.js';
import { loadUpload, loadSaved, showUploadWarning, downloadDoc } from './app.js';
import { revisionDoc } from './store.js';
import { renderRecent } from './views/library.js';
import { esc } from './lib/escape.js';
import { msToIso } from './lib/dates.js';
import {
  readShareFragment, hasShareLink, decodeShare, shareUrl, shareDocument, isOverlong,
} from './lib/sharelink.js';
import {
  SHARE_MIME, shareFilename, shareFileText, sharePayload, readShareText,
} from './lib/sharefile.js';

/* --- producing ----------------------------------------------------------- */

/** Share the open trip — the document as it stands, including edits made
    since it was last downloaded, which is the point of sharing at all. */
export function shareTrip() {
  return state.HD ? shareDoc(state.HD) : Promise.resolve();
}

/** Share one revision out of a trip's history, next to its Download. */
export async function shareRevision(tripId, rev) {
  const doc = await revisionDoc(tripId, rev);
  if (!doc) { alert('That revision is no longer stored.'); return; }
  await shareDoc(doc, 'rev' + rev);
}

const tripName = doc => (doc && doc.trip && doc.trip.name) || 'Itinerary';

/**
 * The trip as a `File`, built synchronously on purpose: `navigator.share` must
 * be called while the click that asked for it is still the current user
 * gesture, and an `await` in between is exactly what spends that. JSON.stringify
 * is synchronous, so nothing here has to be waited on — which is also why the
 * file is plain JSON rather than the compressed payload, whose CompressionStream
 * is async and would put a promise between the tap and the share sheet.
 */
function shareFile(doc, suffix) {
  const text = shareFileText(doc, H_SCHEMA_VERSION);
  const name = shareFilename(doc, msToIso(Date.now()).date, suffix);
  return new File([text], name, { type: SHARE_MIME });
}

/**
 * Hand the trip over. Rung 1 of the ladder: the share sheet with the file
 * attached, which is what a phone does with it. Anything else falls to the
 * toast, which carries the rest.
 *
 * `canShare` is asked with the real `files` array rather than being inferred
 * from `navigator.share` existing: sharing a URL and sharing a file are
 * separate capabilities, and a browser with the first and not the second would
 * otherwise throw where it looks supported.
 */
function shareDoc(doc, suffix) {
  let file;
  try { file = shareFile(doc, suffix); }
  catch (e) { alert('Could not build a share file: ' + e.message); return Promise.resolve(); }

  if (canShareFile(file)) {
    const name = tripName(doc);
    return navigator.share({ files: [file], title: name, text: `${name} — itinerary` })
      .then(() => undefined)
      .catch(e => {
        // A cancelled share sheet is a decision, not a failure. Anything else
        // (a target that refused the attachment) drops to the fallbacks.
        if (e && e.name === 'AbortError') return;
        shareFallback(doc, file, suffix);
      });
  }
  shareFallback(doc, file, suffix);
  return Promise.resolve();
}

/** Whether this browser will take *this file* — not merely whether it has a
    share sheet. Wrapped because a browser without `canShare` is a browser
    without file sharing, and one implementation or another has been known to
    throw here rather than answer false. */
function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); }
  catch (e) { return false; }
}

/** Rungs 2–4, offered together: the file, the pasteable payload, and the old
    link. Parked on `state.pendingShare` so the toast's buttons — which are
    inline handlers in generated markup — have the document without it having
    to be escaped into an attribute. */
function shareFallback(doc, file, suffix) {
  state.pendingShare = { doc, suffix };
  shareToast(
    `This browser can't attach files to a share, so ${file.name} is yours to send: `
    + 'download it and attach it, or copy the trip as text. Whichever you send carries the '
    + 'whole itinerary — booking references included.',
    [
      '<button onclick="hShareDownload()" class="htool"><i class="ti ti-file-download" aria-hidden="true"></i> Download file</button>',
      '<button onclick="hShareCopyText()" class="htool"><i class="ti ti-clipboard-copy" aria-hidden="true"></i> Copy as text</button>',
      '<button onclick="hShareCopyLink()" class="htool"><i class="ti ti-link" aria-hidden="true"></i> Copy link</button>',
    ],
  );
}

/** Rung 2: save it locally and attach it by hand. */
export function shareDownload() {
  const pending = state.pendingShare;
  if (pending) downloadDoc(pending.doc, pending.suffix);
}

/** Rung 3: the compressed payload as text, for a channel that mangles links —
    email, Slack, and the messenger that started all this. */
export async function shareCopyText() {
  const pending = state.pendingShare;
  if (!pending) return;
  const payload = await sharePayload(pending.doc, H_SCHEMA_VERSION);
  await copyOut(payload, 'Trip copied as text. Paste it into any message; whoever gets it '
    + 'pastes it back into this app. It carries the whole itinerary — booking references included.');
}

/** Rung 4: the pre-#114 long link. Kept because links already sent must keep
    working, and because for a small trip it is still the nicest thing to
    receive — just no longer what Share does by default. */
export async function shareCopyLink() {
  const pending = state.pendingShare;
  if (!pending) return;
  let url;
  try { url = await shareUrl(location.href, shareDocument(pending.doc, H_SCHEMA_VERSION)); }
  catch (e) { alert('Could not build a share link: ' + e.message); return; }
  if (isOverlong(url) && !confirm(
    `This link is about ${Math.round(url.length / 1024)} kB long, which some messaging apps `
    + 'truncate — the person opening it would get a broken link rather than the trip. '
    + 'Copy it anyway?')) return;
  await copyOut(url, 'Link copied. Anyone with it can open the whole itinerary — booking references included.');
}

async function copyOut(text, note) {
  try {
    await navigator.clipboard.writeText(text);
    shareToast(note);
  } catch (e) {
    // No clipboard access (an insecure context, or a refused permission):
    // hand it over in a box that can be copied by hand rather than losing it.
    window.prompt('Copy this:', text);
  }
}

let toastTimer = null;

/**
 * A brief note about what just left the page, with the warning that goes with
 * it. Dismissed by tapping it. One that only reports something self-dismisses;
 * one carrying buttons does not, since a toast that takes the choice away
 * mid-reach is worse than one that sits there.
 */
export function shareToast(message, actions) {
  const el = document.getElementById('hshare-toast');
  if (!el) return;
  // The toast as a whole dismisses on click; the action row must not, or the
  // buttons would put the choice away in the act of making it.
  const row = actions && actions.length
    ? `<div onclick="event.stopPropagation()" style="display:flex;gap:8px;margin-top:.5rem;flex-wrap:wrap">${actions.join('')}</div>`
    : '';
  el.innerHTML = `<i class="ti ti-share" aria-hidden="true"></i> <div><span>${esc(message)}</span>${row}</div>`;
  el.style.display = 'flex';
  clearTimeout(toastTimer);
  if (!row) toastTimer = setTimeout(() => { el.style.display = 'none'; }, 9000);
}

export function shareToastClose() {
  const el = document.getElementById('hshare-toast');
  if (el) el.style.display = 'none';
  clearTimeout(toastTimer);
}

/* --- consuming ----------------------------------------------------------- */

/**
 * A trip arriving as text (issue #114): a payload or a link pasted onto the
 * opening screen, or text dropped on the drop zone. One route for all of them,
 * and it ends where a file and a link already do — `loadUpload()`, so a pasted
 * document meets the same schema-version and ajv guards, and `loadImport()`
 * still decides how it lands against the library.
 *
 * Resolves to whether the text was a trip; a failure is reported in the one
 * warning banner rather than thrown at the caller, since every caller is a
 * DOM event with nowhere to put an error.
 */
export function importText(text) {
  return readShareText(text).then(doc => {
    loadUpload(doc);
    return true;
  }).catch(e => {
    showUploadWarning('clipboard-x', 'That could not be opened as a trip',
      `${esc(e.message || String(e))}. Paste the whole thing — the file's JSON, a share link, `
      + 'or the block of text the Share button copies.',
      ['<button onclick="hUploadCancel()" class="htool">Dismiss</button>']);
    return false;
  });
}

/**
 * The "Paste a shared trip" button on the opening screen. Reads the clipboard
 * where the browser allows it and asks for the text otherwise — Firefox has no
 * `readText` for a page at all, and Safari gates it behind a paste prompt, so
 * the box is a real path rather than a courtesy.
 */
export async function pasteTrip() {
  let text = null;
  try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); }
  catch (e) { text = null; }
  if (!text) text = window.prompt('Paste the share link or the copied trip text:');
  if (text) await importText(text);
}

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
    showUploadWarning('alert-triangle', 'That share link could not be opened',
      `${esc(e.message || String(e))}. Ask whoever sent it for the link again — some apps shorten a long link, which breaks it.`,
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
