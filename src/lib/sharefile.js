/**
 * Sharing a trip as a *file* rather than as a link (issue #114).
 *
 * A share link carries the whole itinerary in the URL fragment, which is fine
 * until the URL gets long: WhatsApp on Android stops linkifying past a length
 * it does not document, so the message arrives, the link looks tappable, and
 * either nothing happens or a truncated fragment loads a broken trip. That is
 * not fixable by shrinking the payload — there is no server, so the size grows
 * with the trip — and it is invisible in testing because the same message on
 * iOS works.
 *
 * So the default way a trip leaves the app is now an attachment: the same JSON
 * a Download produces, handed to the OS share sheet as a `File`. An attachment
 * has no length limit and every messenger already knows what to do with one.
 *
 * Three things live here, and all three are pure — the `File`, the clipboard
 * and `navigator.share` are src/share.js:
 *
 *   - what the file *is*: its bytes, its name, its MIME type;
 *   - `sharePayload`, the copy-and-paste fallback for a platform that cannot
 *     share files (the link's `d1=` payload, minus the URL around it);
 *   - `readShareText`, the one parser for "some text that might be a trip" —
 *     a pasted payload, a pasted link, a pasted or dropped file's JSON.
 *
 * Deliberately plain `.json` / `application/json` rather than a custom
 * extension: a messenger that has never heard of `.itin` may refuse to attach
 * it or mangle it, and the receiving half is the file picker the app already
 * had. A custom type buys a PWA file-handler registration later, which is a
 * follow-up in the issue, not a reason to risk the send today.
 */
import { shareDocument, readShareFragment, decodeShare, encodeShare } from './sharelink.js';

/** What the share sheet is handed, and what the file picker accepts. */
export const SHARE_MIME = 'application/json';
export const SHARE_EXT = '.json';

/** A trip's name reduced to a filename stem: `Paris weekend!` → `paris_weekend`.
    Shared by the share file and the Download button, so a trip is recognisable
    by the same name whichever way it left. */
export function docStem(doc) {
  const name = (doc && doc.trip && doc.trip.name) || 'itinerary';
  const stem = String(name).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').toLowerCase();
  return stem || 'itinerary';
}

/**
 * The file's name. `stamp` is an ISO day (`msToIso(Date.now())`) and is part of
 * the name on purpose: several shares of the same trip land in one chat thread,
 * and `paris_weekend.json (2)` tells the person receiving them nothing about
 * which is the later one. `suffix` names a revision, as Download's does.
 */
export function shareFilename(doc, stamp, suffix) {
  const parts = [docStem(doc)];
  if (suffix) parts.push(suffix);
  if (stamp) parts.push(String(stamp));
  return parts.join('_') + SHARE_EXT;
}

/**
 * The bytes: the document stamped with the schema version this build writes,
 * pretty-printed exactly as a Download is — the file that arrives in a chat and
 * the file that comes out of the Download button are the same file, so there is
 * one thing to debug when one of them will not open.
 */
export function shareFileText(doc, schemaVersion) {
  return JSON.stringify(shareDocument(doc, schemaVersion), null, 2);
}

/**
 * The paste-it-anywhere fallback: the link's payload (`d1=…`) without a URL
 * around it, so it survives an email, a Slack message or anything else that
 * mangles long links. Compressed, because this one is read by a human's
 * clipboard rather than by a file picker.
 */
export function sharePayload(doc, schemaVersion) {
  return encodeShare(shareDocument(doc, schemaVersion));
}

const NOT_A_TRIP = 'That does not look like an itinerary or a share link';

/**
 * Text → document, for every way text can arrive: a pasted `d1=` payload, a
 * pasted share link (whole URL and all), or raw itinerary JSON dropped or
 * pasted into the page. Async because decoding a payload is.
 *
 * Throws with a message meant for the user — the callers put it straight into
 * the warning banner, so an unreadable paste says what was wrong with it
 * rather than opening an empty trip.
 */
export async function readShareText(text) {
  const trimmed = String(text == null ? '' : text).trim();
  if (!trimmed) throw new Error(NOT_A_TRIP);

  // A link: everything after the last `#` is the fragment. Done before the
  // bare-payload check so a URL whose *path* happens to contain `d1=` cannot
  // be read as one.
  const hash = trimmed.lastIndexOf('#');
  const fragment = readShareFragment(hash === -1 ? trimmed : trimmed.slice(hash + 1));
  if (fragment) return decodeShare(fragment);

  if (trimmed[0] === '{') {
    let doc;
    try { doc = JSON.parse(trimmed); }
    catch (e) { throw new Error('That text is not valid JSON', { cause: e }); }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(NOT_A_TRIP);
    return doc;
  }

  throw new Error(NOT_A_TRIP);
}
