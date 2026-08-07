// Share links (issue #81): the encoding, the versioned scheme marker, and the
// round trip that is the whole collaboration loop — open someone's link, edit,
// share it back, and get an equivalent document out the other side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEME_DEFLATE, SCHEME_PLAIN, SCHEME_HOSTED, SHARE_WARN_CHARS,
  shareDocument, encodeShare, decodeShare, readShareFragment, hasShareLink,
  linkBase, shareUrl, isOverlong, isHosted, hostedFragment, hostedUrl, parseHosted,
  parseShareDocument, DAMAGED, NOT_A_SHARE,
} from '../../src/lib/sharelink.js';
import { toBase64url } from '../../src/lib/codec.js';

const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));

const PAGE = 'https://example.test/holiday_itinerary_viewer.html';

test('a document round-trips through a link unchanged', async () => {
  const doc = shareDocument(example, '3.1.0');
  assert.deepEqual(await decodeShare(await encodeShare(doc)), doc);
});

test('the payload is marked with the scheme that produced it', async () => {
  const fragment = await encodeShare(example);
  assert.match(fragment, /^d1=[A-Za-z0-9_-]+$/);
  // Versioned rather than bare, so a later encoding can arrive without
  // breaking links already sent.
  assert.equal(readShareFragment('#' + fragment).scheme, SCHEME_DEFLATE);
});

test('compression is what keeps a link sendable', async () => {
  const raw = JSON.stringify(example);
  const { data } = readShareFragment('#' + await encodeShare(example));
  assert.ok(data.length < raw.length * 0.75,
    `encoded ${data.length} vs raw ${raw.length} — compression is not happening`);
});

test('the uncompressed fallback decodes, so a browser without CompressionStream can still send one', async () => {
  const fragment = `${SCHEME_PLAIN}=${toBase64url(JSON.stringify(example))}`;
  assert.deepEqual(await decodeShare(fragment), example);
});

test('unicode survives the link', async () => {
  const doc = { trip: { name: 'Café — Δelta 🧳' } };
  assert.deepEqual(await decodeShare(await encodeShare(doc)), doc);
});

test('the payload is found with or without a #, and among other fragment parts', async () => {
  const fragment = await encodeShare(example);
  assert.deepEqual(readShareFragment(fragment), readShareFragment('#' + fragment));
  assert.equal(readShareFragment('#day-3&' + fragment).scheme, SCHEME_DEFLATE);
  assert.equal(readShareFragment('#' + fragment + '&utm=x').scheme, SCHEME_DEFLATE);
});

test('a fragment that is not a share link is not one', () => {
  assert.equal(readShareFragment(''), null);
  assert.equal(readShareFragment(undefined), null);
  assert.equal(readShareFragment('#day-3'), null);
  assert.equal(readShareFragment('#d=abc'), null);   // the bare marker the scheme deliberately isn't
  assert.equal(readShareFragment('#d2=abc'), null);  // a scheme this build does not know
  assert.equal(hasShareLink('#day-3'), false);
  assert.equal(hasShareLink('#d1=abc'), true);
});

test('a damaged link reports itself instead of decoding to an empty trip', async () => {
  await assert.rejects(decodeShare('#d1=not base64!'), /damaged or incomplete/);
  await assert.rejects(decodeShare('#d1=abcdef'), /damaged or incomplete/);
  await assert.rejects(decodeShare('#day-3'), /does not carry an itinerary/);
  // Valid encoding, but not a document.
  await assert.rejects(decodeShare(`${SCHEME_PLAIN}=${toBase64url('[1,2,3]')}`), /does not carry an itinerary/);
  await assert.rejects(decodeShare(`${SCHEME_PLAIN}=${toBase64url('null')}`), /does not carry an itinerary/);
  await assert.rejects(decodeShare(`${SCHEME_PLAIN}=${toBase64url('{oops')}`), /damaged or incomplete/);
});

test('a truncated link — what a messaging app does to a long one — is caught', async () => {
  const fragment = await encodeShare(example);
  await assert.rejects(decodeShare(fragment.slice(0, fragment.length - 40)), /damaged or incomplete/);
});

test('the shared document is stamped with this build\'s schema version', () => {
  const doc = shareDocument({ schema_version: '2.0.0', trip: { name: 'Paris' } }, '3.1.0');
  assert.equal(doc.schema_version, '3.1.0');
  assert.deepEqual(doc.trip, { name: 'Paris' });
});

test('sharing does not mutate the document it was given', () => {
  const original = { schema_version: '2.0.0', trip: { name: 'Paris' } };
  shareDocument(original, '3.1.0');
  assert.equal(original.schema_version, '2.0.0');
});

test('identity rides along, so a link lands on the trip it came from', async () => {
  const doc = shareDocument({ ...example, trip_id: 'abc-123', rev: 7, updated_by: 'Judy' }, '3.1.0');
  const back = await decodeShare(await encodeShare(doc));
  assert.equal(back.trip_id, 'abc-123');
  assert.equal(back.rev, 7);
  assert.equal(back.updated_by, 'Judy');
});

