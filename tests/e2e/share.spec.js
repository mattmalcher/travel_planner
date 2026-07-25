// Share links (issue #81): a trip encoded in the URL fragment, produced from
// the header and consumed on boot. The encoding itself is unit-tested in
// tests/unit/sharelink.test.js — what matters here is the browser half: the
// fragment is cleared, the link goes to the clipboard or the share sheet, a
// mangled link says so, and a link that comes back lands on the trip it
// came from rather than a second copy of it.
//
// Hermetic like the other specs: ajv is stubbed, and the clipboard and share
// sheet are stubbed in the page rather than relying on browser permissions.
import { test, expect } from '@playwright/test';
import { savedDoc, savedIndex } from './library.js';
import { encodeShare, shareDocument } from '../../src/lib/sharelink.js';

const AJV_STUB = `
const isSegmentSchema = s => !!(s && (s.oneOf || /Segment$/.test(s.$ref || '')));
export default class Ajv {
  constructor() {}
  compile(schema) {
    const flag = isSegmentSchema(schema) ? '__SEG_VALID__' : '__DOC_VALID__';
    function validate(data) {
      const ok = (globalThis[flag] !== false);
      validate.errors = ok ? null : (globalThis.__ERRORS__ || [{ instancePath: '/', message: 'stub: invalid', params: {} }]);
      return ok;
    }
    return validate;
  }
}
`;
const FMT_STUB = `export default function addFormats() {}`;

const itinerary = (name, over = {}) => ({
  trip: {
    name, travellers: ['Judy Jetson', 'George Jetson'],
    start: '2026-09-18', end: '2026-09-21', currency_primary: 'GBP',
  },
  segments: [{
    id: 'seg-1', type: 'event', subtype: 'gig', name: `${name} gig`,
    date: '2026-09-19', time: '20:00', cost: { status: 'free' },
  }],
  ...over,
});

/** The page URL carrying `doc` as a share link. */
async function linkTo(doc) {
  return '/holiday_itinerary_viewer.html#' + await encodeShare(doc);
}

const share = page => page.locator('#happ button[title="Share a link to this trip"]');

/** What the page copied to the clipboard (the stub below records it). */
const copied = page => page.evaluate(() => globalThis.__copied || []);

function upload(page, doc, name = 'itinerary.json') {
  return page.setInputFiles('#hfile', {
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)),
  });
}

