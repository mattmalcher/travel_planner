/**
 * The share store (issue #116, made mutable by #124): a Cloudflare Worker over
 * one KV namespace that holds blobs of ciphertext for 30 days and hands them
 * back by id.
 *
 * It is deliberately the dumbest thing that can work, because it is the piece
 * that is *not* under the user's control. It never sees a decryption key —
 * that lives in the URL fragment, which is not sent in an HTTP request — so
 * what it stores is bytes it cannot read, and a breach of it discloses
 * nothing.
 *
 *   POST   /      body = raw ciphertext        → { id }   (immutable snapshot)
 *   GET    /:id   → the bytes, or 404
 *   PUT    /:id   body = raw ciphertext        → the *previous* bytes  (a room)
 *   DELETE /:id   → 204
 *   OPTIONS       → CORS preflight
 *
 * POST mints a random id and the blob at it never changes; PUT is addressed by
 * an id the *client* derived from a key only it holds, and may be repeated, so
 * a link can stay current (issue #124). The two live side by side because a
 * frozen snapshot is still the right thing to send most of the time.
 *
 * ## Who may write to a room
 *
 * Everything except abuse control is still not access control — a static page
 * cannot hold a secret, so there is no client to authenticate. What a room
 * adds is one bearer value: the client derives a write token from its master
 * key and sends it in `X-Share-Token`; this Worker stores only SHA-256 of it,
 * as KV metadata beside the blob, and compares hashes on every write. It
 * therefore cannot derive the key, cannot decrypt, and a breach of its storage
 * yields nothing that can write.
 *
 * The Worker *does* see the token in flight, so its operator could overwrite a
 * room — but without the content key anything they write fails AES-GCM
 * authentication and reads to a recipient as a damaged link. Vandalism, never
 * forgery, which is the same trust position as being able to delete a blob.
 *
 * PUT **creates as well as replaces**: the first write to an empty slot stores
 * its token hash and claims it. That is safe because the id is derived from a
 * ~256-bit key nobody else holds, and it is what makes expiry self-healing —
 * a lapsed room comes back at the same id on the next push, so every link
 * already sent starts working again and there is no dead-link flow to build.
 *
 * ## The compare-and-set is best-effort, on purpose
 *
 * KV has no atomic primitive: `If-Match` here is read-then-put over an
 * eventually consistent store, so two racing writes can both pass it and the
 * read itself can be ~60s stale. It is not the safety net and must not be
 * treated as one — it catches most conflicts at the friendly moment (the user
 * just tapped Update). The actual guarantee lives in the app: a push returns
 * the blob it replaced, so a clobbered write is noticed seconds later, and
 * anything that slips past both is caught by the revision chain as a fork at
 * the next pull. A missed 409 degrades a push-time conflict into a pull-time
 * fork; it never discards anyone's trip. The real fix is a Durable Object,
 * which is a different project.
 *
 * The handler is exported separately from the default export so unit tests can
 * drive it with a Map-backed KV stub (tests/unit/share-worker.test.js).
 */

/** 30 days, per write — the TTL the app's UI copy promises. Sliding for a
    room, because every push writes again and so starts the clock over. */
export const TTL_SECONDS = 2592000;

/** Comfortably past a realistic trip (a month of segments encrypts to tens of
    kB) and far short of anything worth storing here. Rejected before the put,
    so an oversized body costs no KV quota. */
export const MAX_BYTES = 1048576;

/** Where the app is served from. Overridable per-deploy with the
    ALLOWED_ORIGINS var in wrangler.jsonc (comma-separated) — a fork, or a
    local `wrangler dev` against `http://localhost:8345`. */
const DEFAULT_ORIGINS = ['https://mattmalcher.github.io'];

/** ~10 base64url characters, ~60 bits: unguessable at any rate this Worker
    will ever serve, and short enough that the id is not what makes the link
    long (the 256-bit key is). A room's id is the same width, derived rather
    than minted (src/lib/room-keys.js). */
const ID_BYTES = 8;

/** The write token, and the version a write claims to be replacing. Both are
    request headers rather than anything in the URL: a token in a path would
    land in this Worker's own request logs. */
export const TOKEN_HEADER = 'X-Share-Token';

