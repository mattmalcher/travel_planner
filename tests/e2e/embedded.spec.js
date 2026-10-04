// The embedded viewer (dist/embedded_viewer.html): the page a chat host shows,
// built from the same source with the ai, library, share, edit and offline
// features switched off (scripts/build.mjs). It is read-only by design —
// changes go through the chat — so these tests pin that it has no way to
// write, keeps nothing in the browser, and still renders every view from the
// document its host hands it.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const example = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));
const VIEWS = ['list', 'map', 'gantt', 'lists', 'phrases', 'budget'];

/* A sandboxed frame without allow-same-origin throws on any storage access,
   so the page must never touch it: make every touch throw, and count it. */
async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    globalThis.__storageTouches = 0;
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { globalThis.__storageTouches++; throw new DOMException('The document is sandboxed', 'SecurityError'); },
      });
    }
  });
  await page.goto('/embedded_viewer.html');
  return errors;
}

const show = (page, doc) => page.evaluate(d => globalThis.HolidayViewer.show(d), doc);

test('waits for its host, then renders every view from the document it is handed', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByText('Loading the trip…')).toBeVisible();
  await expect(page.locator('#happ')).toBeHidden();
  await show(page, example);
  await expect(page.locator('#htname')).toHaveText(/Paris Weekend \(example\)/);
  await expect(page.locator('#hvlist')).toContainText('Jazz at Le Petit Exemple');
  for (const v of VIEWS) {
    await page.locator(`#htab-${v}`).click();
    await expect(page.locator(`#hv${v}`)).toHaveClass(/\bon\b/);
  }
  await page.locator('#htab-map').click();
  await expect(page.locator('#hmap .leaflet-marker-icon').first()).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => globalThis.__storageTouches)).toBe(0);
});

test('has no controls that write, and every inline handler it renders exists', async ({ page }) => {
  const errors = await open(page);
  await show(page, example);
  for (const v of VIEWS) await page.locator(`#htab-${v}`).click();
  // Nothing to edit, add, delete, schedule, tick off, share, switch or chat with.
  for (const sel of ['.hedit-btn', '.hadd', '.hli-add', '#hedit-modal', '#hedit-toggle', '#hchat', '#hset-modal',
    '#hlib-modal', '#hshare-modal', '#hroom-bar', '#hstorewarn', '#hfile', '#hswbadge']) {
    await expect(page.locator(sel), sel).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /schedule$/i })).toHaveCount(0);
  const boxes = page.locator('#hvlists input[type=checkbox]');
  expect(await boxes.count()).toBeGreaterThan(0);
  for (const box of await boxes.all()) await expect(box).toBeDisabled();
  // Every h* handler named by an inline attribute is registered (AGENTS.md).
  const missing = await page.evaluate(() => {
    const names = new Set();
    for (const el of globalThis.document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (a.name.startsWith('on')) for (const m of a.value.matchAll(/\b(h[A-Za-z]+)\s*\(/g)) names.add(m[1]);
      }
    }
    return [...names].filter(n => typeof globalThis[n] !== 'function');
  });
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('a newer version redraws in place and keeps the open tab', async ({ page }) => {
  const errors = await open(page);
  await show(page, example);
  await page.locator('#htab-gantt').click();
  const newer = structuredClone(example);
  newer.trip.name = 'Paris Weekend (renamed)';
  newer.segments.find(s => s.type === 'event').name = 'Jazz at Le Second Exemple';
  await show(page, newer);
  await expect(page.locator('#htname')).toHaveText(/Paris Weekend \(renamed\)/);
  await expect(page.locator('#hvgantt')).toHaveClass(/\bon\b/);
  await expect(page.locator('#hvgantt')).toContainText('Jazz at Le Second Exemple');
  // With the map open, a new version rebuilds it rather than leaving it stale.
  await page.locator('#htab-map').click();
  await expect(page.locator('#hmap .leaflet-marker-icon').first()).toBeVisible();
  await show(page, example);
  await expect(page.locator('#hmap .leaflet-marker-icon').first()).toBeVisible();
  await expect(page.locator('#hmaplist')).toContainText('Jazz at Le Petit Exemple');
  expect(errors).toEqual([]);
});

test('calls no service of its own: no share store, no AI, no service worker', async ({ page }) => {
  const hosts = new Set();
  page.on('request', r => hosts.add(new URL(r.url()).host));
  await open(page);
  await show(page, example);
  for (const v of VIEWS) await page.locator(`#htab-${v}`).click();
  await page.locator('#htab-map').click();
  await expect(page.locator('#hmap .leaflet-marker-icon').first()).toBeVisible();
  const own = new URL(page.url()).host;
  // Leaflet from its pinned CDN and the map's tiles are all it fetches.
  const others = [...hosts].filter(h => h !== own && h !== 'cdn.jsdelivr.net' && !h.endsWith('tile.openstreetmap.org'));
  expect(others).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length))).toBe(0);
});