test.describe('Share links', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
    // Stub the two ways a link leaves the page. navigator.share is absent on
    // desktop Chromium, which is the clipboard path; the sheet is opted into
    // per-test by setting window.__share.
    await page.addInitScript(() => {
      globalThis.__copied = [];
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => (globalThis.__clipboardFails ? Promise.reject(new Error('denied')) : (globalThis.__copied.push(t), Promise.resolve())) },
      });
      Object.defineProperty(globalThis.navigator, 'share', {
        configurable: true,
        get: () => (globalThis.__share ? (d => (globalThis.__shared = d, globalThis.__shareRejects ? Promise.reject(Object.assign(new Error('nope'), { name: globalThis.__shareRejects })) : Promise.resolve())) : undefined),
      });
    });
  });

  test.afterEach(() => {
    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('a link in the fragment opens the trip, and the fragment is cleared', async ({ page }) => {
    await page.goto(await linkTo(itinerary('Shared Paris weekend')));
    await expect(page.locator('#htname')).toContainText('Shared Paris weekend');
    await expect(page.locator('#hvlist')).toContainText('Shared Paris weekend gig');

    // Cleared, so a refresh doesn't re-import a stale snapshot over later edits.
    expect(await page.evaluate(() => globalThis.location.hash)).toBe('');
    expect(await page.evaluate(() => globalThis.location.pathname)).toBe('/holiday_itinerary_viewer.html');

    // It lands in the library like any other document, with identity settled.
    const doc = await savedDoc(page);
    expect(doc.trip.name).toBe('Shared Paris weekend');
    expect(doc.trip_id).toBeTruthy();
    expect(doc.rev).toBe(1);

    // And a reload now opens the saved trip, not the link.
    await page.reload();
    await expect(page.locator('#htname')).toContainText('Shared Paris weekend');
  });

  test('a link is validated on the way in, like an uploaded file', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__DOC_VALID__ = false; });
    await page.goto(await linkTo(itinerary('Dubious trip')));
    await expect(page.locator('#hverwarn')).toContainText('does not match the itinerary schema');
    await expect(page.locator('#happ')).toBeHidden();

    // The escape hatch is the upload path's: load it anyway.
    await page.getByRole('button', { name: 'Load anyway' }).click();
    await expect(page.locator('#htname')).toContainText('Dubious trip');
  });

  test('a link from an incompatible schema version is guarded, not loaded blind', async ({ page }) => {
    await page.goto(await linkTo({ ...itinerary('Old trip'), schema_version: '1.0.0' }));
    await expect(page.locator('#hverwarn')).toContainText('different schema version');
    await expect(page.locator('#happ')).toBeHidden();
  });

  test('a mangled link says so instead of showing a blank page', async ({ page }) => {
    // What a messaging app does to a long link: it arrives cut short.
    const link = await linkTo(itinerary('Truncated trip'));
    await page.goto(link.slice(0, link.length - 60));
    await expect(page.locator('#hverwarn')).toContainText('could not be opened');
    await expect(page.locator('#hverwarn')).toContainText('damaged or incomplete');
    await expect(page.locator('#happ')).toBeHidden();
    // The opening screen is still usable underneath it.
    await expect(page.locator('#hdz')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('#hverwarn')).toBeHidden();
  });

  test('a fragment that is not a share link is left alone', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html#day-3');
    await expect(page.locator('#hdz')).toBeVisible();
    await expect(page.locator('#hverwarn')).toBeHidden();
    expect(await page.evaluate(() => globalThis.location.hash)).toBe('#day-3');
  });

  test('Share copies a link, and says what sharing one means', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Rail tour'));
    await expect(page.locator('#htname')).toContainText('Rail tour');

    await share(page).click();
    await expect(page.locator('#hshare-toast')).toBeVisible();
    await expect(page.locator('#hshare-toast')).toContainText('booking references included');

    const links = await copied(page);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('/holiday_itinerary_viewer.html#d1=');
    // In the fragment, never the query — a fragment never reaches a server log.
    expect(links[0]).not.toContain('?');

    await page.locator('#hshare-toast').click();
    await expect(page.locator('#hshare-toast')).toBeHidden();
  });

  test('Share offers the system share sheet where there is one', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__share = true; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Sheet trip'));

    await share(page).click();
    await expect.poll(() => page.evaluate(() => globalThis.__shared)).toBeTruthy();
    const shared = await page.evaluate(() => globalThis.__shared);
    expect(shared.title).toBe('Sheet trip');
    expect(shared.url).toContain('#d1=');
    expect(await copied(page)).toEqual([]); // the sheet took it; no clipboard fallback
  });

  test('a cancelled share sheet is a decision, and a failed one falls back to the clipboard', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__share = true; globalThis.__shareRejects = 'AbortError'; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Cancelled trip'));

    await share(page).click();
    await expect.poll(() => page.evaluate(() => globalThis.__shared)).toBeTruthy();
    await expect(page.locator('#hshare-toast')).toBeHidden();
    expect(await copied(page)).toEqual([]);

    // A share sheet that refuses for any other reason is not a decision.
    await page.evaluate(() => { globalThis.__shareRejects = 'NotAllowedError'; });
    await share(page).click();
    await expect(page.locator('#hshare-toast')).toBeVisible();
    expect(await copied(page)).toHaveLength(1);
  });

  test('with no clipboard the link is handed over rather than lost', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__clipboardFails = true; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('No clipboard trip'));

    let prompted = null;
    page.on('dialog', d => { prompted = d.defaultValue(); d.dismiss(); });
    await share(page).click();
    await expect.poll(() => prompted).toContain('#d1=');
  });

  test('a shared trip opened and shared back is the same trip, not a second copy', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Round trip'));
    await share(page).click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    const link = (await copied(page))[0];
    const sent = await savedDoc(page);

    // Open the link as the other person would, in a browser holding nothing.
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.goto(link);
    await expect(page.locator('#htname')).toContainText('Round trip');
    const received = await savedDoc(page);
    expect(received.trip_id).toBe(sent.trip_id);
    expect(received.rev).toBe(sent.rev);

    // Share it back: same trip_id and rev, and re-opening it here is a no-op
    // rather than a second entry in the library.
    await share(page).click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    await page.goto((await copied(page))[0]);
    await expect(page.locator('#htname')).toContainText('Round trip');
    expect(await savedIndex(page)).toHaveLength(1);
    const back = await savedDoc(page);
    expect(back.trip_id).toBe(sent.trip_id);
    expect(back.rev).toBe(sent.rev);
  });

  test('a link followed while the app is open is not silently ignored', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Trip already open'));
    await expect(page.locator('#htname')).toContainText('Trip already open');

    // Only the fragment changes, which is not a page load — the app has to
    // notice for itself or the link appears to do nothing.
    await page.goto(await linkTo(itinerary('Trip from a friend')));
    await expect(page.locator('#htname')).toContainText('Trip from a friend');
    expect(await page.evaluate(() => globalThis.location.hash)).toBe('');
    // The trip that was open is still in the library, not replaced by it.
    expect(await savedIndex(page)).toHaveLength(2);
  });

  test('a newer link for a trip already here is a decision, not an overwrite', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Shared plans'));
    const mine = await savedDoc(page);

    // The link the other person sends back: same trip, further along.
    const theirs = {
      ...itinerary('Shared plans', { trip_id: mine.trip_id, rev: mine.rev + 3 }),
      segments: [{
        id: 'seg-2', type: 'event', subtype: 'gig', name: 'Their new gig',
        date: '2026-09-20', time: '19:00', cost: { status: 'free' },
      }],
    };
    await page.goto(await linkTo(shareDocument(theirs, await page.evaluate(() => globalThis.H_SCHEMA_VERSION))));

    await expect(page.locator('#hverwarn')).toContainText('You already have this trip');
    await expect(page.locator('#hverwarn')).toContainText(`rev ${mine.rev + 3}`);
    await page.getByRole('button', { name: 'Keep both' }).click();
    await expect(page.locator('#hvlist')).toContainText('Their new gig');

    // Kept as its own trip, so neither copy's revision chain is corrupted.
    const index = await savedIndex(page);
    expect(index).toHaveLength(2);
    const opened = await savedDoc(page);
    expect(opened.trip_id).not.toBe(mine.trip_id);
    expect(opened.forked_from.trip_id).toBe(mine.trip_id);
  });

  test('a revision can be shared from its row in the history', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidateTrip === 'function'");
    await upload(page, itinerary('History trip'));

    // One saved change, so there is a superseded revision to share.
    await page.locator('#hedit-toggle').click();
    await page.locator('#htname button').click();
    await page.locator('#hedit-form [data-p="name"]').fill('History trip renamed');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#htname')).toContainText('History trip renamed');

    await page.locator('#happ button[title="Switch trip"]').click();
    // Scoped to the switcher: the opening screen renders the same rows, and
    // its copy is behind the hidden #hupl while a trip is open.
    await page.locator('#hlib-list .hlib-icon[title="Revision history"]').first().click();
    await page.locator('#hlib-list .hlib-rev button[title="Share this revision as a link"]').first().click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    expect((await copied(page))[0]).toContain('#d1=');
  });
});
