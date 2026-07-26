// The validators src/validate.js builds are compiled lazily in the browser —
// on first use rather than at boot, because ajv's codegen cost ~1.5s of
// main-thread time on a low-end phone for validators most page loads never
// need. The tradeoff is that a schema ajv cannot compile would no longer
// surface at startup, so it has to surface here instead: this compiles every
// validator the app builds, against the real schema, in CI.
//
// It also pins the behaviour the app depends on — segments validated against
// the one subschema their type names (issue #76), not the oneOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('../../schema/holiday_itinerary_schema.json', import.meta.url), 'utf8'));
const draft7 = 'http://json-schema.org/draft-07/schema#';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const sub = body => ajv.compile({ $schema: draft7, definitions: schema.definitions, ...body });

// Every schema src/validate.js hands to ajv.compile(), in the same shapes.
const SUBSCHEMAS = {
  transport: { $ref: '#/definitions/TransportSegment' },
  accommodation: { $ref: '#/definitions/AccommodationSegment' },
  event: { $ref: '#/definitions/EventSegment' },
  segmentAny: { oneOf: ['TransportSegment', 'AccommodationSegment', 'EventSegment'].map(d => ({ $ref: '#/definitions/' + d })) },
  trip: schema.properties.trip,
  list: { $ref: '#/definitions/List' },
  listItem: { $ref: '#/definitions/ListItem' },
  phraseGroup: { $ref: '#/definitions/PhraseGroup' },
  phrase: { $ref: '#/definitions/Phrase' },
};

test('the whole-document schema compiles', () => {
  assert.equal(typeof ajv.compile(schema), 'function');
});

test('every subschema the app compiles is compilable', () => {
  for (const [name, body] of Object.entries(SUBSCHEMAS))
    assert.equal(typeof sub(body), 'function', name);
});

test('a valid document passes the whole-document validator', () => {
  const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));
  const validate = ajv.compile(schema);
  assert.ok(validate(example), JSON.stringify(validate.errors, null, 2));
});

test('an off-enum cost status is rejected — the badge XSS payload never validates', () => {
  const validate = sub(SUBSCHEMAS.event);
  const seg = {
    id: 'seg-1', type: 'event', subtype: 'activity', name: 'Louvre', date: '2026-09-18',
    cost: { status: 'paid"><img src=x onerror="steal()">', amount: 20 },
  };
  assert.equal(validate(seg), false);
});

test('a segment is judged by its own type, not the oneOf (issue #76)', () => {
  // A half-filled event must not come back demanding transport's fields.
  const validate = sub(SUBSCHEMAS.event);
  validate({ id: 'seg-1', type: 'event', subtype: 'activity', date: '2026-09-18', cost: { status: 'free' } });
  const messages = (validate.errors || []).map(e => e.message).join(' ');
  assert.match(messages, /required property 'name'/);
  assert.doesNotMatch(messages, /departs|duration_min/);
});
