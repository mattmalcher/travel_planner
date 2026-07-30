// The desktop CLI (scripts/itin.mjs). Tests import its functions directly
// rather than spawning node, so they stay in the milliseconds band with the
// rest of the unit suite.
//
// The load-bearing assertion is the per-type segment error one: validating a
// segment against the schema's `oneOf` reports every branch's failures, so a
// half-filled event comes back demanding transport's `mode` and `departs`. The
// app avoids that (src/validate.js, issue #76) and the CLI has to avoid it too,
// or its errors are actively misleading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  checkDoc, checkFile, formatReport, exitCode, bumpDoc, replaceDoctrineBlock, doctrineBlock,
  fragmentOf, linkFor, linkDecode, linkEncode,
} from '../../scripts/itin.mjs';
import { decodeShare, readShareFragment, SCHEME_DEFLATE } from '../../src/lib/sharelink.js';

const EXAMPLE = new URL('../../examples/paris_weekend.json', import.meta.url);
const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));

const transport = () => ({
  id: 'seg-t1', type: 'transport', mode: 'train', operator: 'Eurostar', date: '2026-09-18',
  departs: { place: 'London', time: '16:31' }, arrives: { place: 'Paris', time: '19:49' },
  duration_min: 138, cost: { status: 'free' },
});

test('the bundled example validates cleanly', () => {
  const r = checkDoc(example());
  assert.deepEqual(r.schemaErrors, []);
  assert.deepEqual(r.warnings, []);
});

test('checkFile reports identity and counts', () => {
  const r = checkFile(new URL(EXAMPLE).pathname);
  assert.equal(r.identity.name, 'Paris Weekend (example)');
  assert.equal(r.counts.segments, 3);
  assert.equal(r.counts.lists, 2);
  assert.equal(r.counts.phraseGroups, 2);
  assert.ok(formatReport([r]).includes('Paris Weekend (example)'));
});

test('an unreadable file is reported, not thrown', () => {
  const r = checkFile('/nonexistent/nope.json');
  assert.ok(r.unreadable);
  assert.equal(exitCode([r], false), 1);
  assert.ok(formatReport([r]).includes('unreadable'));
});

test('a half-filled event reports its OWN missing field, not the oneOf soup', () => {
  const doc = example();
  doc.segments.push({ id: 'seg-bad', type: 'event', name: 'Half filled', date: '2026-09-19', cost: { status: 'free' } });
  const { schemaErrors } = checkDoc(doc);

  const joined = schemaErrors.join('\n');
  assert.ok(joined.includes('subtype'), `expected the real error, got:\n${joined}`);
  assert.ok(joined.includes('seg-bad'), 'the error should name the segment');
  // The transport and accommodation branches must not be quoted at the user.
  for (const noise of ['mode', 'departs', 'arrives', 'duration_min', 'checkin', 'checkout', 'oneOf'])
    assert.ok(!joined.includes(noise), `oneOf noise leaked: "${noise}" in\n${joined}`);
});

test('a segment naming no known type still fails', () => {
  const doc = example();
  doc.segments.push({ id: 'seg-huh', type: 'teleport', name: 'Nope' });
  assert.ok(checkDoc(doc).schemaErrors.length > 0);
});

test('document-level errors outside /segments/ are reported', () => {
  const doc = example();
  delete doc.trip.currency_primary;
  const joined = checkDoc(doc).schemaErrors.join('\n');
  assert.ok(joined.includes('currency_primary'), joined);
});

test('a payment-sum mismatch is a warning, not an error', () => {
  const doc = example();
  doc.segments = [{ ...transport(), cost: { status: 'paid', amount: 100, payments: [{ amount: 40, status: 'paid' }] } }];
  const r = checkDoc(doc);
  assert.deepEqual(r.schemaErrors, []);
  assert.ok(r.warnings.some(w => w.includes('payments sum to')), r.warnings.join('\n'));
});

test('exit code: warnings pass, errors fail, --strict fails on warnings', () => {
  const clean = { schemaErrors: [], warnings: [] };
  const warned = { schemaErrors: [], warnings: ['something advisory'] };
  const broken = { schemaErrors: ['nope'], warnings: [] };

  assert.equal(exitCode([clean], false), 0);
  assert.equal(exitCode([warned], false), 0);
  assert.equal(exitCode([warned], true), 1);
  assert.equal(exitCode([broken], false), 1);
  assert.equal(exitCode([clean, broken], false), 1);
});

test('a different schema MAJOR is refused with a pointer to the migration doc', () => {
  const doc = example();
  doc.schema_version = '2.9.0';
  const joined = checkDoc(doc).schemaErrors.join('\n');
  assert.ok(joined.includes('major'), joined);
  assert.ok(joined.includes('migrating-2.x-to-3.0.0'), joined);
});

test('the same MAJOR at a different MINOR is fine', () => {
  // examples/paris_weekend.json is 3.3.0 against a 3.4.x schema on purpose.
  const doc = example();
  doc.schema_version = '3.0.0';
  assert.deepEqual(checkDoc(doc).schemaErrors, []);
});

test('a document with no schema_version is not version-checked', () => {
  const doc = example();
  delete doc.schema_version;
  assert.deepEqual(checkDoc(doc).schemaErrors, []);
});

/* --- bump ---------------------------------------------------------------- */

test('bump advances rev and updated_at, leaving identity alone', () => {
  const doc = { ...example(), trip_id: 'trip-abc', rev: 4, updated_at: '2026-01-01T00:00:00.000Z' };
  const next = bumpDoc(doc, new Date('2026-07-26T13:00:00.000Z'));

  assert.equal(next.rev, 5);
  assert.equal(next.updated_at, '2026-07-26T13:00:00.000Z');
  assert.equal(next.trip_id, 'trip-abc', 'trip_id is the app\'s to mint');
  assert.equal(next.schema_version, doc.schema_version);
  assert.ok(!('forked_from' in next));
  assert.equal(doc.rev, 4, 'bumpDoc must not mutate its input');
});

