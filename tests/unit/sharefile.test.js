// Sharing a trip as a file (issue #114): what the attachment is called, what
// is in it, and the one parser for text that might be a trip. The browser half
// — navigator.share, the clipboard, the paste listener — is tests/e2e/share.spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SHARE_MIME, SHARE_EXT, docStem, shareFilename, shareFileText, sharePayload, readShareText,
} from '../../src/lib/sharefile.js';
import { encodeShare, shareDocument } from '../../src/lib/sharelink.js';

const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));

const PAGE = 'https://example.test/holiday_itinerary_viewer.html';

test('the attachment is plain JSON, which every messenger already knows', () => {
  // A custom extension would buy a file-handler registration later, and cost a
  // send today to any app that refuses a type it has not heard of.
  assert.equal(SHARE_MIME, 'application/json');
  assert.equal(SHARE_EXT, '.json');
});

test('a trip name becomes a filename stem, and a nameless one still has a name', () => {
  assert.equal(docStem({ trip: { name: 'Paris weekend!' } }), 'paris_weekend');
  assert.equal(docStem({ trip: { name: '  Alps   ski trip  ' } }), 'alps_ski_trip');
  assert.equal(docStem({}), 'itinerary');
  assert.equal(docStem(null), 'itinerary');
  // Nothing left after the strip is still a file that has to be called something.
  assert.equal(docStem({ trip: { name: '🧳🧳' } }), 'itinerary');
});

test('the filename carries the day, so two shares in one chat are distinguishable', () => {
  const doc = { trip: { name: 'Paris weekend' } };
  assert.equal(shareFilename(doc, '2026-08-07'), 'paris_weekend_2026-08-07.json');
  assert.equal(shareFilename(doc, '2026-08-07', 'rev3'), 'paris_weekend_rev3_2026-08-07.json');
  // The download keeps the undated name it always had.
  assert.equal(shareFilename(doc, null), 'paris_weekend.json');
  assert.equal(shareFilename(doc, null, 'backup'), 'paris_weekend_backup.json');
});

test('the file is the document, stamped with this build\'s schema version', () => {
  const text = shareFileText({ schema_version: '2.0.0', trip: { name: 'Paris' } }, '3.1.0');
  const back = JSON.parse(text);
  assert.equal(back.schema_version, '3.1.0');
  assert.deepEqual(back.trip, { name: 'Paris' });
  assert.ok(text.includes('\n  '), 'pretty-printed, like the download it is the same file as');
});

test('the file round-trips back through the paste parser', async () => {
  const text = shareFileText(example, '3.1.0');
  assert.deepEqual(await readShareText(text), shareDocument(example, '3.1.0'));
});

test('the copy-as-text payload is the link payload, without a link around it', async () => {
  const payload = await sharePayload(example, '3.1.0');
  assert.match(payload, /^d1=[A-Za-z0-9_-]+$/);
  assert.deepEqual(await readShareText(payload), shareDocument(example, '3.1.0'));
});

test('a pasted share link is read, fragment and all', async () => {
  const url = `${PAGE}#${await encodeShare(example)}`;
  assert.deepEqual(await readShareText(url), example);
  // Surrounding whitespace is what a paste out of a chat app actually contains.
  assert.deepEqual(await readShareText(`\n  ${url}  \n`), example);
});

test('a URL whose path contains the marker is not mistaken for a payload', async () => {
  // The fragment is found from the LAST #, so nothing before it can pose as one.
  const url = `https://example.test/d1=notapayload/page.html#${await encodeShare(example)}`;
  assert.deepEqual(await readShareText(url), example);
});

test('raw itinerary JSON is a trip, and other JSON is not', async () => {
  assert.deepEqual(await readShareText('{"trip":{"name":"Paris"}}'), { trip: { name: 'Paris' } });
  await assert.rejects(readShareText('[1,2,3]'), /does not look like an itinerary/);
  await assert.rejects(readShareText('{oops'), /not valid JSON/);
});

test('text that is not a trip says so rather than opening an empty one', async () => {
  await assert.rejects(readShareText(''), /does not look like an itinerary/);
  await assert.rejects(readShareText('   '), /does not look like an itinerary/);
  await assert.rejects(readShareText(null), /does not look like an itinerary/);
  await assert.rejects(readShareText('have a nice trip!'), /does not look like an itinerary/);
  await assert.rejects(readShareText(PAGE), /does not look like an itinerary/);
  // A truncated payload is the failure this whole issue is about, and it is the
  // link decoder's message that comes back rather than a blank trip.
  const payload = await sharePayload(example, '3.1.0');
  await assert.rejects(readShareText(payload.slice(0, payload.length - 40)), /damaged or incomplete/);
});

test('a big trip has no size to be too big for', async () => {
  // The point of the file: a link has a length limit and an attachment has not.
  const big = {
    ...example,
    segments: Array.from({ length: 400 }, (_, i) => ({
      ...example.segments[i % example.segments.length], id: `seg-${i}`,
    })),
  };
  const text = shareFileText(big, '3.1.0');
  assert.ok(text.length > 100000, `only ${text.length} chars — pick a bigger trip`);
  assert.equal((await readShareText(text)).segments.length, 400);
});
