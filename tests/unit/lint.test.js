import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintItinerary } from '../../src/lib/lint.js';

const doc = (segments, travellers = ['Judy Jetson', 'George Jetson']) => ({
  trip: { name: 'Test', travellers, start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP' },
  segments,
});

const seg = (over = {}) => ({
  id: 'seg-1', type: 'event', subtype: 'gig', name: 'Show', date: '2026-09-19',
  cost: { amount: 40, currency: 'GBP', status: 'paid', paid_by: 'Judy Jetson' },
  ...over,
});

test('clean document produces no warnings', () => {
  assert.deepEqual(lintItinerary(doc([seg()])), []);
});

test('tolerates junk input and missing pieces', () => {
  assert.deepEqual(lintItinerary(null), []);
  assert.deepEqual(lintItinerary({}), []);
  assert.deepEqual(lintItinerary({ segments: [null, {}] }), []);
});

test('flags duplicate segment ids once per duplicate', () => {
  const w = lintItinerary(doc([seg(), seg({ name: 'Other' }), seg({ name: 'Third' })]));
  assert.equal(w.filter(m => m.includes('duplicate segment id "seg-1"')).length, 2);
});

test('flags dangling and self-referencing parent_event_id', () => {
  const [dangling] = lintItinerary(doc([seg({ parent_event_id: 'seg-9' })]));
  assert.match(dangling, /parent_event_id "seg-9" does not match/);
  const [self] = lintItinerary(doc([seg({ parent_event_id: 'seg-1' })]));
  assert.match(self, /parent_event_id refers to itself/);
  assert.deepEqual(lintItinerary(doc([seg(), seg({ id: 'seg-2', parent_event_id: 'seg-1' })])), []);
});

test('flags dangling and self-referencing cost.included_in', () => {
  const [dangling] = lintItinerary(doc([seg({ cost: { status: 'included', included_in: 'seg-9' } })]));
  assert.match(dangling, /cost\.included_in "seg-9" does not match/);
  const [self] = lintItinerary(doc([seg({ cost: { status: 'included', included_in: 'seg-1' } })]));
  assert.match(self, /cost\.included_in refers to itself/);
});

test('flags names that are not in trip.travellers', () => {
  const w = lintItinerary(doc([seg({
    cost: { amount: 40, status: 'paid', paid_by: 'Jody Jetson', payments: [{ amount: 40, status: 'paid', paid_by: 'Geo Jetson' }] },
    seats: [{ traveller: 'Elroy Jetson', coach: 1, seat: 1 }],
    proposal: { status: 'suggested', proposed_by: 'Rosie' },
  })]));
  assert.equal(w.length, 4);
  assert.match(w[0], /cost\.paid_by "Jody Jetson" is not in trip\.travellers/);
  assert.match(w[1], /payments\[0\]\.paid_by "Geo Jetson"/);
  assert.match(w[2], /seats\[0\]\.traveller "Elroy Jetson"/);
  assert.match(w[3], /proposal\.proposed_by "Rosie"/);
});

test('skips name checks when the trip lists no travellers', () => {
  assert.deepEqual(lintItinerary(doc([seg()], [])), []);
});

test('flags payments that do not sum to the declared amount', () => {
  const bad = seg({ cost: { amount: 100, status: 'pending', payments: [{ amount: 40, status: 'paid' }, { amount: 50, status: 'pending' }] } });
  const [w] = lintItinerary(doc([bad]));
  assert.match(w, /payments sum to 90\.00 but cost\.amount is 100\.00/);
  // Exact (within rounding tolerance) sums pass — 0.1 + 0.2 style float noise included.
  const ok = seg({ cost: { amount: 0.3, status: 'pending', payments: [{ amount: 0.1, status: 'paid' }, { amount: 0.2, status: 'pending' }] } });
  assert.deepEqual(lintItinerary(doc([ok])), []);
});

test('ignores payment sums when there is no declared amount or no payments', () => {
  assert.deepEqual(lintItinerary(doc([seg({ cost: { status: 'pending', payments: [{ amount: 40, status: 'paid' }] } })])), []);
  assert.deepEqual(lintItinerary(doc([seg({ cost: { amount: 40, status: 'pending', payments: [] } })])), []);
});

test('flags dangling pass_id and duplicate/misattributed trip passes (issue #11)', () => {
  const withPasses = (passes, segs) => ({
    trip: { name: 'Test', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP', passes },
    segments: segs,
  });
  const leg = (over = {}) => ({
    id: 'seg-1', type: 'transport', mode: 'train', operator: 'SBB', date: '2026-09-19',
    departs: { place: 'A', time: '10:00' }, arrives: { place: 'B', time: '11:00' },
    duration_min: 60, cost: { status: 'free' }, ...over,
  });
  // A leg referencing a defined pass is clean.
  assert.deepEqual(lintItinerary(withPasses(
    [{ id: 'IR01', name: 'Interrail Global Pass', traveller: 'Judy Jetson' }],
    [leg({ pass_id: 'IR01' })])), []);
  // Dangling pass_id.
  const [dangling] = lintItinerary(withPasses([{ id: 'IR01', name: 'Interrail' }], [leg({ pass_id: 'IR99' })]));
  assert.match(dangling, /pass_id "IR99" does not match any pass in trip\.passes/);
  // pass_id with no passes at all is also dangling.
  const [none] = lintItinerary(doc([leg({ pass_id: 'IR01' })]));
  assert.match(none, /pass_id "IR01" does not match/);
  // Duplicate pass ids and a pass holder who isn't a traveller.
  const w = lintItinerary(withPasses(
    [{ id: 'IR01', name: 'Pass A' }, { id: 'IR01', name: 'Pass B', traveller: 'Rosie' }],
    [leg()]));
  assert.equal(w.length, 2);
  assert.match(w[0], /duplicate pass id "IR01" in trip\.passes/);
  assert.match(w[1], /trip\.passes\[1\]\.traveller "Rosie" is not in trip\.travellers/);
});

test('flags accommodation date/checkin.date alias mismatch', () => {
  const acc = {
    id: 'seg-2', type: 'accommodation', name: 'Studio', host: 'Pierre', ref: 'X', address: 'A',
    lat: 0, lng: 0, checkin: { date: '2026-09-18' }, checkout: { date: '2026-09-20' },
    guests: 2, nights: 2, self_checkin: true, cost: { status: 'paid' }, date: '2026-09-19',
  };
  const [w] = lintItinerary(doc([acc]));
  assert.match(w, /date "2026-09-19" does not match checkin\.date "2026-09-18"/);
});
