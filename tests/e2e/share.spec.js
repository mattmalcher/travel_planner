// Sharing a trip (issues #81, #114): out through the share sheet as a file, or
// down the fallback ladder to a download, copied text or the old long link; and
// back in through a link, a file, a paste or a drop. The encodings are
// unit-tested in tests/unit/sharelink.test.js and tests/unit/sharefile.test.js —
// what matters here is the browser half: what actually leaves the page, that
// `canShare` is asked about the real file, that no rung of the ladder is a dead
// end, and that a trip that comes back lands on the trip it came from rather
// than a second copy of it.
//
// Hermetic like the other specs: the clipboard and share sheet are stubbed in
// the page rather than relying on browser permissions.
import { test, expect } from '@playwright/test';
import { savedDoc, savedIndex } from './library.js';
import { encodeShare, shareDocument } from '../../src/lib/sharelink.js';


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

const share = page => page.locator('#happ button[title="Share this trip"]');

/** What the page copied to the clipboard (the stub below records it). */
const copied = page => page.evaluate(() => globalThis.__copied || []);

/** What the page handed to the share sheet, if anything. */
const shared = page => page.evaluate(() => globalThis.__shared);

/** Ctrl-V onto the page, with `text` on the clipboard. */
function paste(page, text) {
  return page.evaluate(t => {
    const dt = new DataTransfer();
    dt.setData('text', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

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
    // Stub the ways a trip leaves the page. The share sheet is opted into per
    // test with __share, and its *file* support separately with __shareFiles —
    // the two really are separate capabilities, and the split is the point of
    // asking canShare with the real files array.
    await page.addInitScript(() => {
      globalThis.__copied = [];
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => (globalThis.__clipboardFails ? Promise.reject(new Error('denied')) : (globalThis.__copied.push(t), Promise.resolve())) },
      });
      Object.defineProperty(globalThis.navigator, 'canShare', {
        configurable: true,
        get: () => (globalThis.__share ? (d => (d && d.files ? !!globalThis.__shareFiles : true)) : undefined),
      });
      Object.defineProperty(globalThis.navigator, 'share', {
        configurable: true,
        get: () => (globalThis.__share ? (d => {
          globalThis.__shared = {
            title: d.title,
            text: d.text,
            url: d.url,
            files: (d.files || []).map(f => ({ name: f.name, type: f.type })),
          };
          if (d.files && d.files[0]) d.files[0].text().then(t => { globalThis.__sharedText = t; });
          return globalThis.__shareRejects
            ? Promise.reject(Object.assign(new Error('nope'), { name: globalThis.__shareRejects }))
            : Promise.resolve();
        }) : undefined),
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
    // A link is the least trusted way a document arrives, and since ajv is
    // compiled into the page the guard is there even with no network at all —
    // so this is the real validator rejecting a genuinely invalid document
    // (an event segment with no `subtype`, which its subschema requires).
    const dubious = itinerary('Dubious trip');
    delete dubious.segments[0].subtype;
    await page.goto(await linkTo(dubious));
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

  test('Share attaches the trip as a file — the whole point of issue #114', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__share = true; globalThis.__shareFiles = true; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Sheet trip'));

    await share(page).click();
    await expect.poll(() => shared(page)).toBeTruthy();
    const sheet = await shared(page);
    expect(sheet.title).toBe('Sheet trip');
    // An attachment, not a URL: a URL is what WhatsApp on Android stops
    // linkifying once it gets long.
    expect(sheet.url).toBeUndefined();
    expect(sheet.files).toHaveLength(1);
    expect(sheet.files[0].type).toBe('application/json');
    // Named for the trip and stamped with the day, so several shares of the
    // same trip are tellable apart in one chat thread.
    expect(sheet.files[0].name).toMatch(/^sheet_trip_\d{4}-\d{2}-\d{2}\.json$/);

    const text = await page.evaluate(() => globalThis.__sharedText);
    const doc = JSON.parse(text);
    expect(doc.trip.name).toBe('Sheet trip');
    expect(doc.schema_version).toBeTruthy();
    expect(doc.trip_id).toBeTruthy();

    // The sheet took it: no fallback fired behind it.
    expect(await copied(page)).toEqual([]);
    await expect(page.locator('#hshare-toast')).toBeHidden();
  });

  test('a browser that shares URLs but not files gets the fallbacks, not a throw', async ({ page }) => {
    // canShare is asked with the real files array rather than inferred from
    // navigator.share existing — this is the browser where the difference bites.
    await page.addInitScript(() => { globalThis.__share = true; globalThis.__shareFiles = false; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('URL only browser'));

    await share(page).click();
    await expect(page.locator('#hshare-toast')).toBeVisible();
    expect(await shared(page)).toBeUndefined(); // never called, so never threw
    await expect(page.locator('#hshare-toast')).toContainText('booking references included');
    for (const name of ['Download file', 'Copy as text', 'Copy link'])
      await expect(page.locator('#hshare-toast').getByRole('button', { name })).toBeVisible();
  });

  test('with no share sheet at all, every fallback is one tap away and works', async ({ page }) => {
    // Desktop Firefox, and desktop Chrome on Linux.
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Desktop trip'));

    await share(page).click();
    const toast = page.locator('#hshare-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('desktop_trip_');

    // Rung 2: the file, to attach by hand.
    const download = page.waitForEvent('download');
    await toast.getByRole('button', { name: 'Download file' }).click();
    expect((await download).suggestedFilename()).toBe('desktop_trip.json');
    // The buttons are still there — a fallback that puts itself away as you
    // reach for it is worse than one that sits.
    await expect(toast).toBeVisible();

    // Rung 3: the compressed payload as text, for a channel that mangles links.
    await toast.getByRole('button', { name: 'Copy as text' }).click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    expect((await copied(page))[0]).toMatch(/^d1=[A-Za-z0-9_-]+$/);

    // Rung 4: the pre-#114 long link, kept working.
    await share(page).click();
    await page.locator('#hshare-toast').getByRole('button', { name: 'Copy link' }).click();
    await expect.poll(async () => (await copied(page)).length).toBe(2);
    const link = (await copied(page))[1];
    expect(link).toContain('/holiday_itinerary_viewer.html#d1=');
    // In the fragment, never the query — a fragment never reaches a server log.
    expect(link).not.toContain('?');
  });

  test('a cancelled share sheet is a decision, and a failed one falls back', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__share = true; globalThis.__shareFiles = true; globalThis.__shareRejects = 'AbortError';
    });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Cancelled trip'));

    await share(page).click();
    await expect.poll(() => shared(page)).toBeTruthy();
    await expect(page.locator('#hshare-toast')).toBeHidden();
    expect(await copied(page)).toEqual([]);

    // A share sheet that refuses for any other reason — a target that would not
    // take the attachment — is not a decision, and drops to the fallbacks.
    await page.evaluate(() => { globalThis.__shareRejects = 'NotAllowedError'; });
    await share(page).click();
    await expect(page.locator('#hshare-toast')).toBeVisible();
    await expect(page.locator('#hshare-toast').getByRole('button', { name: 'Copy as text' })).toBeVisible();
  });

  test('with no clipboard the payload is handed over rather than lost', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__clipboardFails = true; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('No clipboard trip'));

    let prompted = null;
    page.on('dialog', d => { prompted = d.defaultValue(); d.dismiss(); });
    await share(page).click();
    await page.locator('#hshare-toast').getByRole('button', { name: 'Copy as text' }).click();
    await expect.poll(() => prompted).toMatch(/^d1=/);
  });

  test('a shared trip opened and shared back is the same trip, not a second copy', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Round trip'));
    await share(page).click();
    await page.locator('#hshare-toast').getByRole('button', { name: 'Copy link' }).click();
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
    await page.locator('#hshare-toast').getByRole('button', { name: 'Copy link' }).click();
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

  /* --- coming back in: the four ways a trip arrives (issue #114) ---------- */

  test('a trip arrives as a file, however that file got here', async ({ page }) => {
    // The share-sheet attachment and the file picker are the same path: the OS
    // hands a shared file to the page as an ordinary file.
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Attached trip'), 'attached_trip_2026-08-07.json');
    await expect(page.locator('#htname')).toContainText('Attached trip');
    await expect(page.locator('#hvlist')).toContainText('Attached trip gig');
  });

  test('a payload pasted onto the opening screen opens the trip', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await upload(page, itinerary('Pasted trip'));
    await share(page).click();
    await page.locator('#hshare-toast').getByRole('button', { name: 'Copy as text' }).click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    const payload = (await copied(page))[0];

    // The other person, with an empty browser, pressing Ctrl-V on the page.
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await paste(page, payload);
    await expect(page.locator('#htname')).toContainText('Pasted trip');
  });

  test('the Paste button reads the clipboard, and asks when it cannot', async ({ page }) => {
    const doc = itinerary('Clipboard trip');
    await page.addInitScript(json => { globalThis.__clipboardText = json; }, JSON.stringify(doc));
    await page.addInitScript(() => {
      globalThis.navigator.clipboard.readText = () => Promise.resolve(globalThis.__clipboardText);
    });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await page.getByRole('button', { name: 'Paste a trip' }).click();
    await expect(page.locator('#htname')).toContainText('Clipboard trip');

    // A browser with no readText (Firefox) gets a box instead of nothing.
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await page.evaluate(() => { globalThis.navigator.clipboard.readText = undefined; });
    page.on('dialog', d => d.accept(JSON.stringify(itinerary('Typed-in trip'))));
    await page.getByRole('button', { name: 'Paste a trip' }).click();
    await expect(page.locator('#htname')).toContainText('Typed-in trip');
  });

  test('a link dragged onto the drop zone counts as dropping the trip', async ({ page }) => {
    const link = await linkTo(itinerary('Dragged trip'));
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await page.evaluate(text => {
      const dt = new DataTransfer();
      dt.setData('text', text);
      document.getElementById('hdz').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, 'https://example.test' + link);
    await expect(page.locator('#htname')).toContainText('Dragged trip');
  });

  test('text that is not a trip says so instead of doing nothing', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await paste(page, 'see you in Paris on the 18th!');
    await expect(page.locator('#hverwarn')).toContainText('could not be opened as a trip');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('#hverwarn')).toBeHidden();
    // Still usable underneath: no dead UI.
    await expect(page.locator('#hdz')).toBeVisible();
  });

  test('a paste into a text box is left to the text box', async ({ page }) => {
    // The AI composer sits on the opening screen too, and typing a prompt into
    // it must not be read as importing a trip.
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text', 'plan me four days in Lyon');
      document.getElementById('hchat-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#hverwarn')).toBeHidden();
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
    await page.locator('#hlib-list .hlib-rev button[title="Share this revision"]').first().click();
    // Same ladder as the header's Share, and the revision it names travels with
    // it into the filename.
    const toast = page.locator('#hshare-toast');
    await expect(toast).toContainText('history_trip_rev1_');
    const download = toast.page().waitForEvent('download');
    await toast.getByRole('button', { name: 'Download file' }).click();
    expect((await download).suggestedFilename()).toBe('history_trip_rev1.json');
  });
});
