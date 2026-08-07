/**
 * The share store (issue #116): a Cloudflare Worker over one KV namespace that
 * holds blobs of ciphertext for 30 days and hands them back by id.
 *
 * It is deliberately the dumbest thing that can work, because it is the piece
 * that is *not* under the user's control. It never sees a decryption key —
 * that lives in the URL fragment, which is not sent in an HTTP request — so
 * what it stores is bytes it cannot read, and a breach of it discloses
 * nothing. Everything below is abuse control (origin, size, method), not
 * access control: a static page cannot hold a secret, so there is no client to
 * authenticate and no point pretending otherwise.
 *
 *   POST /      body = raw ciphertext        → { id }
 *   GET  /:id   → the bytes, or 404
 *   OPTIONS     → CORS preflight
 *
 * The handler is exported separately from the default export so unit tests can
 * drive it with a Map-backed KV stub (tests/unit/share-worker.test.js).
 */

/** 30 days, per write — the TTL the app's UI copy promises. */
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
    long (the 256-bit key is). */
const ID_BYTES = 8;

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
 * The binding counts per-colo rather than globally, so a distributed caller
 * gets this allowance per location. That is fine for what this defends
 * against — one page in a loop — and anything cleverer than that was never
 * going to be stopped by a number in a config file.
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

function newId() {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders(origin) {
  return {
    // The exact origin, never `*`: a wildcard would let any page on the
    // internet spend this account's daily write quota.
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const ok = !!origin && allowed.includes(origin);
  // A browser request always carries an Origin cross-origin, so one we do not
  // know is a page we did not ship and is refused outright. A request with no
  // Origin is not a browser (curl, a bot) — it may read a blob it already
  // knows the id of, which is ciphertext, but it may not write.
  if (origin && !ok) return json({ error: 'origin not allowed' }, 403);
  const cors = ok ? corsHeaders(origin) : { Vary: 'Origin' };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const { pathname } = new URL(request.url);

  if (request.method === 'POST') {
    if (pathname !== '/') return json({ error: 'not found' }, 404, cors);
    if (!ok) return json({ error: 'origin not allowed' }, 403, cors);
    // Before the body is read and before the put, so a throttled caller costs
    // neither bandwidth nor KV quota.
    if (!await withinRateLimit(request, env))
      return json({ error: 'rate limited' }, 429, { 'Retry-After': '60', ...cors });
    // Checked twice: the declared length rejects an oversized upload before
    // it is read, and the actual byte count catches a chunked body that
    // declared nothing.
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
    if (body.byteLength === 0) return json({ error: 'empty body' }, 400, cors);
    const id = newId();
    await env.KV.put(id, body, { expirationTtl: TTL_SECONDS });
    return json({ id, ttl: TTL_SECONDS }, 201, cors);
  }

  if (request.method === 'GET') {
    const id = pathname.slice(1);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'not found' }, 404, cors);
    const value = await env.KV.get(id, 'arrayBuffer');
    if (!value) return json({ error: 'not found' }, 404, cors);
    return new Response(value, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        // Immutable for its lifetime — the blob at an id never changes, and a
        // cached copy also spares KV a read.
        'Cache-Control': 'public, max-age=3600',
        ...cors,
      },
    });
  }

  return json({ error: 'method not allowed' }, 405, { Allow: 'GET, POST, OPTIONS', ...cors });
}

export default { fetch: handle };
