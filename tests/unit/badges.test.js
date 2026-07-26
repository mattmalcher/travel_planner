// Status badges (views/badges.js). The badge text and CSS class both come
// from a document field, so this is one of the places issue #9's "escape
// everything from an itinerary file" rule has to hold — the schema's enum is
// not a guarantee here, since ajv is advisory (it degrades to ok when esm.sh
// is unreachable, and the upload warning has a "Load anyway" escape hatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badge, costBadge, proposalBadge, segIcon } from '../../src/views/badges.js';
import { costInfo } from '../../src/lib/cost.js';

const BREAKOUT = 'paid"><img src=x onerror="steal()">';

test('a known status renders its label', () => {
  assert.equal(badge('paid', 'Paid'), '<span class="hbadge paid">Paid</span>');
});

test('an unlabelled status falls back to the status itself', () => {
  assert.equal(badge('weird'), '<span class="hbadge weird">weird</span>');
});

test('a hostile status cannot break out of the class attribute', () => {
  const html = badge(BREAKOUT, 'Paid');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&quot;&gt;&lt;img'), html);
});

test('a hostile status cannot break out of the badge text', () => {
  const html = badge(BREAKOUT);
  assert.equal(html.match(/</g).length, 2); // only <span … </span
  assert.ok(!html.includes('<img'), html);
});

test('a hostile cost status is escaped through costBadge', () => {
  const html = costBadge(costInfo({ cost: { status: BREAKOUT, amount: 20 } }, 'GBP'));
  assert.ok(!html.includes('<img'), html);
});

test('a hostile proposal status is escaped through proposalBadge', () => {
  const html = proposalBadge({ proposal: { status: '"><script>x()</script>' } });
  assert.ok(!html.includes('<script'), html);
});

test('costBadge still names the states the views rely on', () => {
  assert.match(costBadge({ t: 'inc' }), />Included</);
  assert.match(costBadge({ t: 'nb' }), />Not booked</);
  assert.match(costBadge({ t: 'amt', st: 'partial' }), />Part paid</);
  assert.equal(costBadge(null), '');
});

test('segIcon falls back rather than emitting an empty class', () => {
  assert.equal(segIcon({ type: 'transport', mode: 'train' }), 'ti-train');
  assert.equal(segIcon({ type: 'transport', mode: 'hovercraft' }), 'ti-route');
  assert.equal(segIcon({ type: 'event' }), 'ti-calendar-event');
});
