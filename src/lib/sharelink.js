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
 * Two schemes exist today, distinguished by their letter rather than by their
 * number: `d1` is deflate-raw, `u1` the uncompressed fallback for a browser
 * with no CompressionStream (Safari before 16.4), which costs link length and
 * nothing else.
 *
 * Pure: encoding, decoding and where the payload sits in a URL. Everything
 * about the clipboard, navigator.share and the boot decision is src/share.js.
 */
import {
  CAN_COMPRESS, deflateToBase64url, inflateFromBase64url, toBase64url, fromBase64url,
} from './codec.js';

/** deflate-raw + base64url — what every current browser produces. */
export const SCHEME_DEFLATE = 'd1';
/** base64url of the raw JSON, for a platform without CompressionStream. */
export const SCHEME_PLAIN = 'u1';

const SCHEMES = [SCHEME_DEFLATE, SCHEME_PLAIN];

/**
 * The length at which a link is worth warning about before it goes out. Well
 * clear of a realistic trip (a two-week itinerary encodes to ~5–15 kB) but
 * inside what a messaging app will carry intact — the failure being guarded
 * against is a link silently truncated in transit, which looks to the person
 * receiving it like a corrupt file rather than a link that was too long.
 */
export const SHARE_WARN_CHARS = 24000;

/** Junk in, a clear error out — decoding must not turn a truncated link into
    an empty trip. The message is UI copy: it reaches the upload warning. */
const DAMAGED = 'The link is damaged or incomplete';

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

/**
 * The document a fragment carries. Takes either a raw fragment string or what
 * readShareFragment returned. Throws for anything that isn't a document — the
 * caller shows the message, so a mangled link says so rather than opening a
 * blank trip.
 */
export async function decodeShare(fragment) {
  const f = typeof fragment === 'string' ? readShareFragment(fragment) : fragment;
  if (!f) throw new Error('That link does not carry an itinerary');
  if (!/^[A-Za-z0-9_-]+$/.test(f.data)) throw new Error(DAMAGED);
  let text;
  try {
    text = f.scheme === SCHEME_DEFLATE ? await inflateFromBase64url(f.data) : fromBase64url(f.data);
  } catch (e) { throw new Error(DAMAGED, { cause: e }); }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(DAMAGED, { cause: e }); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    throw new Error('That link does not carry an itinerary');
  return doc;
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