test('bump treats a missing or junk rev as 1', () => {
  assert.equal(bumpDoc({}).rev, 2);
  assert.equal(bumpDoc({ rev: 0 }).rev, 2);
  assert.equal(bumpDoc({ rev: 'seven' }).rev, 2);
});

/* --- share links ---------------------------------------------------------- */

// The link commands are what makes the CLI usable where there is no data/ —
// a Claude Code cloud session driven from a phone. The encoding itself is
// tested in sharelink.test.js and codec.test.js; what matters here is that the
// CLI's half agrees with the browser's, and that a file leaves the machine
// only when it is fit to hand back.

/** Run a command with its reports captured rather than printed, so the suite
    output stays readable and the link it emits on stdout is assertable.
    Returns `{code, out}`. */
async function run(fn) {
  const { log, error } = console;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = () => {};
  try { return { code: await fn(), out: lines.join('\n') }; }
  finally { console.log = log; console.error = error; }
}

const tmp = () => mkdtempSync(join(tmpdir(), 'itin-link-'));

test('fragmentOf takes a whole share URL or a bare fragment', () => {
  assert.equal(fragmentOf('https://host/page.html#d1=abc'), 'd1=abc');
  assert.equal(fragmentOf('#d1=abc'), 'd1=abc');
  assert.equal(fragmentOf('d1=abc'), 'd1=abc');
  assert.equal(fragmentOf('  https://host/p#u1=xyz  '), 'u1=xyz');
  // A query survives on the way in; only the fragment is the payload.
  assert.equal(fragmentOf('https://host/p?a=b#d1=abc'), 'd1=abc');
});

test('linkFor compresses, and stamps the repo schema version', async () => {
  const doc = { ...example(), schema_version: '3.0.0' };
  const url = await linkFor(doc);
  const frag = readShareFragment(fragmentOf(url));

  // node has CompressionStream, so the u1 fallback must not be what we get.
  assert.equal(frag.scheme, SCHEME_DEFLATE);
  const back = await decodeShare(frag);
  assert.notEqual(back.schema_version, '3.0.0', 'the link carries the version this build writes');
  assert.deepEqual({ ...back, schema_version: null }, { ...doc, schema_version: null });
});

test('linkFor honours a base URL and leaves any existing fragment behind', async () => {
  const url = await linkFor(example(), 'https://example.test/viewer.html#stale');
  assert.ok(url.startsWith('https://example.test/viewer.html#d1='), url.slice(0, 60));
  assert.ok(!url.includes('stale'));
});

test('encode → decode round-trips a document through the filesystem', async () => {
  const dir = tmp();
  const src = join(dir, 'trip.json');
  const out = join(dir, 'nested', 'back.json');   // the directory does not exist yet
  writeFileSync(src, JSON.stringify(example(), null, 2));

  const encoded = await run(() => linkEncode(src));
  assert.equal(encoded.code, 0);
  const url = encoded.out.trim();          // the link is all that reaches stdout
  assert.ok(url.startsWith('https://'), url);

  assert.equal((await run(() => linkDecode(url, out))).code, 0);
  const back = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(back.trip.name, 'Paris Weekend (example)');
  assert.equal(back.segments.length, 3);
});

test('encode refuses a document with schema errors', async () => {
  const dir = tmp();
  const path = join(dir, 'broken.json');
  const doc = example();
  delete doc.segments[0].date;
  writeFileSync(path, JSON.stringify(doc));

  assert.equal((await run(() => linkEncode(path))).code, 1, 'a broken file must not become a link');
});

test('encode refuses a file it cannot read', async () => {
  assert.equal((await run(() => linkEncode('/nonexistent/nope.json'))).code, 1);
});

test('a damaged link says so rather than yielding an empty trip', async () => {
  const out = join(tmp(), 'x.json');
  await assert.rejects(() => linkDecode('https://host/p#d1=not base64!', out), /damaged or incomplete/);
  await assert.rejects(() => linkDecode('https://host/p', out), /does not carry an itinerary/);
});

test('decode writes the file even when it fails to validate, and exits 1', async () => {
  const dir = tmp();
  const out = join(dir, 'incoming.json');
  const doc = example();
  delete doc.trip.currency_primary;
  const url = await linkFor(doc);

  assert.equal((await run(() => linkDecode(url, out))).code, 1);
  // Landing on disk is the point: an incoming document you have to fix has to
  // be there to fix.
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).segments.length, 3);
});

/* --- doctrine block surgery ---------------------------------------------- */

test('replaceDoctrineBlock swaps the marked region only', () => {
  const md = `before\n<!-- doctrine:begin x -->\nstale\n<!-- doctrine:end -->\nafter\n`;
  const out = replaceDoctrineBlock(md);
  assert.ok(out.startsWith('before\n'));
  assert.ok(out.endsWith('\nafter\n'));
  assert.ok(out.includes(doctrineBlock()));
  assert.ok(!out.includes('stale'));
});

test('replaceDoctrineBlock refuses a file it cannot place the block in', () => {
  assert.throws(() => replaceDoctrineBlock('no markers here'), /missing the/);
  assert.throws(() => replaceDoctrineBlock('<!-- doctrine:end -->\n<!-- doctrine:begin -->'), /wrong order/);
  assert.throws(
    () => replaceDoctrineBlock('<!-- doctrine:begin -->a<!-- doctrine:end --><!-- doctrine:begin -->b<!-- doctrine:end -->'),
    /more than one/);
});
