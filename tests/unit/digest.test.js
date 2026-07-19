import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itineraryDigest, segmentLine, costLine, listLines, listItemLine } from '../../src/lib/digest.js';

const paris = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));

test('digest of the paris_weekend fixture: trip header + one line per segment', () => {
  const d = itineraryDigest(paris);
  const lines = d.split('\n');
  // header + segments + lists section ("lists:" + a header and item line per list/item)
  const listCount = paris.lists.length + paris.lists.reduce((n, l) => n + l.items.length, 0);
  assert.equal(lines.length, 1 + paris.segments.length + 1 + listCount);
  assert.equal(lines[0], 'trip: Paris Weekend (example) | Judy Jetson, George Jetson | 2026-09-18 → 2026-09-20 | GBP');
  assert.equal(lines[1], "seg-1 | transport/train | 2026-09-18 16:31 London St Pancras Int'l → 19:49 Paris Gare du Nord | Eurostar ref AB1234 | paid GBP 156");
  assert.equal(lines[2], 'seg-2 | accommodation | 2026-09-18, 2 nights | Cosy Studio near Sacré-Cœur ref XY9876Z | paid GBP 174.48 | +notes | +warnings(1)');
  assert.equal(lines[3], 'seg-3 | event/gig | 2026-09-19 20:30 | Jazz at Le Petit Exemple @ Le Petit Exemple, Montmartre | pending EUR 40 due 2026-09-16');
});

test('lists appear in the digest with progress counts and per-item lines (issue #40)', () => {
  const lines = itineraryDigest(paris).split('\n');
  const at = lines.indexOf('lists:');
  assert.ok(at > 0, 'lists section present');
  assert.equal(lines[at + 1], 'list-food | Foods to try | food | 1/3 done');
  assert.equal(lines[at + 2], '  li-1 | [x] Custard tart / Flan pâtissier +note');
  assert.equal(lines[at + 4], '  li-3 | [ ] Jazz-club cocktail → seg-3 +note');
});

test('listItemLine flags omitted detail (note, url) and the promoted segment', () => {
  assert.equal(listItemLine({ id: 'li-9', name: 'Tapas crawl', url: 'https://example.com', segment_id: 'seg-2' }),
    '  li-9 | [ ] Tapas crawl → seg-2 +url');
});

test('documents without lists produce no lists section', () => {
  assert.deepEqual(listLines({ segments: [] }), []);
  assert.deepEqual(listLines({ lists: [] }), []);
});

test('digest is a fraction of the raw itinerary size', () => {
  // List items are deliberately near-fully inlined (only note/url bodies are
  // flagged), so the ratio is looser than the segment-only 0.4 used to be.
  const raw = JSON.stringify(paris).length;
  const d = itineraryDigest(paris).length;
  assert.ok(d < raw * 0.5, `digest ${d} vs raw ${raw}`);
});

test('segments are ordered chronologically regardless of input order', () => {
  const shuffled = { ...paris, segments: [...paris.segments].reverse() };
  assert.equal(itineraryDigest(shuffled), itineraryDigest(paris));
});

test('flags surface detail the line omits: proposal, notes, warnings', () => {
  const s = {
    id: 'seg-9', type: 'event', subtype: 'walk', name: 'Canal loop', date: '2026-09-19',
    proposal: { status: 'suggested', proposed_by: 'Judy Jetson' },
    notes: 'bring water', warnings: ['steep start', 'no shade'],
    cost: { status: 'free' },
  };
  assert.equal(segmentLine(s, 'GBP'),
    'seg-9 | event/walk | 2026-09-19 | Canal loop | free GBP 0 | proposal:suggested | +notes | +warnings(2)');
});

test('costLine covers not_booked, included_in and missing cost', () => {
  assert.equal(costLine({ cost: { status: 'not_booked' } }, 'GBP'), 'not_booked');
  assert.equal(costLine({ cost: { included_in: 'seg-1' } }, 'GBP'), 'cost included in seg-1');
  assert.equal(costLine({}, 'GBP'), null);
});

test('transport without ref/class stays clean and pass-covered legs show the pass (issue #11)', () => {
  const s = {
    id: 'seg-7', type: 'transport', mode: 'bus', operator: 'PostBus', date: '2026-09-20',
    departs: { place: 'Spaceport Square', time: '09:15' }, arrives: { place: 'Orbit Lakes', time: '09:55' },
    duration_min: 40, pass_id: 'IR01', cost: { status: 'free' },
  };
  assert.equal(segmentLine(s, 'GBP'),
    'seg-7 | transport/bus | 2026-09-20 09:15 Spaceport Square → 09:55 Orbit Lakes | PostBus pass IR01 | free GBP 0');
});

test('untimed events render compactly', () => {
  const s = { id: 'seg-4', type: 'event', subtype: 'gig', name: 'Cogswell Sonics', venue: 'La Cigale', date: '2026-09-19' };
  assert.equal(segmentLine(s, 'GBP'), 'seg-4 | event/gig | 2026-09-19 | Cogswell Sonics @ La Cigale');
});

test('multi-day and all-day events surface their span in the digest (issue #13)', () => {
  const fest = { id: 'seg-5', type: 'event', subtype: 'festival', name: 'Orbit Fest', date: '2026-09-19', end_date: '2026-09-22' };
  assert.equal(segmentLine(fest, 'GBP'), 'seg-5 | event/festival | 2026-09-19 → 2026-09-22 | Orbit Fest');
  const timed = { id: 'seg-6', type: 'event', subtype: 'gig', name: 'Late Show', date: '2026-09-19', time: '21:00', end_time: '23:30' };
  assert.equal(segmentLine(timed, 'GBP'), 'seg-6 | event/gig | 2026-09-19 21:00 → 23:30 | Late Show');
  const wander = { id: 'seg-7', type: 'event', subtype: 'activity', name: 'Old town wander', date: '2026-09-20', all_day: true };
  assert.equal(segmentLine(wander, 'GBP'), 'seg-7 | event/activity | 2026-09-20 all-day | Old town wander');
});
