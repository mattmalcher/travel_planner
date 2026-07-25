/**
 * Compressing codec for stored documents (issue #80): `deflate-raw` through
 * the platform's CompressionStream, base64url-encoded so the result is safe in
 * JSON, in a URL fragment and in localStorage.
 *
 * The trip library's revision history is the first caller — a realistic
 * two-week itinerary is ~40 kB of JSON but ~6 kB encoded, which is the
 * difference between 50 revisions fitting in the localStorage budget and not.
 * Share links (issue #81) will encode the same way, which is why this is its
 * own module rather than a private helper of the history writer.
 *
 * Entries are self-describing: `enc` says how `data` was encoded, so a browser
 * without CompressionStream (Safari before 16.4) stores plain JSON instead of
 * failing, and anything already written stays readable either way.
 *
 * Async, because CompressionStream is. Callers that must stay synchronous —
 * persist() writing the working copy — do not go through here.
 */

const HAS_STREAMS = typeof CompressionStream === 'function'
  && typeof DecompressionStream === 'function'
  && typeof Response === 'function';

/** True when this environment can actually compress. */
export const CAN_COMPRESS = HAS_STREAMS;

function bytesToBase64url(bytes) {
  let s = '';
  // Chunked: String.fromCharCode.apply blows the argument limit on a big array.
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(text) {
  const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function through(transform, bytes) {
  const stream = new Response(bytes).body.pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compress `text` to a base64url string. */
export async function deflateToBase64url(text) {
  const bytes = await through(new CompressionStream('deflate-raw'), new TextEncoder().encode(text));
  return bytesToBase64url(bytes);
}

/** Inverse of deflateToBase64url. */
export async function inflateFromBase64url(text) {
  const bytes = await through(new DecompressionStream('deflate-raw'), base64urlToBytes(text));
  return new TextDecoder().decode(bytes);
}

/**
 * Encode a value for storage: `{enc, data}`, compressed when the platform can
 * and plain JSON when it can't. Never throws for want of CompressionStream.
 */
export async function encodeValue(value) {
  const text = JSON.stringify(value);
  if (!CAN_COMPRESS) return { enc: 'plain', data: text };
  try { return { enc: 'deflate-raw', data: await deflateToBase64url(text) }; }
  catch (e) { return { enc: 'plain', data: text }; }
}

/** Decode what encodeValue wrote, whichever form it took. */
export async function decodeValue(entry) {
  if (!entry || typeof entry.data !== 'string') return null;
  const text = entry.enc === 'deflate-raw' ? await inflateFromBase64url(entry.data) : entry.data;
  return JSON.parse(text);
}
