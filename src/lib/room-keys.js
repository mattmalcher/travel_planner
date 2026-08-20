/**
 * The keys behind a *mutable* share — a room (issue #124).
 *
 * A hosted `s1` share (issue #116) is immutable: the store mints a random id
 * and the blob at it never changes. A room is the same blob made replaceable,
 * which raises the question the immutable one dodged — who may overwrite it?
 * There are no accounts and a static page cannot hold a secret, so the answer
 * has to come out of the link itself.
 *
 * Everything derives from one master key `K` that never leaves the page:
 *
 *   K (256 bits)
 *     id     = HKDF(K, "id")   → ~11 chars, all the worker ever learns
 *     encKey = HKDF(K, "enc")  → decrypts the blob (AES-GCM-256)
 *     token  = HKDF(K, "wr")   → sent as a header; the worker stores its hash
 *
 * One primitive (HKDF-SHA256) with distinct `info` strings, so the three are
 * domain-separated by construction and no two of them can ever be confused.
 *
 * What the store learns is an opaque id and a hash of a hash. It cannot
 * decrypt, and it cannot derive the key from the token — the zero-knowledge
 * property of #116 survives intact. The one honest caveat: the worker *sees*
 * the token on every write, so its operator (or a breach of it) could
 * overwrite a room. Without `encKey` anything they write fails AES-GCM
 * authentication and reads as damaged, so they can vandalise and never forge —
 * the same trust position as today, where they could always delete a blob.
 *
 * Because the id is a pure function of `K`, a room's id cannot die, only nap:
 * the store forgetting a blob is not the end of the room, because the next
 * push re-creates it at the same id and every link already sent starts working
 * again. That is why `PUT /:id` creates as well as replaces, and why none of
 * the "your old link stopped working" machinery exists.
 *
 * Pure in the sense lib/ means: no DOM, no state, no window. WebCrypto is a
 * platform global, as it already is in share-crypto.js.
 */
import { bytesToBase64url, base64urlToBytes } from './codec.js';
import { DAMAGED } from './sharelink.js';

/** 256 bits, like the content key it derives — the master key is the whole
    secret, so it is not allowed to be the weakest part of the chain. */
export const MASTER_KEY_BYTES = 32;

/** Matches the id length the store already mints for `s1` blobs: ~11 base64url
    characters, ~64 bits. Unguessable at any rate this worker will serve, which
    is what makes an unclaimed slot safe to claim on first write. */
export const ROOM_ID_BYTES = 8;

/** The `info` strings. Written out rather than built from a prefix so that a
    change to one is visibly a change to one — they are part of the wire
    format, and rotating them silently would orphan every room in existence. */
const INFO_ID = 'travel-planner/room/id';
const INFO_ENC = 'travel-planner/room/enc';
const INFO_TOKEN = 'travel-planner/room/token';

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('This browser cannot create a shared link');
  return c.subtle;
};

/** A fresh master key, base64url — 43 characters, which is most of what a
    writer link weighs. */
export function newMasterKey() {
  const bytes = new Uint8Array(MASTER_KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

async function hkdf(raw, info, bytes) {
  const s = subtle();
  const key = await s.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = await s.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    // No salt: the input keying material is already 256 uniformly random bits,
    // so a salt buys nothing here, and a *fixed* one would have to be agreed
    // between the page and every link ever sent.
    salt: new Uint8Array(0),
    info: new TextEncoder().encode(info),
  }, key, bytes * 8);
  return new Uint8Array(bits);
}

/**
 * The three values a master key stands for.
 *
 * @param {string} masterKey base64url, 32 bytes
 * @returns {Promise<{id: string, encKey: string, token: string}>}
 */
export async function deriveRoom(masterKey) {
  let raw;
  try { raw = base64urlToBytes(masterKey); }
  catch (e) { throw new Error(DAMAGED, { cause: e }); }
  if (raw.length !== MASTER_KEY_BYTES) throw new Error(DAMAGED);
  const [id, enc, token] = await Promise.all([
    hkdf(raw, INFO_ID, ROOM_ID_BYTES),
    hkdf(raw, INFO_ENC, 32),
    hkdf(raw, INFO_TOKEN, 32),
  ]);
  return {
    id: bytesToBase64url(id),
    encKey: bytesToBase64url(enc),
    token: bytesToBase64url(token),
  };
}

/**
 * base64url SHA-256 of a string, over its UTF-8 bytes.
 *
 * Two things use it and both must agree with the Worker, which computes it the
 * same way over the raw header value and over the stored ciphertext:
 *   - the write token's digest, which is what the store keeps instead of the
 *     token, so a breach of the store yields nothing that can write; and
 *   - a blob's etag, which is how a push says which version it is replacing.
 */
export async function digest(text) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return bytesToBase64url(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}
