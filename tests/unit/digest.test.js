import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itineraryDigest, segmentLine, costLine } from '../../src/lib/digest.js';

const paris = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));

test('digest of the paris_weekend fixture: trip header + one line per segment', () => {
  const d = itineraryDigest(paris);
  const lines = d.split('\n');
  assert.equal(lines.length, 1 + paris.segments.length);
  assert.equal(lines[0], 'trip: Paris Weekend (example) | Judy Jetson, George Jetson | 2026-09-18 → 2026-09-20 | GBP');
  assert.equal(lines[1], "seg-1 | transport/train | 2026-09-18 16:31 London St Pancras Int'l → 19:49 Paris Gare du Nord | Eurostar ref AB1234 | paid GBP 156");
  assert.equal(lines[2], 'seg-2 | accommodation | 2026-09-18, 2 nights | Cosy Studio near Sacré-Cœur ref XY9876Z | paid GBP 174.48 | +notes | +warnings(1)');
  assert.equal(lines[3], 'seg-3 | event/gig | 2026-09-19 20:30 | Jazz at Le Petit Exemple @ Le Petit Exemple, Montmartre | pending EUR 40 due 2026-09-16');
});

test('digest is a fraction of the raw itinerary size', () => {
  const raw = JSON.stringify(paris).length;
  const d = itineraryDigest(paris).length;
  assert.ok(d < raw * 0.4, `digest ${d} vs raw ${raw}`);
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

test('event artist and untimed events render compactly', () => {
  const s = { id: 'seg-4', type: 'event', subtype: 'gig', name: 'Cogswell Sonics', artist: 'The Cogs', venue: 'La Cigale', date: '2026-09-19' };
  assert.equal(segmentLine(s, 'GBP'), 'seg-4 | event/gig | 2026-09-19 | Cogswell Sonics — The Cogs @ La Cigale');
});
