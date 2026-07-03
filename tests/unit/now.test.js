import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuringTrip, currentDayChip } from '../../src/lib/now.js';
import { toMs } from '../../src/lib/dates.js';

const trip = { start: '2026-09-18', end: '2026-09-28' };

test('isDuringTrip covers the whole trip inclusive of both end days', () => {
  assert.equal(isDuringTrip(trip, toMs('2026-09-18', '00:00')), true);
  assert.equal(isDuringTrip(trip, toMs('2026-09-22', '12:00')), true);
  assert.equal(isDuringTrip(trip, toMs('2026-09-28', '23:59')), true);
});

test('isDuringTrip rejects times before and after the trip', () => {
  assert.equal(isDuringTrip(trip, toMs('2026-09-17', '23:59')), false);
  assert.equal(isDuringTrip(trip, toMs('2026-09-29', '00:00')), false);
  assert.equal(isDuringTrip(trip, toMs('2027-01-01', '10:00')), false);
});

test('currentDayChip returns the exact day when it has segments', () => {
  const days = ['2026-09-18', '2026-09-20', '2026-09-24'];
  assert.equal(currentDayChip(days, trip, toMs('2026-09-20', '09:00')), '2026-09-20');
});

test('currentDayChip falls back to the latest earlier day on a rest day', () => {
  // Mid-stay days without segments should land on the day the stay started.
  const days = ['2026-09-18', '2026-09-20', '2026-09-24'];
  assert.equal(currentDayChip(days, trip, toMs('2026-09-22', '09:00')), '2026-09-20');
});

test('currentDayChip is null outside the trip or before the first listed day', () => {
  const days = ['2026-09-20', '2026-09-24'];
  assert.equal(currentDayChip(days, trip, toMs('2026-09-10', '09:00')), null, 'before the trip');
  assert.equal(currentDayChip(days, trip, toMs('2026-10-02', '09:00')), null, 'after the trip');
  assert.equal(currentDayChip(days, trip, toMs('2026-09-18', '09:00')), null, 'in-trip but before the first day with segments');
});
