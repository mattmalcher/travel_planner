import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDayLong, fmtMinutes, toMs, msToIso } from '../../src/lib/dates.js';

test('fmtDate renders day, short month and year', () => {
  assert.equal(fmtDate('2026-09-18'), '18 Sept 2026');
});

test('fmtDayLong renders weekday, day and long month', () => {
  assert.equal(fmtDayLong('2026-09-18'), 'Fri 18 September');
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
