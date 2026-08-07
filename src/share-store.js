/**
 * The share store client (issue #116): the browser's half of the Cloudflare
 * Worker in `worker/`. Ciphertext goes up, ciphertext comes back; the key is
 * never in either direction, so there is nothing here that could leak it.
 *
 * The endpoint is a build-time constant (`SHARE_ENDPOINT`, see
 * scripts/build.mjs) and may be empty — a build with no store still works,
 * because every caller falls back to the fragment link that carries the whole
 * document. Sharing must never end in a dead end, so *everything* in here
 * throws rather than half-succeeds, and share.js treats any throw as "use the
 * long link instead".
 */
import { SHARE_ENDPOINT } from './share-config.js';

export { SHARE_ENDPOINT };

/** How long the Worker keeps a blob. Surfaced in the share toast, because a
    link that stops working after a month has to say so when it is sent. */
export const SHARE_TTL_DAYS = 30;

/** Whether this build has a store to talk to at all. */
export function hasShareStore() {
  return !!SHARE_ENDPOINT && typeof fetch === 'function';
}

const base = () => SHARE_ENDPOINT.replace(/\/+$/, '');

/**
 * Upload ciphertext, returning the id the Worker stored it under.
 * Throws for anything at all — no network, an origin the Worker refuses, a
 * blob over its size cap, or the free tier's daily write quota being spent.
 */
export async function putShare(bytes) {
  if (!hasShareStore()) throw new Error('No share store configured');
  const res = await fetch(base() + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Share store refused the upload (${res.status})`);
  const body = await res.json();
  if (!body || typeof body.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(body.id))
    throw new Error('Share store returned no id');
  return body.id;
}

/** Waits between read attempts. KV is eventually consistent: a recipient in
    another region opening the link seconds after it was sent can genuinely
    read a 404 for a blob that exists. Retrying over ~2s covers propagation
    without making a truly expired link feel broken-slow. */
const RETRY_MS = [400, 700, 1000];

/** A 404 that survived the retries: the share really is gone, which is a
    different thing to say than "something went wrong". */
export class ShareExpired extends Error {
  constructor() {
    super('That share link has expired');
    this.name = 'ShareExpired';
    this.expired = true;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch ciphertext by id, retrying past KV's read-after-write window.
 * @returns {Promise<Uint8Array>}
 */
export async function getShare(id, waits = RETRY_MS) {
  if (!hasShareStore()) throw new Error('No share store configured');
  const url = `${base()}/${encodeURIComponent(id)}`;
  let last = null;
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetch(url, { method: 'GET' });
    } catch (e) {
      last = e; // offline, DNS, a blocked request — retry, then give up
    }
    if (res && res.ok) return new Uint8Array(await res.arrayBuffer());
    if (res && res.status !== 404 && res.status < 500)
      throw new Error(`Share store refused the request (${res.status})`);
    if (res) last = res.status === 404 ? new ShareExpired() : new Error(`Share store error (${res.status})`);
    if (attempt >= waits.length) break;
    await sleep(waits[attempt]);
  }
  throw last || new Error('Could not reach the share store');
}
