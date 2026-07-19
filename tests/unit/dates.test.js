import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDayLong, fmtDayShort, fmtMinutes, toMs, msToIso, eventInterval, nightsBetween, DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN } from '../../src/lib/dates.js';

test('fmtDate renders day, short month and year', () => {
  assert.equal(fmtDate('2026-09-18'), '18 Sept 2026');
});

test('fmtDayLong renders weekday, day and long month', () => {
  assert.equal(fmtDayLong('2026-09-18'), 'Fri 18 September');
});

test('fmtDayShort renders weekday and day only', () => {
  assert.equal(fmtDayShort('2026-09-18'), 'Fri 18');
});

test('fmtMinutes renders hours and minutes, dropping zero minutes', () => {
  assert.equal(fmtMinutes(138), '2h 18m');
  assert.equal(fmtMinutes(120), '2h');
  assert.equal(fmtMinutes(0), '0h');
});

test('toMs defaults a missing time to midnight', () => {
  assert.equal(toMs('2026-09-18'), toMs('2026-09-18', '00:00'));
  assert.equal(toMs('2026-09-18', '01:30') - toMs('2026-09-18'), 90 * 60000);
});

test('msToIso is the inverse of toMs', () => {
  assert.deepEqual(msToIso(toMs('2026-09-18', '16:31')), { date: '2026-09-18', time: '16:31' });
  // Crossing midnight lands on the next date.
  assert.deepEqual(msToIso(toMs('2026-09-18', '23:30') + 60 * 60000), { date: '2026-09-19', time: '00:30' });
});

// eventInterval (issue #13) — one resolver for end_date/end_time/all_day.

test('eventInterval: timed events use time/duration with the shared defaults', () => {
  const timed = eventInterval({ date: '2026-09-19', time: '20:30', duration_min: 90 });
  assert.deepEqual(timed, { startMs: toMs('2026-09-19', '20:30'), endMs: toMs('2026-09-19', '22:00') });
  const defaulted = eventInterval({ date: '2026-09-19' });
  assert.equal(defaulted.startMs, toMs('2026-09-19', DEFAULT_EVENT_TIME));
  assert.equal(defaulted.endMs, defaulted.startMs + DEFAULT_EVENT_DURATION_MIN * 60000);
});

test('eventInterval: end_time beats duration_min and can cross into end_date', () => {
  assert.deepEqual(eventInterval({ date: '2026-09-19', time: '21:00', end_time: '23:30', duration_min: 60 }),
    { startMs: toMs('2026-09-19', '21:00'), endMs: toMs('2026-09-19', '23:30') });
  assert.deepEqual(eventInterval({ date: '2026-09-19', time: '18:00', end_date: '2026-09-22', end_time: '14:00' }),
    { startMs: toMs('2026-09-19', '18:00'), endMs: toMs('2026-09-22', '14:00') });
});

test('eventInterval: multi-day events span to the end of end_date when untimed', () => {
  // A timed start with only an end_date runs to the end of the last day.
  assert.deepEqual(eventInterval({ date: '2026-09-19', time: '18:00', end_date: '2026-09-22' }),
    { startMs: toMs('2026-09-19', '18:00'), endMs: toMs('2026-09-22', '23:59') });
  // No start time at all makes the whole range a banner-style span.
  assert.deepEqual(eventInterval({ date: '2026-09-19', end_date: '2026-09-22' }),
    { startMs: toMs('2026-09-19', '00:00'), endMs: toMs('2026-09-22', '23:59') });
});

test('eventInterval: all_day spans the full day(s) regardless of other fields', () => {
  assert.deepEqual(eventInterval({ date: '2026-09-19', all_day: true }),
    { startMs: toMs('2026-09-19', '00:00'), endMs: toMs('2026-09-19', '23:59') });
  assert.deepEqual(eventInterval({ date: '2026-09-19', end_date: '2026-09-20', all_day: true, time: '10:00' }),
    { startMs: toMs('2026-09-19', '00:00'), endMs: toMs('2026-09-20', '23:59') });
});

test('eventInterval clamps a backwards end to one minute after the start', () => {
  const i = eventInterval({ date: '2026-09-19', time: '22:00', end_time: '21:00' });
  assert.equal(i.endMs, i.startMs + 60000);
});

test('nightsBetween derives nights from checkin/checkout dates (schema 3.0.0 drops the stored field)', () => {
  assert.equal(nightsBetween('2026-09-18', '2026-09-20'), 2);
  assert.equal(nightsBetween('2026-09-18', '2026-09-19'), 1);
  // Spans a DST change (Europe: last Sunday of October) without drifting.
  assert.equal(nightsBetween('2026-10-24', '2026-10-26'), 2);
  // A backwards or same-day range never goes negative.
  assert.equal(nightsBetween('2026-09-18', '2026-09-18'), 0);
  assert.equal(nightsBetween('2026-09-20', '2026-09-18'), 0);
});
