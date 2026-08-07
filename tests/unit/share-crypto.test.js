// The encryption under a hosted share link (issue #116). What matters is not
// that a round trip works — it is that nothing readable leaves the browser,
// that every share gets its own key, and that a damaged or wrong-keyed blob
// says so rather than decoding into half a trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encryptShare, decryptShare, KEY_CHARS } from '../../src/lib/share-crypto.js';

const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));
const text = JSON.stringify(example);

test('a document round-trips through encryption unchanged', async () => {
  const { bytes, key } = await encryptShare(text);
  assert.deepEqual(JSON.parse(await decryptShare(bytes, key)), example);
});

test('the key is a fragment-safe 256-bit key', async () => {
  const { key } = await encryptShare(text);
  assert.equal(key.length, KEY_CHARS);
  assert.match(key, /^[A-Za-z0-9_-]+$/); // no %-escaping needed in a URL
});

test('every share gets its own key, so one link never opens another', async () => {
  const a = await encryptShare(text);
  const b = await encryptShare(text);
  assert.notEqual(a.key, b.key);
  // Same plaintext, different ciphertext: the IV is fresh too.
  assert.notEqual(Buffer.from(a.bytes).toString('hex'), Buffer.from(b.bytes).toString('hex'));
  await assert.rejects(decryptShare(a.bytes, b.key), /damaged or incomplete/);
});

test('what goes to the store carries nothing readable', async () => {
  const { bytes } = await encryptShare(text);
  const blob = Buffer.from(bytes).toString('latin1');
  for (const secret of ['Paris', 'Jetson', 'trip', 'segments'])
    assert.ok(!blob.includes(secret), `ciphertext contains ${secret}`);
});

test('a tampered blob fails the tag check instead of decoding', async () => {
  const { bytes, key } = await encryptShare(text);
  const flipped = Uint8Array.from(bytes);
  flipped[flipped.length - 5] ^= 0xff;
  await assert.rejects(decryptShare(flipped, key), /damaged or incomplete/);
});

test('a truncated blob — the store returning a short read — is caught', async () => {
  const { bytes, key } = await encryptShare(text);
  await assert.rejects(decryptShare(bytes.subarray(0, bytes.length - 20), key), /damaged or incomplete/);
  await assert.rejects(decryptShare(bytes.subarray(0, 4), key), /damaged or incomplete/);
});

test('a key that is not one is refused before any decryption is attempted', async () => {
  const { bytes } = await encryptShare(text);
  await assert.rejects(decryptShare(bytes, 'short'), /damaged or incomplete/);
  await assert.rejects(decryptShare(bytes, ''), /damaged or incomplete/);
});

test('unicode survives', async () => {
  const s = JSON.stringify({ trip: { name: 'Café — Δelta 🧳' } });
  const { bytes, key } = await encryptShare(s);
  assert.equal(await decryptShare(bytes, key), s);
});

test('compression happens inside the envelope, so a real trip stays small', async () => {
  const { bytes } = await encryptShare(text);
  assert.ok(bytes.length < text.length * 0.75,
    `encrypted ${bytes.length} vs raw ${text.length} — compression is not happening`);
});

test('an ArrayBuffer decrypts as readily as a view — it is what fetch returns', async () => {
  const { bytes, key } = await encryptShare(text);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.deepEqual(JSON.parse(await decryptShare(buf, key)), example);
});
