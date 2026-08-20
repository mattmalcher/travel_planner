/**
 * The encryption under a hosted share link (issue #116).
 *
 * A hosted link is short because the itinerary is not in it — only an id
 * pointing at a blob the Worker holds, and the key to read it. The key travels
 * in the URL *fragment*, which is never sent in an HTTP request, so the
 * operator of the store holds ciphertext it has no way to open. Whoever has
 * the whole link has both halves, which is exactly the sharing model the
 * fragment-only links already had: the link *is* the secret.
 *
 * The payload layout, which the Worker never needs to know:
 *
 *   iv (12 bytes) ‖ AES-GCM(flag byte ‖ body)
 *
 * The flag says whether `body` is deflate-raw or plain UTF-8, so a browser
 * without CompressionStream (Safari before 16.4) can still produce a link —
 * the same fallback the fragment schemes make with `u1`. It sits *inside* the
 * ciphertext on purpose: how well a trip compresses is information about the
 * trip, and there is no reason to hand it over.
 *
 * AES-GCM authenticates as well as encrypts, so a truncated or tampered blob
 * fails to decrypt rather than decoding into a half-trip — the same promise
 * `decodeShare` makes about a damaged fragment.
 *
 * Pure in the sense lib/ means: no DOM, no state, no window. WebCrypto and the
 * compression streams are platform globals, the way codec.js already uses them.
 */
import {
  CAN_COMPRESS, deflateBytes, inflateBytes, bytesToBase64url, base64urlToBytes,
} from './codec.js';
// The wording a failed link gets, wherever it failed — see sharelink.js. No
// cycle: sharelink.js knows nothing about encryption.
import { DAMAGED } from './sharelink.js';

/** AES-GCM's standard nonce length. Prefixed to the ciphertext. */
const IV_BYTES = 12;
/** Body is deflate-raw / body is plain UTF-8. */
const FLAG_DEFLATE = 1;
const FLAG_PLAIN = 0;

/** A 256-bit key is 43 base64url characters — the bulk of a hosted link, and
    the reason one is ~120 characters rather than ~80. Worth it: the length is
    now constant, whatever the trip weighs. */
export const KEY_CHARS = 43;

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('This browser cannot encrypt a share link');
  return c.subtle;
};

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

async function compress(bytes) {
  if (!CAN_COMPRESS) return { flag: FLAG_PLAIN, body: bytes };
  try { return { flag: FLAG_DEFLATE, body: await deflateBytes(bytes) }; }
  catch (e) { return { flag: FLAG_PLAIN, body: bytes }; }
}

/**
 * Encrypt `text` under a key the caller already holds — the room case (issue
 * #124), where the content key is *derived* from the master key rather than
 * minted per share, so that replacing the blob keeps every link already sent
 * able to read it.
 *
 * @param {string} text
 * @param {string} key base64url, 32 bytes
 * @returns {Promise<Uint8Array>} the blob to upload
 */
export async function encryptWith(text, key) {
  const s = subtle();
  let raw;
  try { raw = base64urlToBytes(key); }
  catch (e) { throw new Error(DAMAGED, { cause: e }); }
  if (raw.length !== 32) throw new Error(DAMAGED);
  const k = await s.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const { flag, body } = await compress(new TextEncoder().encode(text));
  const plain = new Uint8Array(1 + body.length);
  plain[0] = flag;
  plain.set(body, 1);
  const iv = randomBytes(IV_BYTES);
  const cipher = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, k, plain));
  const bytes = new Uint8Array(iv.length + cipher.length);
  bytes.set(iv, 0);
  bytes.set(cipher, iv.length);
  return bytes;
}

/**
 * Encrypt `text` under a fresh random key.
 *
 * @returns {Promise<{bytes: Uint8Array, key: string}>} the blob to upload and
 *   the base64url key to put in the fragment. The key is generated here and
 *   never leaves the caller's hands — nothing in this module transmits it.
 */
export async function encryptShare(text) {
  const key = bytesToBase64url(randomBytes(32));
  return { bytes: await encryptWith(text, key), key };
}

/**
 * Inverse of encryptShare. Throws for a wrong key, a tampered blob or a
 * truncated one — GCM's tag check does not distinguish between them, and the
 * caller says the same thing about all three.
 */
export async function decryptShare(bytes, key) {
  const s = subtle();
  let raw;
  try { raw = base64urlToBytes(key); }
  catch (e) { throw new Error(DAMAGED, { cause: e }); }
  if (raw.length !== 32) throw new Error(DAMAGED);
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length <= IV_BYTES) throw new Error(DAMAGED);
  const k = await s.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await s.decrypt(
      { name: 'AES-GCM', iv: data.subarray(0, IV_BYTES) }, k, data.subarray(IV_BYTES),
    ));
  } catch (e) {
    throw new Error(DAMAGED, { cause: e });
  }
  const body = plain.subarray(1);
  const bare = plain[0] === FLAG_DEFLATE ? await inflateBytes(body) : body;
  return new TextDecoder().decode(bare);
}