test('the link is this page, with the document in the fragment', async () => {
  const url = await shareUrl(PAGE, example);
  assert.ok(url.startsWith(PAGE + '#d1='));
  assert.deepEqual(await decodeShare(new URL(url).hash), example);
});

test('an existing fragment is replaced and a query is kept', () => {
  assert.equal(linkBase(PAGE + '#d1=oldlink'), PAGE);
  assert.equal(linkBase(PAGE + '?v=2#day-3'), PAGE + '?v=2');
  assert.equal(linkBase(PAGE), PAGE);
  assert.equal(linkBase(''), '');
});

test('an implausibly long link is flagged, a realistic one is not', async () => {
  assert.equal(isOverlong(await shareUrl(PAGE, example)), false);
  assert.equal(isOverlong('x'.repeat(SHARE_WARN_CHARS)), false);
  assert.equal(isOverlong('x'.repeat(SHARE_WARN_CHARS + 1)), true);
});

/* --- hosted links (issue #116) ------------------------------------------- */

const KEY = 'a'.repeat(43);

test('a hosted link names a stored blob and carries the key to open it', () => {
  const url = hostedUrl(PAGE, 'AbCd012_-x', KEY);
  assert.equal(url, `${PAGE}#s1=AbCd012_-x.${KEY}`);
  // Both halves in the fragment: neither the id nor the key reaches a server.
  assert.ok(!url.slice(0, url.indexOf('#')).includes('AbCd012_-x'));
  assert.deepEqual(parseHosted(new URL(url).hash), { id: 'AbCd012_-x', key: KEY });
});

test('a hosted link is short, and stays short however big the trip is', () => {
  const url = hostedUrl('https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html', 'AbCd012_-x', KEY);
  // The whole point of issue #116: WhatsApp on Android silently declines to
  // linkify a link of a few thousand characters, and a fragment link grows
  // with the trip. This one does not.
  assert.ok(url.length < 140, `hosted link is ${url.length} chars`);
});

test('a hosted fragment is recognised as one, and the old shapes are not', async () => {
  assert.equal(isHosted(`#${hostedFragment('abc', KEY)}`), true);
  assert.equal(readShareFragment(`#${hostedFragment('abc', KEY)}`).scheme, SCHEME_HOSTED);
  assert.equal(hasShareLink(`#${hostedFragment('abc', KEY)}`), true);
  assert.equal(isHosted('#' + await encodeShare(example)), false);
  assert.equal(isHosted('#day-3'), false);
});

test('a hosted link needs fetching, and decoding one says so rather than guessing', async () => {
  await assert.rejects(decodeShare(`#${hostedFragment('abc', KEY)}`), /must be fetched/);
});

test('a truncated hosted link says so instead of asking the store for half an id', () => {
  assert.throws(() => parseHosted('#s1=abc'), /damaged or incomplete/);       // no key
  assert.throws(() => parseHosted('#s1=.def'), /damaged or incomplete/);      // no id
  assert.throws(() => parseHosted('#s1=abc.def.ghi'), /damaged or incomplete/);
  assert.throws(() => parseHosted('#s1=abc def'), /damaged or incomplete/);
  assert.throws(() => parseHosted('#d1=abcdef'), /does not carry an itinerary/);
});

test('a realistic trip stays inside a sendable link', async () => {
  // The example padded out to roughly two weeks of segments — the size the
  // proposal budgets 5–15 kB for.
  const big = {
    ...example,
    segments: Array.from({ length: 60 }, (_, i) => ({
      ...example.segments[i % example.segments.length], id: `seg-${i}`,
    })),
  };
  const url = await shareUrl(PAGE, shareDocument(big, '3.1.0'));
  assert.ok(url.length < SHARE_WARN_CHARS, `link is ${url.length} chars`);
  assert.deepEqual((await decodeShare(new URL(url).hash)).segments.length, 60);
});

/* --- one wording for one event ------------------------------------------- */

// The three stages of opening a link fail independently — the fragment, the
// decryption, the JSON — but to whoever holds the link they are one event, so
// they must say one thing. These were six literals across three modules.
test('a damaged link says the same thing wherever it was caught', async () => {
  const truncatedFragment = decodeShare('#d1=not-valid-deflate-data')
    .then(() => null, e => e.message);
  const badJson = (() => { try { parseShareDocument('{not json'); } catch (e) { return e.message; } })();
  assert.equal(await truncatedFragment, DAMAGED);
  assert.equal(badJson, DAMAGED);
});

test('parseShareDocument refuses anything that is not an itinerary object', () => {
  for (const text of ['[]', 'null', '"a string"', '42']) {
    assert.throws(() => parseShareDocument(text), { message: NOT_A_SHARE }, text);
  }
  assert.deepEqual(parseShareDocument('{"trip":{"name":"X"}}'), { trip: { name: 'X' } });
});
