// The key derivation behind a mutable share (issue #124). Three values out of
// one master key, and the two properties the whole design rests on: a viewer
// cannot get back to the write token, and the id is a pure function of the key
// — which is what makes an expired room heal at the same id instead of
// orphaning every link already sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newMasterKey, deriveRoom, digest, MASTER_KEY_BYTES, ROOM_ID_BYTES,
} from '../../src/lib/room-keys.js';
import { base64urlToBytes } from '../../src/lib/codec.js';
import { encryptWith, decryptShare } from '../../src/lib/share-crypto.js';
import { DAMAGED } from '../../src/lib/sharelink.js';

test('a fresh master key is 256 base64url-encoded bits', () => {
  const k = newMasterKey();
  assert.match(k, /^[A-Za-z0-9_-]+$/);
  assert.equal(base64urlToBytes(k).length, MASTER_KEY_BYTES);
  assert.notEqual(newMasterKey(), k);
});

test('the same key always derives the same three values', async () => {
  const k = newMasterKey();
  assert.deepEqual(await deriveRoom(k), await deriveRoom(k));
});

test('the id is short, and the id, the content key and the token are all different', async () => {
  const { id, encKey, token } = await deriveRoom(newMasterKey());
  assert.equal(base64urlToBytes(id).length, ROOM_ID_BYTES);
  assert.equal(base64urlToBytes(encKey).length, 32);
  assert.equal(base64urlToBytes(token).length, 32);
  // Distinct info strings, so no two of the three can ever be confused for
  // each other — the point of deriving rather than slicing one hash.
  assert.equal(new Set([id, encKey, token]).size, 3);
});

test('two keys derive different ids', async () => {
  const a = await deriveRoom(newMasterKey());
  const b = await deriveRoom(newMasterKey());
  assert.notEqual(a.id, b.id);
});

test('the content key really opens the blob it is derived for', async () => {
  const { encKey } = await deriveRoom(newMasterKey());
  const bytes = await encryptWith('{"trip":{"name":"Orbit City"}}', encKey);
  assert.equal(await decryptShare(bytes, encKey), '{"trip":{"name":"Orbit City"}}');
});

test('a viewer holding id and content key cannot reach the write token', async () => {
  const k = newMasterKey();
  const { id, encKey, token } = await deriveRoom(k);
  // What a `v1=` link carries is exactly these two, and HKDF only runs
  // forwards: there is no computation from them back to K or to the token.
  // The strongest thing a test can assert is that they are not it.
  assert.notEqual(id, token);
  assert.notEqual(encKey, token);
  assert.notEqual(encKey, k);
});

test('a damaged master key is refused rather than deriving nonsense', async () => {
  await assert.rejects(() => deriveRoom('too-short'), e => e.message === DAMAGED);
  await assert.rejects(() => deriveRoom(''), e => e.message === DAMAGED);
});

test('digest is base64url SHA-256, and matches the Worker over the same input', async () => {
  // The known vector for the empty string, so both implementations are pinned
  // to an outside fact rather than to each other.
  assert.equal(await digest(''), '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
  assert.match(await digest('a-write-token'), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(await digest('a'), await digest('b'));
});

test('digest takes bytes as well as text — an etag is over the ciphertext', async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  assert.equal(await digest(bytes), await digest(Uint8Array.from([1, 2, 3])));
  assert.notEqual(await digest(bytes), await digest(Uint8Array.from([1, 2, 4])));
});