/** Ids are the only thing this Worker ever parses out of a URL. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Writes per IP per minute, enforced by the RATE_LIMITER binding in
 * wrangler.jsonc. It lives here rather than as a WAF rate limiting rule
 * because those are scoped to a *zone*, and a `workers.dev` deploy has no
 * zone — there is no dashboard rule to create.
 *
 * The trade is that a blocked request still costs a Worker invocation, where
 * a WAF rule would have refused it in front of the Worker. That is the cheap
 * quota (100k/day) and it protects the binding one: the check happens before
 * the body is read and before the KV write, so the 1,000 writes/day that
 * actually constrain this thing stay spent on real shares.
 *
 * What the limit is actually worth, measured rather than assumed: the counter
 * is cached on the machine serving the request and propagates asynchronously,
 * so it is reliable *per connection* and permissive across them. Thirty POSTs
 * over one keep-alive connection give exactly ten 201s and twenty 429s; forty
 * over forty fresh connections all succeeded, each landing on a counter that
 * had not caught up. Cloudflare says as much — "permissive, eventually
 * consistent, and intentionally designed to not be used as an accurate
 * accounting system".
 *
 * So this stops the thing it is meant to stop, which is one page or script in
 * a loop on one connection, and does not stop someone who cycles connections
 * deliberately. The backstop for that is the daily write quota failing closed
 * into a `#d1=` link, not this number.
 */
export const WRITES_PER_MINUTE = 10;

/**
 * Whether this IP may write. Absent binding = allowed: `wrangler dev` and the
 * unit tests drive the handler with a plain KV stub and no limiter, and a
 * missing binding must not turn into a Worker that refuses everything.
 */
async function withinRateLimit(request, env) {
  if (!env || !env.RATE_LIMITER) return true;
  // CF-Connecting-IP is set by the edge and cannot be spoofed by the client;
  // it is absent only off-platform, where the limiter is absent too.
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  } catch (e) {
    // A limiter that errors must not take the share store down with it —
    // failing open here costs at most the daily write quota, which degrades
    // to a long link in the app rather than to a broken share.
    return true;
  }
}

