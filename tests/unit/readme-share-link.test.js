// The README carries a live share link (a "try it" example itinerary in the
// URL fragment). It is an opaque blob, so nothing about it is reviewable by
// eye: this test decodes the real link out of README.md and checks it still
// carries the example document, still validates against the current schema,
// and still declares a schema version this build would accept rather than
// warn about.
//
// Regenerate after editing examples/orbit_city_weekend.json:
//   node scripts/share-link.mjs examples/orbit_city_weekend.json
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { decodeShare, linkBase, isOverlong } from '../../src/lib/sharelink.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

const readme = read('../../README.md');
const schema = JSON.parse(read('../../schema/holiday_itinerary_schema.json'));
const example = JSON.parse(read('../../examples/orbit_city_weekend.json'));

const major = v => String(v || '').split('.')[0];

// The link as it appears in the markdown, fragment and all.
const found = readme.match(/https:\/\/\S*?#(?:d1|u1)=[A-Za-z0-9_-]+/g) || [];

test('the README carries exactly one share link', () => {
  assert.equal(found.length, 1);
});

test('it points at the deployed viewer', () => {
  assert.equal(
    linkBase(found[0]),
    'https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html',
  );
});

test('it is short enough to survive being sent to someone', () => {
  assert.equal(isOverlong(found[0]), false);
});

test('it decodes to the example itinerary, stamped with the current schema version', async () => {
  const doc = await decodeShare(found[0].slice(found[0].indexOf('#')));
  assert.deepEqual(doc, { ...example, schema_version: schema.version });
});

test('the document it carries validates, and needs no version warning', async () => {
  const doc = await decodeShare(found[0].slice(found[0].indexOf('#')));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.ok(validate(doc), JSON.stringify(validate.errors));
  // The upload guard in src/app.js compares majors — a mismatch shows a warning
  // over the itinerary, which is not what a "try it" link should do.
  assert.equal(major(doc.schema_version), major(schema.version));
});

test('the example itself is fictional-data only', () => {
  const text = read('../../examples/orbit_city_weekend.json');
  assert.match(text, /Jetson/);
  // No coordinates: the trip is somewhere that does not exist, so a lat/lng
  // would drop a pin on a real place instead.
  assert.doesNotMatch(text, /"lat"|"lng"/);
});
