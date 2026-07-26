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
import { readFileSync } from 'node:fs';

import { checkDoc, checkFile, formatReport, exitCode, bumpDoc, replaceDoctrineBlock, doctrineBlock } from '../../scripts/itin.mjs';

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
