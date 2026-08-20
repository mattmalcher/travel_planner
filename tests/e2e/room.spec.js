// Live sharing (issue #124): a share link that stays current, and an edit link
// that lets someone else change the trip. The key derivation, the record and
// the pull rules are unit-tested (room-keys, room, share-worker); what matters
// here is the browser half — that the sheet produces the right *grade* of link,
// that the pill tells the truth about what has not been sent, that an incoming
// version lands silently only when it can, and that stopping really stops.
//
// Hermetic like the other specs: the share store is a Map behind page.route
// rather than the real Worker, and it enforces the token so that "a viewer
// cannot write" is actually exercised rather than assumed.
import { test, expect } from '@playwright/test';
import { savedIndex } from './library.js';

const STORE = 'https://travel-planner-share.matmalcher.workers.dev';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-Match, X-Share-Token',
};

async function sha256url(buf) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('base64url');
}

/** One store behind however many pages a test drives. Two browser contexts are
    two devices, and the whole point is that the only thing they share is this. */
const backend = (opts = {}) => ({ blobs: new Map(), seen: [], n: 0, ...opts });

/**
 * Stand in for the Worker, rooms included: PUT claims an empty slot and
 * otherwise checks the token, returns what it replaced, and honours If-Match.
 * `opts.writeFails` makes every write fail, which is the offline / out-of-quota
 * case the app has to fall back from without a dead end.
 */
async function routeStore(page, store = backend()) {
  const { blobs, seen } = store;
  const opts = store;
  await page.route(STORE + '/**', async route => {
    const req = route.request();
    const method = req.method();
    const id = new URL(req.url()).pathname.slice(1);
    const token = req.headers()['x-share-token'];
    seen.push({ method, id, token });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (opts.writeFails && method !== 'GET')
      return route.fulfill({ status: 429, headers: cors, body: '{"error":"quota"}' });

    if (method === 'POST') {
      const key = `snap${++store.n}`;
      blobs.set(key, { bytes: Buffer.from(req.postDataBuffer()), th: null });
      return route.fulfill({
        status: 201, headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key }),
      });
    }
    if (method === 'PUT') {
      if (!token) return route.fulfill({ status: 401, headers: cors, body: '{}' });
      const th = await sha256url(Buffer.from(token, 'utf8'));
      const current = blobs.get(id);
      const body = Buffer.from(req.postDataBuffer());
      if (current) {
        if (current.th !== th) return route.fulfill({ status: 403, headers: cors, body: '{}' });
        const ifMatch = req.headers()['if-match'];
        if (ifMatch && ifMatch !== await sha256url(current.bytes))
          return route.fulfill({ status: 409, headers: cors, body: current.bytes });
        blobs.set(id, { bytes: body, th });
        return route.fulfill({ status: 200, headers: cors, body: current.bytes });
      }
      blobs.set(id, { bytes: body, th });
      return route.fulfill({ status: 201, headers: cors, body: '' });
    }
    if (method === 'DELETE') {
      const current = blobs.get(id);
      if (current && current.th !== await sha256url(Buffer.from(token || '', 'utf8')))
        return route.fulfill({ status: 403, headers: cors, body: '{}' });
      blobs.delete(id);
      return route.fulfill({ status: 204, headers: cors });
    }
    const blob = blobs.get(id);
    if (!blob) return route.fulfill({ status: 404, headers: cors, body: '{"error":"not found"}' });
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      body: blob.bytes,
    });
  });
  return store;
}

const itinerary = (name, over = {}) => ({
  trip: {
    name, travellers: ['Judy Jetson'],
    start: '2026-09-18', end: '2026-09-21', currency_primary: 'GBP',
  },
  segments: [{
    id: 'seg-1', type: 'event', subtype: 'gig', name: `${name} gig`,
    date: '2026-09-19', time: '20:00', cost: { status: 'free' },
  }],
  ...over,
});

const upload = (page, doc) => page.setInputFiles('#hfile', {
  name: 'itinerary.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(doc)),
});

const copied = page => page.evaluate(() => globalThis.__copied || []);

/**
 * Run `action` and return the link it puts on the clipboard. Every one of
 * these paths is async — encrypt, upload, copy — so the wait is the point.
 */
async function linkFrom(page, action) {
  const before = (await copied(page)).length;
  await action();
  await expect.poll(async () => (await copied(page)).length).toBeGreaterThan(before);
  return (await copied(page)).at(-1);
}
const pill = page => page.locator('#hroom-pill');
const sheetButton = (page, label) => page.locator('#hshare-body button', { hasText: label });

/** Open the share sheet from the header. */
async function openSheet(page) {
  await page.locator('#happ button[title="Share this trip"]').click();
  await expect(page.locator('#hshare-modal')).toHaveClass(/on/);
}

