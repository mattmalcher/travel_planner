import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { condenseSchema } from '../../src/lib/schema-brief.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/holiday_itinerary_schema.json', import.meta.url), 'utf8'));
const brief = condenseSchema(schema);

test('condenseSchema lists the document shape and every definition', () => {
  assert.match(brief, /^Document: \{schema_version:str [^,]+, trip\*:/);
  // The trip library's bookkeeping is the viewer's, not the model's (issue #80).
  for (const field of ['trip_id', 'rev:', 'updated_at', 'updated_by', 'forked_from'])
    assert.ok(!brief.includes(field), `${field} should not be in the AI's schema brief`);
  assert.match(brief, /segments\*:\[TransportSegment\|AccommodationSegment\|EventSegment\]/);
  for (const name of Object.keys(schema.definitions))
    assert.match(brief, new RegExp('^' + name + ': \\{', 'm'), name + ' missing');
});

test('condenseSchema keeps required markers, consts, enums and formats', () => {
  assert.match(brief, /\bid\*:str/);
  assert.match(brief, /type\*:"transport"/);
  assert.match(brief, /mode\*:\(train\|bus\|ferry\|flight\|taxi\)/);
  assert.match(brief, /start\*:date/);
  assert.match(brief, /currency_primary\*:str \^\[A-Z\]\{3\}\$/);
  assert.match(brief, /duration_min\*:int/);
  // Optional fields carry no star.
  assert.match(brief, /\bnotes:str/);
  assert.match(brief, /self_checkin:bool/);
  // Nested inline objects (payments) survive with their own required markers.
  assert.match(brief, /payments:\[\{amount\*:num, status\*:\(paid\|pending\)/);
  // additionalProperties maps (pricing tiers) are represented.
  assert.match(brief, /pricing:\{<any key>:\{/);
});

test('condenseSchema is a fraction of the raw schema size', () => {
  const raw = JSON.stringify(schema).length;
  assert.ok(brief.length < raw * 0.25, `brief ${brief.length} vs raw ${raw}`);
});
