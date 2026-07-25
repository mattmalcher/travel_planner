// The storage codec (issue #80): deflate-raw + base64url, with a plain-JSON
// fallback so a browser without CompressionStream still gets a history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAN_COMPRESS, encodeValue, decodeValue, deflateToBase64url, inflateFromBase64url,
} from '../../src/lib/codec.js';

const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));

test('a document round-trips through the codec unchanged', async () => {
  const encoded = await encodeValue(example);
  assert.equal(encoded.enc, CAN_COMPRESS ? 'deflate-raw' : 'plain');
  assert.deepEqual(await decodeValue(encoded), example);
});

test('base64url output is safe in JSON, a URL and localStorage', async () => {
  const encoded = await deflateToBase64url(JSON.stringify(example));
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(await inflateFromBase64url(encoded)), example);
});

test('compression is what makes a 50-revision history affordable', async () => {
  const raw = JSON.stringify(example);
  const { data } = await encodeValue(example);
  assert.ok(data.length < raw.length * 0.75,
    `encoded ${data.length} vs raw ${raw.length} — compression is not happening`);
});

test('a plain entry decodes too, so nothing written by an older browser is lost', async () => {
  assert.deepEqual(await decodeValue({ enc: 'plain', data: '{"trip":{"name":"Paris"}}' }), { trip: { name: 'Paris' } });
});

test('a junk entry decodes to null rather than throwing', async () => {
  assert.equal(await decodeValue(null), null);
  assert.equal(await decodeValue({ enc: 'deflate-raw' }), null);
});

test('unicode survives the byte round trip', async () => {
  const value = { trip: { name: 'Café — Δelta 🧳' } };
  assert.deepEqual(await decodeValue(await encodeValue(value)), value);
});
