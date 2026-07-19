import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segDate, segTime, sortSegments } from '../../src/lib/sort.js';

const train = { id: 't', type: 'transport', date: '2026-09-18', departs: { place: 'A', time: '16:31' }, arrives: { place: 'B', time: '19:49' } };
const stay = { id: 'a', type: 'accommodation', checkin: { date: '2026-09-18', from: '13:00' }, checkout: { date: '2026-09-19', by: '11:00' } };
const gig = { id: 'e', type: 'event', date: '2026-09-18', time: '20:30' };

test('segDate uses check-in date for accommodation, date otherwise', () => {
  assert.equal(segDate(stay), '2026-09-18');
  assert.equal(segDate(train), '2026-09-18');
});

test('segTime pins accommodation to end of day and defaults events to midday', () => {
  assert.equal(segTime(train), '16:31');
  assert.equal(segTime(stay), '23:59');
  assert.equal(segTime(gig), '20:30');
  assert.equal(segTime({ type: 'event', date: '2026-09-18' }), '12:00');
});

test('accommodation sorts after same-day transport even when check-in opens earlier', () => {
  const sorted = sortSegments([stay, train]);
  assert.deepEqual(sorted.map(s => s.id), ['t', 'a']);
});

test('sortSegments orders by date then time and does not mutate its input', () => {
  const later = { ...train, id: 't2', date: '2026-09-19' };
  const input = [later, gig, train];
  const sorted = sortSegments(input);
  assert.deepEqual(sorted.map(s => s.id), ['t', 'e', 't2']);
  assert.deepEqual(input.map(s => s.id), ['t2', 'e', 't']);
});
