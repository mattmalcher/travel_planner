import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { condenseSchema } from '../../src/lib/schema-brief.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/holiday_itinerary_schema.json', import.meta.url), 'utf8'));
const brief = condenseSchema(schema);

test('condenseSchema lists the document shape and every definition', () => {
  assert.match(brief, /^Document: \{trip\*:/);
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
  assert.match(brief, /self_checkin\*:bool/);
  assert.match(brief, /duration_min\*:int/);
  // Optional fields carry no star.
  assert.match(brief, /\bnotes:str/);
  // Nested inline objects (payments) survive with their own required markers.
  assert.match(brief, /payments:\[\{amount\*:num, status\*:\(paid\|pending\)/);
  // additionalProperties maps (pricing tiers) are represented.
  assert.match(brief, /pricing:\{<any key>:\{/);
});

test('condenseSchema is a fraction of the raw schema size', () => {
  const raw = JSON.stringify(schema).length;
  assert.ok(brief.length < raw * 0.25, `brief ${brief.length} vs raw ${raw}`);
});
