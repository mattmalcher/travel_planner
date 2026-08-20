/**
 * Share links (issue #81): the whole itinerary carried in a URL fragment, so
 * sending someone a trip needs no host, no account and no server-side state.
 *
 *   …/holiday_itinerary_viewer.html#d1=<base64url>
 *
 * In the *fragment*, never the query: fragments are not sent to the server, so
 * a link full of booking references never lands in a GitHub Pages access log.
 *
 * The marker is versioned rather than bare (`d1=`, not `d=`) so a future
 * encoding can be introduced without breaking links already sent — a reader
 * that doesn't know a scheme says so instead of decoding it into nonsense.
 * That is not hypothetical any more: `s1` (issue #116) arrived exactly that
 * way and is what the Share button produces now, while every `d1`/`u1` link
 * already sent keeps opening.
 *
 * Three schemes exist today, distinguished by their letter rather than by
 * their number: `s1` names a stored encrypted blob (see below), `d1` carries
 * the whole document deflate-raw, `u1` the uncompressed fallback for a browser
 * with no CompressionStream (Safari before 16.4), which costs link length and
 * nothing else.
 *
 * Pure: encoding, decoding and where the payload sits in a URL. Everything
 * about the clipboard, navigator.share and the boot decision is src/share.js.
 */
import {
  CAN_COMPRESS, deflateToBase64url, inflateFromBase64url, toBase64url, fromBase64url,
} from './codec.js';

/** deflate-raw + base64url — the whole document, in the link. */
export const SCHEME_DEFLATE = 'd1';
/** base64url of the raw JSON, for a platform without CompressionStream. */
export const SCHEME_PLAIN = 'u1';
/**
 * A *hosted* share (issue #116): `s1=<id>.<key>`, where the id names a blob of
 * ciphertext in the share store and the key opens it. Preferred now, because a
 * link that carries the document grows with the document, and past a few
 * thousand characters WhatsApp on Android quietly declines to linkify it — the
 * recipient taps nothing, or gets a truncated link, and neither says why. A
 * hosted link is the same ~120 characters for a weekend and for a month.
 *
 * Both halves stay in the fragment, so neither the id nor the key reaches a
 * server log — and the store, which only ever sees the id, holds ciphertext it
 * cannot read.
 */
export const SCHEME_HOSTED = 's1';
/**
 * A **room** (issue #124): the same stored blob, made replaceable, so the link
 * stays current instead of freezing the trip as it was the day it was sent.
 *
 * Two grades, because a mutable slot has to answer "who may write to it":
 *
 *   `w1=<K>`         writer — the master key itself, from which the id, the
 *                    content key and the write token all derive (lib/room-keys.js).
 *                    ~60 characters, and the shortest link the app produces.
 *   `v1=<id>.<key>`  viewer — the id and the content key only, laid out exactly
 *                    like `s1` because it is the same two halves. A viewer
 *                    cannot derive the write token: the derivation only runs
 *                    forwards, so read access genuinely does not imply write.
 *
 * The link *is* the permission — there is no per-person identity, and
 * forwarding a writer link hands over writing.
 */
export const SCHEME_ROOM_WRITER = 'w1';
export const SCHEME_ROOM_VIEWER = 'v1';

const SCHEMES = [SCHEME_HOSTED, SCHEME_ROOM_WRITER, SCHEME_ROOM_VIEWER, SCHEME_DEFLATE, SCHEME_PLAIN];

/**
 * The length at which a link is worth warning about before it goes out. Well
 * clear of a realistic trip (a two-week itinerary encodes to ~5–15 kB) but
 * inside what a messaging app will carry intact — the failure being guarded
 * against is a link silently truncated in transit, which looks to the person
 * receiving it like a corrupt file rather than a link that was too long.
 */
export const SHARE_WARN_CHARS = 24000;

/**
 * The two things that can be wrong with a link, as the words the user sees.
 *
 * Exported because every stage of opening one can fail this way — parsing the
 * fragment here, decrypting the blob in share-crypto.js, parsing the plaintext
 * in share.js — and they must all say the *same* thing, since to the person
 * holding the link they are the same event. They were six string literals
 * across three modules, which is how a wording change gets applied to five of
 * them.
 *
 * DAMAGED is UI copy and reaches the upload warning: junk in, a clear error
 * out, because decoding must not turn a truncated link into an empty trip.
 */
export const DAMAGED = 'The link is damaged or incomplete';
export const NOT_A_SHARE = 'That link does not carry an itinerary';

/**
 * What goes in the link: the document as it stands, stamped with the schema
 * version this build writes — the same stamp downloadDoc puts in a file, so
 * an incoming link meets the same version guard as an uploaded one. Identity
 * (`trip_id`, `rev`) rides along untouched: it is what lets the link land on
 * the trip it came from instead of forking a second copy of it.
 */
export function shareDocument(doc, schemaVersion) {
  const out = { schema_version: schemaVersion, ...doc };
  out.schema_version = schemaVersion; // win over any version the document carried
  return out;
}

/** Encode a document as a fragment payload, `scheme=data`. */
export async function encodeShare(doc) {
  const text = JSON.stringify(doc);
  if (CAN_COMPRESS) {
    try { return `${SCHEME_DEFLATE}=${await deflateToBase64url(text)}`; }
    catch (e) { /* fall through to the uncompressed form rather than fail */ }
  }
  return `${SCHEME_PLAIN}=${toBase64url(text)}`;
}

/**
 * The share payload in a URL fragment, or null when there isn't one. Tolerant
 * of a fragment that is doing something else as well: a bare `#anchor`, or
 * `&`-joined parts, leave the rest alone.
 */
