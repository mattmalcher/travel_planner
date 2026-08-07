// The share store worker (issue #116), driven directly with a Map-backed KV
// stub. It is the one piece of this feature that is not under the user's
// control, so its refusals are the interesting part: an origin we did not
// ship, a body big enough to be an abuse of the free tier, a method that is
// not one of the three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, MAX_BYTES, TTL_SECONDS, WRITES_PER_MINUTE } from '../../worker/src/index.js';

const ORIGIN = 'https://mattmalcher.github.io';

/** A KV namespace that remembers what it was told, including the TTL. */
function kvStub() {
  const store = new Map();
  return {
    store,
    async put(key, value, options) {
      store.set(key, { value: Uint8Array.from(value), options });
    },
    async get(key, type) {
      const entry = store.get(key);
      if (!entry) return null;
      assert.equal(type, 'arrayBuffer');
      return entry.value.buffer.slice(entry.value.byteOffset,
        entry.value.byteOffset + entry.value.byteLength);
    },
  };
}

const env = () => ({ KV: kvStub(), ALLOWED_ORIGINS: ORIGIN });

const post = (body, origin = ORIGIN) => new Request('https://share.test/', {
  method: 'POST',
  headers: origin ? { Origin: origin } : {},
  body,
});
const get = (id, origin = ORIGIN) => new Request(`https://share.test/${id}`, {
  method: 'GET', headers: origin ? { Origin: origin } : {},
});

const bytes = n => Uint8Array.from({ length: n }, (_, i) => i % 251);

test('a blob goes up and comes back byte for byte', async () => {
  const e = env();
  const payload = bytes(2048);
  const res = await handle(post(payload), e);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.match(id, /^[A-Za-z0-9_-]+$/);

  const back = await handle(get(id), e);
  assert.equal(back.status, 200);
  assert.equal(back.headers.get('Content-Type'), 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), payload);
});

test('every write carries the 30-day TTL, since nothing else expires it', async () => {
  const e = env();
  const { id } = await (await handle(post(bytes(16)), e)).json();
  assert.equal(TTL_SECONDS, 2592000);
  assert.equal(e.KV.store.get(id).options.expirationTtl, TTL_SECONDS);
});

test('ids are unpredictable, not sequential', async () => {
  const e = env();
  const ids = new Set();
  for (let i = 0; i < 20; i++) ids.add((await (await handle(post(bytes(8)), e)).json()).id);
  assert.equal(ids.size, 20);
  assert.ok([...ids].every(id => id.length >= 10), 'ids are too short to be unguessable');
});

test('an unknown or expired id is a 404, not an empty 200', async () => {
  const res = await handle(get('nosuchid00'), env());
  assert.equal(res.status, 404);
});

test('a path that could not be an id never reaches KV', async () => {
  const e = env();
  e.KV.get = async () => { throw new Error('KV should not have been read'); };
  for (const path of ['..%2Fetc', 'has spaces', '']) {
    assert.equal((await handle(get(path), e)).status, 404);
  }
});

test('another origin is refused outright, on read and on write', async () => {
  const e = env();
  const evil = 'https://evil.test';
  assert.equal((await handle(post(bytes(16), evil), e)).status, 403);
  assert.equal((await handle(get('whatever00', evil), e)).status, 403);
  assert.equal(e.KV.store.size, 0);
});

test('the allowed origin is echoed exactly, never as a wildcard', async () => {
  const res = await handle(post(bytes(16)), env());
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Vary'), 'Origin');
});

test('the allowlist is configurable per deploy', async () => {
  const e = { ...env(), ALLOWED_ORIGINS: 'http://localhost:8345, https://other.test' };
  assert.equal((await handle(post(bytes(16), 'http://localhost:8345'), e)).status, 201);
  assert.equal((await handle(post(bytes(16), ORIGIN), e)).status, 403);
});

test('a request with no Origin may read ciphertext but may not write', async () => {
  const e = env();
  const { id } = await (await handle(post(bytes(16)), e)).json();
  assert.equal((await handle(get(id, null), e)).status, 200);
  assert.equal((await handle(post(bytes(16), null), e)).status, 403);
});

test('the preflight answers with the methods the client actually uses', async () => {
  const res = await handle(new Request('https://share.test/', {
    method: 'OPTIONS', headers: { Origin: ORIGIN },
  }), env());
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET/);
});

