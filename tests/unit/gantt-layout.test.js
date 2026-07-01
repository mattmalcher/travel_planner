import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMs } from '../../src/lib/dates.js';
import { linearScale, compactPoints, compactScale, coverageGaps, PX_PER_MIN, SLOT_PX } from '../../src/lib/gantt-layout.js';

const trip = { start: '2026-09-18', end: '2026-09-19' };
const startMs = toMs(trip.start, '00:00');
const endMs = new Date(trip.end + 'T23:59:59').getTime();

test('linearScale maps minutes to pixels from the trip start', () => {
  const s = linearScale(startMs, endMs);
  assert.equal(s.toPx(startMs), 0);
  assert.equal(s.toPx(startMs + 60 * 60000), 60 * PX_PER_MIN);
  assert.ok(Math.abs(s.totalPx - 2 * 1440 * PX_PER_MIN) < 1);
});

test('compactPoints includes trip bounds, midnights and segment boundaries', () => {
  const seg = { type: 'transport', date: '2026-09-18', departs: { time: '16:31' }, duration_min: 138 };
  const pts = compactPoints(trip, [seg]);
  assert.ok(pts.includes(startMs));
  assert.ok(pts.includes(endMs));
  assert.ok(pts.includes(toMs('2026-09-19', '00:00')));
  assert.ok(pts.includes(toMs('2026-09-18', '16:31')));
  assert.ok(pts.includes(toMs('2026-09-18', '16:31') + 138 * 60000));
  assert.deepEqual(pts, [...pts].sort((a, b) => a - b), 'points are sorted');
});

test('compactScale places known instants a slot apart and interpolates between them', () => {
  const pts = [0, 100, 200];
  const s = compactScale(pts);
  assert.equal(s.totalPx, 2 * SLOT_PX);
  assert.equal(s.toPx(0), 0);
  assert.equal(s.toPx(100), SLOT_PX);
  assert.equal(s.toPx(150), SLOT_PX * 1.5);
  assert.equal(s.toPx(999), 2 * SLOT_PX, 'clamps past the end');
});

test('coverageGaps reports uncovered spans before, between and after stays', () => {
  const gaps = coverageGaps([
    { startMs: 100, endMs: 200 },
    { startMs: 300, endMs: 400 },
  ], 0, 500);
  assert.deepEqual(gaps, [
    { startMs: 0, endMs: 100 },
    { startMs: 200, endMs: 300 },
    { startMs: 400, endMs: 500 },
  ]);
});

test('coverageGaps handles overlapping stays and full coverage', () => {
  assert.deepEqual(coverageGaps([
    { startMs: 0, endMs: 300 },
    { startMs: 200, endMs: 500 },
  ], 0, 500), []);
  assert.deepEqual(coverageGaps([], 0, 500), [{ startMs: 0, endMs: 500 }]);
});