/** Put the sheet away without tapping anything in it. Tolerant of a sheet that
    already closed itself — handing a link over does exactly that. */
async function closeSheet(page) {
  const modal = page.locator('#hshare-modal');
  if (await modal.evaluate(el => el.classList.contains('on')))
    await page.locator('#hshare-modal button[onclick="hShareClose()"]').click();
  await expect(modal).not.toHaveClass(/on/);
}

/** The room record the app saved for the open trip. */
const savedRoom = page => page.evaluate(() => {
  const id = localStorage.getItem('hCurrentTrip');
  const raw = id && localStorage.getItem('hShare:' + id);
  return raw ? JSON.parse(raw) : null;
});

test.describe('Live sharing', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      globalThis.__copied = [];
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => (globalThis.__copied.push(t), Promise.resolve()) },
      });
      // A name is already set, so joining a room never stops to ask for one —
      // that prompt has its own test.
      localStorage.setItem('hUpdatedBy', 'Judy');
    });
  });

  test.afterEach(() => {
    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('sharing live gives a view link by default and an edit link when asked', async ({ page }) => {
    await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));

    await openSheet(page);
    // The checkbox is off, so what goes out is the half that cannot write.
    const viewer = await linkFrom(page, () => sheetButton(page, 'Share live').click());
    expect(viewer).toMatch(/#v1=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(pill(page)).toContainText('up to date');

    await openSheet(page);
    await page.locator('#hshare-edit').check();
    const writer = await linkFrom(page, () => sheetButton(page, 'Copy the live link').click());
    expect(writer).toMatch(/#w1=[A-Za-z0-9_-]{43}$/);
    // The point of the short link: ~60 characters whatever the trip weighs.
    expect(writer.split('#')[1].length).toBeLessThan(50);
  });

  test('the status pill is a strip of its own, and only there while shared', async ({ page }) => {
    await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));

    // No room: no strip at all. An empty bordered row above the tabs would read
    // as a rendering fault on every trip that is not shared.
    await expect(page.locator('#hroom-bar')).toBeHidden();

    await openSheet(page);
    await linkFrom(page, () => sheetButton(page, 'Share live').click());
    await expect(page.locator('#hroom-bar')).toBeVisible();

    // It is status, not a toolbar control — it sits below the header rather
    // than inside it, which is what keeps the toolbar from growing again.
    const inToolbar = await pill(page).evaluate(el => !!el.closest('#happ > div:first-child'));
    expect(inToolbar, 'the status pill is back in the header toolbar').toBe(false);

    // And it says the whole sentence: it used to be capped at 12rem and
    // ellipsised, on the one message that has to be readable.
    const cut = await pill(page).evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(cut, 'the status pill is truncated').toBe(false);
  });

  test('the pill counts what has not been sent, and Update clears it', async ({ page }) => {
    await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await linkFrom(page, () => sheetButton(page, 'Share live').click());
    await expect(pill(page)).toContainText('up to date');

    // A real edit through the app, so `rev` moves the way it does in use.
    await page.locator('#hedit-toggle').click();
    await page.locator('#hvlist .hpencil').first().click();
    await page.locator('#hedit-tab-json').click();
    await page.locator('#hedit-ta').fill(JSON.stringify({
      id: 'seg-1', type: 'event', subtype: 'gig', name: 'A different gig',
      date: '2026-09-19', time: '20:00', cost: { status: 'free' },
    }));
    await page.locator('#hedit-ft button', { hasText: 'Save' }).click();

    // Pushes are manual: saving locally must never spend a write.
    await expect(pill(page)).toContainText('1 change not shared');
    await openSheet(page);
    await sheetButton(page, 'Update shared copy').click();
    await expect(pill(page)).toContainText('up to date');
  });

  test('"Let them edit" survives the sheet repainting', async ({ page }) => {
    await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await linkFrom(page, () => sheetButton(page, 'Share live').click());

    // Tick the box, then do something that repaints the sheet — a push does.
    // The tick belongs to the user, not the render: losing it here handed out
    // a viewer link the sharer believed was an edit link.
    await openSheet(page);
    await page.locator('#hshare-edit').check();
    await sheetButton(page, 'Update shared copy').click();
    await expect(pill(page)).toContainText('up to date');
    await expect(page.locator('#hshare-edit')).toBeChecked();
    const link = await linkFrom(page, () => sheetButton(page, 'Copy the live link').click());
    expect(link).toMatch(/#w1=/);
  });

  test('an edit link makes the other device a writer; a view link does not', async ({ page, context }) => {
    const store = await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await page.locator('#hshare-edit').check();
    const writerLink = await linkFrom(page, () => sheetButton(page, 'Share live').click());
    await openSheet(page);
    await page.locator('#hshare-edit').uncheck();
    const viewerLink = await linkFrom(page, () => sheetButton(page, 'Copy the live link').click());

    // A second browser context is a second device: nothing shared but the link.
    const other = await context.browser().newContext();
    const viewer = await other.newPage();
    await routeStore(viewer, store);
    await viewer.goto(new URL(viewerLink).pathname + new URL(viewerLink).hash);
    await expect(viewer.locator('#htname')).toHaveText('Orbit City');
    const viewerRoom = await savedRoom(viewer);
    expect(viewerRoom.id).toBeTruthy();
    expect(viewerRoom.k).toBeUndefined(); // no master key: read-only, by construction
    await openSheet(viewer);
    await expect(sheetButton(viewer, 'Update shared copy')).toHaveCount(0);
    await expect(viewer.locator('#hshare-body')).toContainText('not sent back');

    const writer = await other.newPage();
    await routeStore(writer, store);
    await writer.goto(new URL(writerLink).pathname + new URL(writerLink).hash);
    await expect(writer.locator('#htname')).toHaveText('Orbit City');
    expect((await savedRoom(writer)).k).toBeTruthy();
    await openSheet(writer);
    await expect(sheetButton(writer, 'Update shared copy')).toHaveCount(1);
    await other.close();
  });

  test('someone else\'s update lands silently when nothing local is unsent', async ({ page, context }) => {
    const store = await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await page.locator('#hshare-edit').check();
    const writerLink = await linkFrom(page, () => sheetButton(page, 'Share live').click());

    const other = await context.browser().newContext();
    const them = await other.newPage();
    await routeStore(them, store);
    await them.goto(new URL(writerLink).pathname + new URL(writerLink).hash);
    await expect(them.locator('#htname')).toHaveText('Orbit City');
    // They rename the trip and push.
    await them.locator('#happ button[title="Toggle edit mode"]').click();
    await them.locator('#htname + .hpencil, #happ .hpencil').first().click();
    await them.locator('#hedit-tab-json').click();
    const trip = await them.locator('#hedit-ta').inputValue();
    await them.locator('#hedit-ta').fill(trip.replace('Orbit City', 'Orbit City Redux'));
    await them.locator('#hedit-ft button', { hasText: 'Save' }).click();
    await openSheet(them);
    await sheetButton(them, 'Update shared copy').click();
    await expect(them.locator('#hroom-pill')).toContainText('up to date');

    // Back on the first device, with nothing of its own outstanding: the new
    // version simply arrives.
    await closeSheet(page);
    await openSheet(page); // opening the sheet pulls
    await expect(page.locator('#htname')).toHaveText('Orbit City Redux');
    await expect(pill(page)).toContainText('up to date');
    await other.close();
  });

  test('a clean update waits out an open edit modal rather than landing under it', async ({ page, context }) => {
    const store = await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await page.locator('#hshare-edit').check();
    const writerLink = await linkFrom(page, () => sheetButton(page, 'Share live').click());

    const other = await context.browser().newContext();
    const them = await other.newPage();
    await routeStore(them, store);
    await them.goto(new URL(writerLink).pathname + new URL(writerLink).hash);
    await expect(them.locator('#htname')).toHaveText('Orbit City');
    await them.locator('#happ button[title="Toggle edit mode"]').click();
    await them.locator('#htname + .hpencil, #happ .hpencil').first().click();
    await them.locator('#hedit-tab-json').click();
    const trip = await them.locator('#hedit-ta').inputValue();
    await them.locator('#hedit-ta').fill(trip.replace('Orbit City', 'Orbit City Redux'));
    await them.locator('#hedit-ft button', { hasText: 'Save' }).click();
    await openSheet(them);
    await sheetButton(them, 'Update shared copy').click();
    await expect(them.locator('#hroom-pill')).toContainText('up to date');

    // The first device has nothing unpushed — the revisions say "apply
    // silently" — but its edit modal is open on a half-typed form. `saveEdit`
    // writes back by index, so a document swapped out underneath it would take
    // the save into whatever now sits at that index. The pull must wait.
    await closeSheet(page);
    await page.locator('#hedit-toggle').click();
    await page.locator('#hvlist .hpencil').first().click();
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);
    const pulls = () => store.seen.filter(r => r.method === 'GET').length;
    const before = pulls();
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await expect.poll(pulls).toBeGreaterThan(before);
    // Proving a negative: give the pull's decrypt-and-apply time it must not use.
    await page.waitForTimeout(400);
    await expect(page.locator('#htname')).toHaveText('Orbit City');
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);

    // The moment the modal is out of the way, the same pull lands it.
    await page.locator('#hedit-ft button', { hasText: 'Cancel' }).click();
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await expect(page.locator('#htname')).toHaveText('Orbit City Redux');
    await other.close();
  });

  test('a divergent version is parked, not thrown over a half-done edit', async ({ page, context }) => {
    const store = await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await page.locator('#hshare-edit').check();
    const writerLink = await linkFrom(page, () => sheetButton(page, 'Share live').click());

    const other = await context.browser().newContext();
    const them = await other.newPage();
    await routeStore(them, store);
    await them.goto(new URL(writerLink).pathname + new URL(writerLink).hash);
    await expect(them.locator('#htname')).toHaveText('Orbit City');
    await them.locator('#happ button[title="Toggle edit mode"]').click();
    await them.locator('#hvlist .hpencil').first().click();
    await them.locator('#hedit-tab-json').click();
    await them.locator('#hedit-ta').fill(JSON.stringify({
      id: 'seg-1', type: 'event', subtype: 'gig', name: 'Their gig',
      date: '2026-09-19', time: '20:00', cost: { status: 'free' },
    }));
    await them.locator('#hedit-ft button', { hasText: 'Save' }).click();
    await openSheet(them);
    await sheetButton(them, 'Update shared copy').click();

    // Meanwhile the first device edits too, and has not sent it.
    await closeSheet(page);
    await page.locator('#hedit-toggle').click();
    await page.locator('#hvlist .hpencil').first().click();
    await page.locator('#hedit-tab-json').click();
    await page.locator('#hedit-ta').fill(JSON.stringify({
      id: 'seg-1', type: 'event', subtype: 'gig', name: 'My gig',
      date: '2026-09-19', time: '20:00', cost: { status: 'free' },
    }));
    await page.locator('#hedit-ft button', { hasText: 'Save' }).click();

    // A pull now finds a divergence. It must NOT raise a banner by itself —
    // opening the sheet pulls, and all that may change is the status.
    await openSheet(page);
    await expect(page.locator('#hshare-body')).toContainText('waiting');
    await expect(page.locator('#hverwarn')).toBeHidden();
    await closeSheet(page);
    await expect(pill(page)).toContainText('waiting');
    // The user picks the moment, by tapping the pill.
    await pill(page).click();
    await expect(page.locator('#hverwarn')).toBeVisible();
    await expect(page.locator('#hverwarn')).toContainText('moved on');
    // Keep mine: my content, renumbered above theirs, and sent.
    await page.locator('#hverwarn button', { hasText: 'Keep mine' }).click();
    await expect(page.locator('#hverwarn')).toBeHidden();
    await expect(page.locator('#hvlist')).toContainText('My gig');
    await expect(pill(page)).toContainText('up to date');
    await other.close();
  });

  test('stopping forgets the key as well as the blob', async ({ page }) => {
    const { blobs } = await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await linkFrom(page, () => sheetButton(page, 'Share live').click());
    expect(blobs.size).toBe(1);

    page.on('dialog', d => d.accept());
    await openSheet(page);
    await sheetButton(page, 'Stop sharing').click();
    await expect(page.locator('#hroom-bar')).toBeHidden();
    // Both halves: a kept key would resurrect the room at the same derived id
    // on the very next push.
    expect(await savedRoom(page)).toBeNull();
    expect(blobs.size).toBe(0);
  });

  test('forgetting the trip takes its room with it', async ({ page }) => {
    await routeStore(page);
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    await linkFrom(page, () => sheetButton(page, 'Share live').click());
    const tripId = (await savedIndex(page))[0].trip_id;
    expect(await page.evaluate(id => !!localStorage.getItem('hShare:' + id), tripId)).toBe(true);

    page.on('dialog', d => d.accept());
    await page.locator('#happ button[title="Switch trip"]').click();
    await page.locator('#hlib-list button[title="Delete this trip"]').first().click();
    expect(await page.evaluate(id => localStorage.getItem('hShare:' + id), tripId)).toBeNull();
  });

  test('a store that refuses a room falls back to a copy rather than a dead end', async ({ page }) => {
    await routeStore(page, backend({ writeFails: true }));
    await page.goto('/holiday_itinerary_viewer.html');
    await upload(page, itinerary('Orbit City'));
    await openSheet(page);
    // The same path a page running against a Worker that has no PUT yet takes:
    // the write is refused, so live sharing fails *silently* into a link that
    // carries the plan. Never a dead end, and nothing written locally.
    const link = await linkFrom(page, () => sheetButton(page, 'Share live').click());
    expect(link).toMatch(/#(d1|u1)=/);
    expect(await savedRoom(page)).toBeNull();
  });
});