test('an oversized body is refused, and costs no KV quota', async () => {
  const e = env();
  const res = await handle(post(bytes(MAX_BYTES + 1)), e);
  assert.equal(res.status, 413);
  assert.equal(e.KV.store.size, 0);
});

test('a declared oversize is refused before the body is even read', async () => {
  const e = env();
  const req = new Request('https://share.test/', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Length': String(MAX_BYTES + 1000) },
    body: bytes(32),
  });
  assert.equal((await handle(req, e)).status, 413);
  assert.equal(e.KV.store.size, 0);
});

test('an empty body is a mistake, not a share', async () => {
  const e = env();
  assert.equal((await handle(post(new Uint8Array(0)), e)).status, 400);
  assert.equal(e.KV.store.size, 0);
});

test('a POST to anything but the root is not a write', async () => {
  const e = env();
  const req = new Request('https://share.test/some-id', {
    method: 'POST', headers: { Origin: ORIGIN }, body: bytes(16),
  });
  assert.equal((await handle(req, e)).status, 404);
  assert.equal(e.KV.store.size, 0);
});

test('anything but GET/POST/OPTIONS is refused', async () => {
  for (const method of ['DELETE', 'PUT', 'PATCH']) {
    const res = await handle(new Request('https://share.test/abc', {
      method, headers: { Origin: ORIGIN },
    }), env());
    assert.equal(res.status, 405);
    assert.match(res.headers.get('Allow'), /GET/);
  }
});

/* --- rate limiting ------------------------------------------------------- */

/** The RATE_LIMITER binding, which is a `limit({key})` returning `{success}`.
    Records the keys it was asked about, since limiting the wrong key (one
    value for every caller) would throttle everyone as one. */
function limiterStub(allow) {
  const keys = [];
  return {
    keys,
    async limit({ key }) { keys.push(key); return { success: allow }; },
  };
}

const IP = { 'CF-Connecting-IP': '203.0.113.7' };

const postFrom = (headers, body = bytes(16)) => new Request('https://share.test/', {
  method: 'POST', headers: { Origin: ORIGIN, ...headers }, body,
});

test('a throttled write is refused before it reaches KV', async () => {
  const e = { ...env(), RATE_LIMITER: limiterStub(false) };
  const res = await handle(postFrom(IP), e);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  // The point of the check's placement: no quota was spent on it.
  assert.equal(e.KV.store.size, 0);
  assert.equal(e.RATE_LIMITER.keys[0], '203.0.113.7');
});

test('the limiter keys on the caller IP, not on one shared bucket', async () => {
  const e = { ...env(), RATE_LIMITER: limiterStub(true) };
  await handle(postFrom({ 'CF-Connecting-IP': '203.0.113.7' }), e);
  await handle(postFrom({ 'CF-Connecting-IP': '198.51.100.4' }), e);
  assert.deepEqual(e.RATE_LIMITER.keys, ['203.0.113.7', '198.51.100.4']);
});

test('reads are never rate limited — only writes spend the scarce quota', async () => {
  const e = { ...env(), RATE_LIMITER: limiterStub(true) };
  const { id } = await (await handle(postFrom(IP), e)).json();
  e.RATE_LIMITER.keys.length = 0;
  assert.equal((await handle(get(id), e)).status, 200);
  assert.deepEqual(e.RATE_LIMITER.keys, []);
});

test('a missing binding allows the write, so wrangler dev is not a dead store', async () => {
  const e = env();
  assert.equal(e.RATE_LIMITER, undefined);
  assert.equal((await handle(postFrom(IP), e)).status, 201);
});

test('a limiter that throws fails open rather than breaking sharing', async () => {
  const e = {
    ...env(),
    RATE_LIMITER: { async limit() { throw new Error('limiter unavailable'); } },
  };
  assert.equal((await handle(postFrom(IP), e)).status, 201);
});

test('the configured limit matches the one the code documents', async () => {
  const cfg = readFileSync(new URL('../../worker/wrangler.jsonc', import.meta.url), 'utf8');
  // Strip // comments so the jsonc parses; there are no block comments or
  // strings containing "//" in this file.
  const parsed = JSON.parse(cfg.replace(/^\s*\/\/.*$/gm, ''));
  const rl = parsed.ratelimits.find(r => r.name === 'RATE_LIMITER');
  assert.ok(rl, 'wrangler.jsonc must declare the RATE_LIMITER binding');
  assert.equal(rl.simple.limit, WRITES_PER_MINUTE);
  assert.equal(rl.simple.period, 60);
});
