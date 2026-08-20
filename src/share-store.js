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

/* --- rooms: the same store, addressed by a derived id (issue #124) -------- */

/** The write token's header. Never a path or query segment — the Worker's own
    request logs would hold it. */
export const TOKEN_HEADER = 'X-Share-Token';

/**
 * A conflict the store noticed at push time: someone else replaced the room
 * since the version this push claimed to be replacing. `current` is what is
 * actually there, so the app can resolve without a second round trip.
 *
 * Best-effort by construction (KV cannot do a real compare-and-set), which is
 * why this is a nicety rather than the guarantee — see the Worker's header
 * comment and `previous` below.
 */
export class RoomConflict extends Error {
  constructor(current) {
    super('Someone else has changed this trip');
    this.name = 'RoomConflict';
    this.conflict = true;
    this.current = current;
  }
}

/** The room is there but this device may not write to it — a viewer link, or
    an id that was POSTed as a frozen snapshot rather than claimed as a room. */
export class RoomForbidden extends Error {
  constructor() {
    super('That shared trip does not accept changes from here');
    this.name = 'RoomForbidden';
    this.forbidden = true;
  }
}

/**
 * Replace the blob at `id`, creating it if the slot is empty.
 *
 * @param {string} id      derived from the master key, never minted here
 * @param {Uint8Array} bytes ciphertext
 * @param {string} token   the derived write token
 * @param {string|null} etag the version this push believes it is replacing
 * @returns {Promise<{previous: Uint8Array|null}>} the bytes that were there
 *   before — **swap semantics**. The caller checks they were the base it
 *   thought it was pushing over; if they were not, it just learned it clobbered
 *   a push it had not seen, and can raise the same resolve flow seconds later
 *   rather than at the other person's next pull. That is KV's read-then-write
 *   used for *detection* instead of pretended to be atomic.
 *
 * Throws RoomConflict when the store refused on `If-Match`, RoomForbidden for
 * a token that does not match, and a plain Error for everything else.
 */
export async function putRoom(id, bytes, token, etag) {
  if (!hasShareStore()) throw new Error('No share store configured');
  const headers = { 'Content-Type': 'application/octet-stream', [TOKEN_HEADER]: token };
  if (etag) headers['If-Match'] = etag;
  const res = await fetch(`${base()}/${encodeURIComponent(id)}`, {
    method: 'PUT', headers, body: bytes,
  });
  if (res.status === 409) throw new RoomConflict(new Uint8Array(await res.arrayBuffer()));
  if (res.status === 403 || res.status === 401) throw new RoomForbidden();
  if (!res.ok) throw new Error(`Share store refused the update (${res.status})`);
  // 201 means the slot was empty: a brand new room, or one whose TTL lapsed
  // and has just healed at the same id.
  if (res.status === 201) return { previous: null };
  const previous = new Uint8Array(await res.arrayBuffer());
  return { previous: previous.length ? previous : null };
}

/** Stop sharing. Idempotent at the Worker, because the second person in a room
    to tap it should not see a failure. */
export async function deleteRoom(id, token) {
  if (!hasShareStore()) throw new Error('No share store configured');
  const res = await fetch(`${base()}/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { [TOKEN_HEADER]: token },
  });
  if (res.status === 403 || res.status === 401) throw new RoomForbidden();
  if (!res.ok && res.status !== 404) throw new Error(`Share store refused the delete (${res.status})`);
}

/* Reading a room is `getShare` with the right `waits` for the moment: the
   default retry ladder when opening a link for the first time (a room created
   seconds ago can genuinely 404 on a stale edge read), and `[]` for a poll —
   a room that is not there is a normal state for one (nobody has pushed since
   it lapsed), and ~2s of sleeping per poll to discover that is waste. */
