// Starting points for hand-added segments and from-scratch itineraries
// (issue #76). The contract that matters is what a draft leaves OUT: every
// required piece of content stays absent so the modal's schema validation
// refuses an untouched draft instead of saving a blank segment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newSegmentDraft, newTripDraft, blankItinerary, SEGMENT_KINDS, DEFAULT_CURRENCY } from '../../src/lib/drafts.js';
import { DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN, DEFAULT_CHECKIN_FROM, DEFAULT_CHECKOUT_BY } from '../../src/lib/dates.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/holiday_itinerary_schema.json', import.meta.url), 'utf8'));

const doc = {
  trip: { name: 'Trip', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-21', currency_primary: 'GBP' },
  segments: [{ id: 'seg-1', type: 'event', subtype: 'gig', name: 'Gig', date: '2026-09-19', cost: { status: 'free' } }],
};

const defFor = { transport: 'TransportSegment', accommodation: 'AccommodationSegment', event: 'EventSegment' };

/** Required properties of a definition that a draft has not filled in. */
function missingRequired(type, draft) {
  return (schema.definitions[defFor[type]].required || []).filter(k => draft[k] === undefined);
}

test('every addable kind has a draft, keyed by a real segment type', () => {
  for (const kind of SEGMENT_KINDS) {
    assert.ok(defFor[kind.type], `${kind.type} is not a segment type`);
    assert.equal(newSegmentDraft(kind.type, doc).type, kind.type);
    assert.ok(kind.label, `${kind.type} has no label`);
  }
  assert.equal(newSegmentDraft('nonsense', doc), null);
});

test('drafts fill in defaults and nothing that has to be said by hand', () => {
  const transport = newSegmentDraft('transport', doc);
  assert.equal(transport.date, '2026-09-18');
  assert.equal(transport.departs.place, undefined);
  // The schema's required content is exactly what the user has to supply.
  assert.deepEqual(missingRequired('transport', transport), ['operator']);

  const stay = newSegmentDraft('accommodation', doc);
  assert.deepEqual(stay.checkin, { date: '2026-09-18', from: DEFAULT_CHECKIN_FROM });
  assert.deepEqual(stay.checkout, { date: '2026-09-21', by: DEFAULT_CHECKOUT_BY });
  assert.deepEqual(missingRequired('accommodation', stay), ['name', 'address']);

  const event = newSegmentDraft('event', doc);
  assert.equal(event.time, DEFAULT_EVENT_TIME);
  assert.equal(event.duration_min, DEFAULT_EVENT_DURATION_MIN);
  assert.deepEqual(missingRequired('event', event), ['name']);

  // Nothing is booked at the moment it is drafted.
  for (const d of [transport, stay, event]) assert.deepEqual(d.cost, { status: 'not_booked' });
});

test('draft ids are fresh and unique against the document', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newSegmentDraft('event', { ...doc, segments: [...doc.segments, ...[...ids].map(x => ({ id: x }))] }).id;
    assert.ok(id.startsWith('seg-'));
    assert.ok(!ids.has(id), 'reused an id already in the document');
    ids.add(id);
  }
});

test('a draft survives a document with no segments and no trip dates', () => {
  const bare = newSegmentDraft('event', { trip: {}, segments: [] });
  assert.equal(bare.date, undefined);
  assert.ok(bare.id.startsWith('seg-'));
  assert.ok(newSegmentDraft('transport', undefined).id.startsWith('seg-'));
});

test('a from-scratch trip opens on today and still needs a name and travellers', () => {
  const trip = newTripDraft('2026-07-25');
  assert.equal(trip.start, '2026-07-25');
  assert.equal(trip.end, '2026-07-25');
  assert.equal(trip.currency_primary, DEFAULT_CURRENCY);
  assert.match(trip.currency_primary, /^[A-Z]{3}$/);
  assert.deepEqual(schema.properties.trip.required.filter(k => trip[k] === undefined), ['name', 'travellers']);
});

test('a blank itinerary is a valid empty document shape', () => {
  const doc0 = blankItinerary(newTripDraft('2026-07-25'));
  assert.deepEqual(doc0.segments, []);
  assert.deepEqual(doc0.lists, []);
  assert.deepEqual(doc0.phrases, []);
  // An itinerary being built up starts with nothing planned, so the schema
  // must not insist on a first segment.
  assert.equal(schema.properties.segments.minItems, undefined);
});