export function readShareFragment(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const scheme = part.slice(0, eq);
    if (SCHEMES.includes(scheme)) return { scheme, data: part.slice(eq + 1) };
  }
  return null;
}

/** Whether a fragment carries a share link at all. */
export function hasShareLink(hash) {
  return readShareFragment(hash) !== null;
}

/** Every reader below takes either a raw fragment string or what
    readShareFragment already returned, so callers need not care which they
    hold. One place to widen if a third input shape ever shows up. */
const asFragment = f => (typeof f === 'string' ? readShareFragment(f) : f);

/**
 * The decoded JSON of a share payload, guarded. Shared by the fragment schemes
 * (which decode the text out of the link) and the hosted one (which decrypts
 * it out of a stored blob) — different ways to *get* the text, identical rules
 * about what counts as an itinerary once you have it.
 */
export function parseShareDocument(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(DAMAGED, { cause: e }); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(NOT_A_SHARE);
  return doc;
}

/**
 * The document a fragment carries. Takes either a raw fragment string or what
 * readShareFragment returned. Throws for anything that isn't a document — the
 * caller shows the message, so a mangled link says so rather than opening a
 * blank trip.
 */
export async function decodeShare(fragment) {
  const f = asFragment(fragment);
  if (!f) throw new Error(NOT_A_SHARE);
  // A hosted link carries no document to decode — it names one. Fetching and
  // decrypting it needs the network, which is share.js's half of the job; this
  // guard is here so a caller that forgets gets a plain error rather than the
  // id parsed as if it were a payload.
  if (f.scheme === SCHEME_HOSTED || isRoom(f))
    throw new Error('That link points at a stored itinerary and must be fetched');
  if (!/^[A-Za-z0-9_-]+$/.test(f.data)) throw new Error(DAMAGED);
  let text;
  try {
    text = f.scheme === SCHEME_DEFLATE ? await inflateFromBase64url(f.data) : fromBase64url(f.data);
  } catch (e) { throw new Error(DAMAGED, { cause: e }); }
  return parseShareDocument(text);
}

/** `href` with any fragment removed. The query survives — a deployment may
    need it — and only the fragment is ours to replace. */
export function linkBase(href) {
  const s = String(href || '');
  const cut = s.indexOf('#');
  return cut === -1 ? s : s.slice(0, cut);
}

/** The share link for `doc`: this page's own URL, with the document in the
    fragment. */
export async function shareUrl(href, doc) {
  return `${linkBase(href)}#${await encodeShare(doc)}`;
}

/** Long enough to risk being truncated on the way to whoever it is for. */
export function isOverlong(url) {
  return String(url).length > SHARE_WARN_CHARS;
}

/* --- hosted links (issue #116) ------------------------------------------- */

/** Whether a fragment names a stored itinerary rather than carrying one. */
export function isHosted(fragment) {
  const f = asFragment(fragment);
  return !!f && f.scheme === SCHEME_HOSTED;
}

/** The fragment payload for a stored blob: `s1=<id>.<key>`. */
export function hostedFragment(id, key) {
  return `${SCHEME_HOSTED}=${id}.${key}`;
}

/** The share link for a stored blob — this page's URL, id and key in the
    fragment so neither reaches the server that serves the page. */
export function hostedUrl(href, id, key) {
  return `${linkBase(href)}#${hostedFragment(id, key)}`;
}

/**
 * Split a hosted payload back into its id and key. Strict about the shape: a
 * link cut short by a messaging app must say so here rather than send a
 * half-id to the store and report it as expired.
 */
export function parseHosted(fragment) {
  const f = asFragment(fragment);
  if (!f || f.scheme !== SCHEME_HOSTED) throw new Error(NOT_A_SHARE);
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(f.data || '');
  if (!m) throw new Error(DAMAGED);
  return { id: m[1], key: m[2] };
}

/* --- rooms (issue #124) -------------------------------------------------- */

/** Whether a fragment names a room — a stored blob that can be replaced —
    rather than a frozen `s1` snapshot or a document carried whole. */
export function isRoom(fragment) {
  const f = asFragment(fragment);
  return !!f && (f.scheme === SCHEME_ROOM_WRITER || f.scheme === SCHEME_ROOM_VIEWER);
}

/** The link that lets the recipient edit: the master key, and nothing else. */
export function writerUrl(href, masterKey) {
  return `${linkBase(href)}#${SCHEME_ROOM_WRITER}=${masterKey}`;
}

/** The link that only reads. Carries the derived id and content key rather
    than the master key, which is the whole point — a viewer must not be able
    to re-derive the write token. */
export function viewerUrl(href, id, key) {
  return `${linkBase(href)}#${SCHEME_ROOM_VIEWER}=${id}.${key}`;
}

/**
 * Split a room fragment into what it carries. Strict about the shape for the
 * same reason parseHosted is: a link cut short by a messaging app must say so
 * here rather than send half an id to the store and have it reported expired.
 *
 * @returns {{writer: true, masterKey: string}|{writer: false, id: string, key: string}}
 */
export function parseRoom(fragment) {
  const f = asFragment(fragment);
  if (!f || !isRoom(f)) throw new Error(NOT_A_SHARE);
  if (f.scheme === SCHEME_ROOM_WRITER) {
    if (!/^[A-Za-z0-9_-]+$/.test(f.data || '')) throw new Error(DAMAGED);
    return { writer: true, masterKey: f.data };
  }
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(f.data || '');
  if (!m) throw new Error(DAMAGED);
  return { writer: false, id: m[1], key: m[2] };
}