function allowedOrigins(env) {
  const configured = (env && env.ALLOWED_ORIGINS) || '';
  const list = configured.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

function bytesToBase64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newId() {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

/** base64url SHA-256, over UTF-8 for a string and over the bytes themselves
    otherwise. The app computes both the token digest and the blob etag exactly
    this way (src/lib/room-keys.js `digest`) — they are wire format, so the two
    implementations have to agree character for character. */
async function digest(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** Constant-time-ish comparison of two base64url digests. They are hashes of
    hashes and both sides are fixed length, so this is belt and braces rather
    than load-bearing — but a token check is exactly the place not to hand out
    a timing signal for free. */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(origin) {
  return {
    // The exact origin, never `*`: a wildcard would let any page on the
    // internet spend this account's daily write quota.
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, If-Match, ${TOKEN_HEADER}`,
    // A room's push reads the blob it replaced out of the response body, and a
    // conflict reads the winning version out of a 409 — neither is a header,
    // so nothing needs exposing beyond the default-safe set.
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

/** The ciphertext of a request, or a Response saying why not. Checked twice:
    the declared length rejects an oversized upload before it is read, and the
    actual byte count catches a chunked body that declared nothing. */
async function readBody(request, cors) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return { error: json({ error: 'too large' }, 413, cors) };
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return { error: json({ error: 'too large' }, 413, cors) };
  if (body.byteLength === 0) return { error: json({ error: 'empty body' }, 400, cors) };
  return { body };
}

const octet = (bytes, status, headers) => new Response(bytes, {
  status,
  headers: {
    'Content-Type': 'application/octet-stream',
    // A room's bytes change under a stable id, so the browser HTTP cache is
    // the layer that would otherwise serve a stale room for an hour. (The
    // service worker never sees these: lib/sw-cache.js bypasses every origin
    // that is not the page's own or a listed CDN.)
    'Cache-Control': 'no-store',
    ...headers,
  },
});

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const ok = !!origin && allowed.includes(origin);
  // A browser request always carries an Origin cross-origin, so one we do not
  // know is a page we did not ship and is refused outright. A request with no
  // Origin is not a browser (curl, a bot) — it may read a blob it already
  // knows the id of, which is ciphertext, but it may not write or delete.
  if (origin && !ok) return json({ error: 'origin not allowed' }, 403);
  const cors = ok ? corsHeaders(origin) : { Vary: 'Origin' };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const { pathname } = new URL(request.url);
  const writing = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';

  // Above the method fork, so every write path is covered by one check and a
  // throttled caller costs neither bandwidth nor KV quota.
  if (writing) {
    if (!ok) return json({ error: 'origin not allowed' }, 403, cors);
    if (!await withinRateLimit(request, env))
      return json({ error: 'rate limited' }, 429, { 'Retry-After': '60', ...cors });
  }

  if (request.method === 'POST') {
    if (pathname !== '/') return json({ error: 'not found' }, 404, cors);
    const { body, error } = await readBody(request, cors);
    if (error) return error;
    const id = newId();
    await env.KV.put(id, body, { expirationTtl: TTL_SECONDS });
    return json({ id, ttl: TTL_SECONDS }, 201, cors);
  }

  const id = pathname.slice(1);

  if (request.method === 'PUT') {
    if (!ID_RE.test(id)) return json({ error: 'not found' }, 404, cors);
    const token = request.headers.get(TOKEN_HEADER);
    if (!token) return json({ error: 'no write token' }, 401, cors);
    const { body, error } = await readBody(request, cors);
    if (error) return error;
    const current = await getWithMeta(env, id);
    const th = await digest(token);
    if (current.value) {
      // A slot POSTed as an immutable snapshot carries no token hash, and so
      // can never be turned into a room by whoever guesses its id.
      if (!current.metadata || !sameDigest(current.metadata.th, th))
        return json({ error: 'not your room' }, 403, cors);
      const ifMatch = request.headers.get('If-Match');
      if (ifMatch && !sameDigest(ifMatch, await digest(current.value))) {
        // Best-effort (see the header comment): the loser gets the version
        // that is actually there, so the app can resolve without a second
        // round trip. Its own push is *not* stored.
        return octet(current.value, 409, cors);
      }
    }
    await env.KV.put(id, body, { expirationTtl: TTL_SECONDS, metadata: { th } });
    // Swap semantics: the caller gets back what it replaced, and can check
    // that it really was the version it thought it was pushing over. 201 with
    // an empty body when the slot was empty — a fresh room, or one whose TTL
    // lapsed and has just healed at the same id.
    return current.value
      ? octet(current.value, 200, cors)
      : new Response(null, { status: 201, headers: { 'Cache-Control': 'no-store', ...cors } });
  }

  if (request.method === 'DELETE') {
    if (!ID_RE.test(id)) return json({ error: 'not found' }, 404, cors);
    const token = request.headers.get(TOKEN_HEADER);
    if (!token) return json({ error: 'no write token' }, 401, cors);
    const current = await getWithMeta(env, id);
    // Already gone is the outcome the caller wanted; saying 404 would only
    // make "Stop sharing" fail for the second person to tap it.
    if (!current.value) return new Response(null, { status: 204, headers: cors });
    if (!current.metadata || !sameDigest(current.metadata.th, await digest(token)))
      return json({ error: 'not your room' }, 403, cors);
    await env.KV.delete(id);
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method === 'GET') {
    if (!ID_RE.test(id)) return json({ error: 'not found' }, 404, cors);
    const { value, metadata } = await getWithMeta(env, id);
    if (!value) return json({ error: 'not found' }, 404, cors);
    // A room can change under a stable id; a POSTed snapshot cannot, and a
    // cached copy of one also spares KV a read. The token hash is what tells
    // them apart, and it is the only thing this Worker knows about either.
    return metadata
      ? octet(value, 200, cors)
      : octet(value, 200, { 'Cache-Control': 'public, max-age=3600', ...cors });
  }

  return json({ error: 'method not allowed' }, 405,
    { Allow: 'GET, POST, PUT, DELETE, OPTIONS', ...cors });
}

/** KV's value-and-metadata read, tolerant of a namespace stub that only
    implements `get` (which is all the immutable path ever needed). */
async function getWithMeta(env, id) {
  if (typeof env.KV.getWithMetadata === 'function') {
    const r = await env.KV.getWithMetadata(id, 'arrayBuffer');
    return { value: r && r.value ? new Uint8Array(r.value) : null, metadata: r ? r.metadata : null };
  }
  const value = await env.KV.get(id, 'arrayBuffer');
  return { value: value ? new Uint8Array(value) : null, metadata: null };
}

export default { fetch: handle };
