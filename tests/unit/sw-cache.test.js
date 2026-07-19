import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, PRECACHE_CRITICAL, PRECACHE_OPTIONAL } from '../../src/lib/sw-cache.js';

// Project-pages deploy: the scope is a subdirectory, not the origin root.
const SCOPE = 'https://jetson.github.io/travel_planner/';

test('shell files get stale-while-revalidate, with and without cache-busting queries', () => {
  assert.equal(classify(SCOPE, SCOPE), 'shell'); // the scope root itself
  assert.equal(classify(SCOPE + 'holiday_itinerary_viewer.html', SCOPE), 'shell');
  assert.equal(classify(SCOPE + 'holiday_itinerary_viewer.html?v=abc1234', SCOPE), 'shell');
  assert.equal(classify(SCOPE + 'index.html', SCOPE), 'shell');
  assert.equal(classify(SCOPE + 'holiday_itinerary_schema.json', SCOPE), 'shell');
  assert.equal(classify(SCOPE + 'manifest.webmanifest', SCOPE), 'shell');
});

test('every precache path classifies as shell', () => {
  for (const p of [...PRECACHE_CRITICAL, ...PRECACHE_OPTIONAL]) {
    assert.equal(classify(new URL(p, SCOPE).href, SCOPE), 'shell', p);
  }
});

test('pinned third-party assets are cache-first', () => {
  assert.equal(classify('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', SCOPE), 'cdn');
  assert.equal(classify('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.0/dist/tabler-icons.min.css', SCOPE), 'cdn');
  assert.equal(classify('https://esm.sh/ajv@8?bundle', SCOPE), 'cdn');
});

test('PR previews on the production origin are never served the shell', () => {
  assert.equal(classify(SCOPE + 'previews/pr-45/holiday_itinerary_viewer.html', SCOPE), 'bypass');
  assert.equal(classify(SCOPE + 'previews/pr-45/holiday_itinerary_schema.json', SCOPE), 'bypass');
});

test('other origins go straight to the network', () => {
  assert.equal(classify('https://tile.openstreetmap.org/3/4/2.png', SCOPE), 'bypass');
  assert.equal(classify('https://openrouter.ai/api/v1/chat/completions', SCOPE), 'bypass');
});

test('unknown same-origin paths and paths outside the scope bypass', () => {
  assert.equal(classify(SCOPE + 'something-else.json', SCOPE), 'bypass');
  assert.equal(classify('https://jetson.github.io/other_project/index.html', SCOPE), 'bypass');
});

test('junk input never throws', () => {
  assert.equal(classify('not a url', SCOPE), 'bypass');
  assert.equal(classify('', ''), 'bypass');
});
