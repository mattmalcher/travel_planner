// The trip library (issue #80): several trips saved at once, the switcher that
// flips between them, and winding one back to an earlier revision.
//
// Hermetic like add.spec.js — ajv is stubbed, so these tests exercise the
// flows rather than racing the esm.sh import. The storage rules themselves
// (rev bumping, coalescing, quota) are covered in tests/unit/library.test.js.
import { test, expect } from '@playwright/test';
import { savedDoc, savedIndex, savedRevisions } from './library.js';

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

const field = (page, path) => page.locator(`#hedit-form [data-p="${path}"]`);
const save = page => page.locator('#hedit-ft').getByRole('button', { name: 'Save' });
const switcher = page => page.locator('#happ button[title="Switch trip"]');
const rows = page => page.locator('#hlib-list .hlib-row');

function upload(page, doc, name = 'itinerary.json') {
  return page.setInputFiles('#hfile', {
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)),
  });
}

/** Rename the loaded trip through the header pencil — one saved change. */
async function rename(page, to) {
  // The trip pencil lives behind edit mode, like the other pencils.
  if (!await page.locator('#happ.hedit-on').count()) await page.locator('#hedit-toggle').click();
  await page.locator('#htname button').click();
  await expect(page.locator('#hedit-modal')).toBeVisible();
  await field(page, 'name').fill(to);
  await save(page).click();
  await expect(page.locator('#hedit-modal')).toBeHidden();
  await expect(page.locator('#htname')).toContainText(to);
}

test.describe('Trip library', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidateTrip === 'function'");
  });

  test('a second trip does not evict the first, and the switcher flips between them', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'), 'paris.json');
    await expect(page.locator('#htname')).toContainText('Paris weekend');

    // Closing a trip puts it down; it does not forget it.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#hupl')).toBeVisible();
    await expect(page.locator('#hupl-recent')).toContainText('Paris weekend');

    await upload(page, itinerary('Rome in spring'), 'rome.json');
    await expect(page.locator('#htname')).toContainText('Rome in spring');
    expect((await savedIndex(page)).map(e => e.name).sort()).toEqual(['Paris weekend', 'Rome in spring']);

    await switcher(page).click();
    await expect(rows(page)).toHaveCount(2);
    // The open one says so, and the most recently edited is first.
    await expect(rows(page).first()).toContainText('Rome in spring');
    await expect(rows(page).first()).toContainText('open');
    await expect(rows(page).nth(1)).toContainText('rev 1');

    await rows(page).nth(1).getByRole('button', { name: /Paris weekend/ }).click();
    await expect(page.locator('#hlib-modal')).toBeHidden();
    await expect(page.locator('#htname')).toContainText('Paris weekend');
    await expect(page.locator('#hvlist')).toContainText('Paris weekend gig');

    // …and the trip that was open is the one that comes back on a reload.
    await page.reload();
    await expect(page.locator('#htname')).toContainText('Paris weekend');
    const saved = await savedDoc(page);
    expect(saved.trip.name).toBe('Paris weekend');
    expect(saved.segments).toHaveLength(1);
    expect((await savedIndex(page))).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test('opening a trip does not inflate its rev; editing it does', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    expect((await savedDoc(page)).rev).toBe(1);
    await page.reload();
    await expect(page.locator('#htname')).toContainText('Paris weekend');
    expect((await savedDoc(page)).rev).toBe(1);

    await rename(page, 'Paris in September');
    const saved = await savedDoc(page);
    expect(saved.rev).toBe(2);
    expect(saved.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(errors).toEqual([]);
  });

  test('a trip can be wound back to an earlier revision, without rewinding rev', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    await rename(page, 'Paris in September');
    await rename(page, 'Paris, later');
    expect((await savedDoc(page)).rev).toBe(3);

    const tripId = (await savedDoc(page)).trip_id;
    // Both edits fall inside the coalescing window, so what the history keeps
    // is where they started from: rev 1.
    await expect.poll(() => savedRevisions(page, tripId).then(r => r.map(e => e.rev))).toEqual([1]);

    await switcher(page).click();
    await rows(page).first().getByRole('button', { name: 'Revision history' }).click();
    const rev = page.locator('#hlib-list .hlib-rev').first();
    await expect(rev).toContainText('rev 1');

    page.once('dialog', d => {
      expect(d.message()).toContain('Restore rev 1');
      d.accept();
    });
    await rev.getByRole('button', { name: 'Restore' }).click();

    await expect(page.locator('#htname')).toContainText('Paris weekend');
    const saved = await savedDoc(page);
    expect(saved.trip.name).toBe('Paris weekend');
    expect(saved.rev).toBe(4); // rev 1's content, saved as the next revision
    expect(saved.trip_id).toBe(tripId);
    expect(errors).toEqual([]);
  });

  test('a trip started from scratch joins the library alongside the loaded one', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Start from scratch' }).click();
    await field(page, 'name').fill('Lisbon, someday');
    await field(page, 'travellers').fill('Judy Jetson');
    await field(page, 'start').fill('2027-04-01');
    await field(page, 'end').fill('2027-04-05');
    await save(page).click();

    await expect(page.locator('#htname')).toContainText('Lisbon, someday');
    const index = await savedIndex(page);
    expect(index.map(e => e.name).sort()).toEqual(['Lisbon, someday', 'Paris weekend']);
    // Its own minted id, not one derived from the trip's name.
    expect((await savedDoc(page)).trip_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(errors).toEqual([]);
  });

  test('uploading a diverged copy of a saved trip offers Keep both', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    const tripId = (await savedDoc(page)).trip_id;
    await page.getByRole('button', { name: 'Close' }).click();

    // The same trip_id and rev, different contents: two people edited rev 1.
    const theirs = itinerary('Paris weekend', { trip_id: tripId, rev: 1 });
    theirs.segments.push({
      id: 'seg-2', type: 'event', subtype: 'meal', name: 'Their dinner',
      date: '2026-09-20', time: '19:30', cost: { status: 'not_booked' },
    });
    await upload(page, theirs, 'theirs.json');

    const warn = page.locator('#hverwarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('diverged');
    await expect(page.locator('#happ')).toBeHidden();

    await warn.getByRole('button', { name: 'Keep both' }).click();
    await expect(page.locator('#happ')).toBeVisible();
    const saved = await savedDoc(page);
    expect(saved.trip_id).not.toBe(tripId);
    expect(saved.forked_from).toEqual({ trip_id: tripId, rev: 1 });
    expect((await savedIndex(page))).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test('re-uploading the same file is a no-op rather than a second trip', async ({ page }) => {
    const doc = itinerary('Paris weekend');
    await upload(page, doc);
    const first = await savedDoc(page);
    await page.getByRole('button', { name: 'Close' }).click();

    await upload(page, doc, 'again.json');
    await expect(page.locator('#hverwarn')).toBeHidden();
    await expect(page.locator('#htname')).toContainText('Paris weekend');
    expect((await savedIndex(page))).toHaveLength(1);
    expect((await savedDoc(page)).rev).toBe(first.rev);
    expect(errors).toEqual([]);
  });

  test('an uploaded newer revision of a saved trip can replace it', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    const tripId = (await savedDoc(page)).trip_id;
    await page.getByRole('button', { name: 'Close' }).click();

    const theirs = itinerary('Paris weekend', { trip_id: tripId, rev: 4, updated_by: 'Sarah' });
    theirs.segments[0].name = 'A gig Sarah added';
    await upload(page, theirs, 'sarah.json');

    const warn = page.locator('#hverwarn');
    await expect(warn).toContainText('rev 4');
    await expect(warn).toContainText('rev 1');
    await warn.getByRole('button', { name: 'Replace' }).click();

    await expect(page.locator('#hvlist')).toContainText('A gig Sarah added');
    const saved = await savedDoc(page);
    expect(saved.rev).toBe(4); // an import is not renumbered
    expect(saved.trip_id).toBe(tripId);
    expect((await savedIndex(page))).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('a pre-library saved itinerary becomes the first library entry', async ({ page }) => {
    const legacy = itinerary('Paris weekend');
    await page.addInitScript(doc => {
      localStorage.setItem('hItinerary', JSON.stringify(doc));
    }, legacy);
    await page.goto('/holiday_itinerary_viewer.html');

    await expect(page.locator('#htname')).toContainText('Paris weekend');
    const saved = await savedDoc(page);
    expect(saved.trip_id).toMatch(/^trip-[0-9a-f]{16}$/); // derived, not minted
    expect(saved.rev).toBe(1);
    expect(saved.segments).toHaveLength(1);
    expect((await savedIndex(page)).map(e => e.name)).toEqual(['Paris weekend']);
    // The old value stays put as a backup for one release.
    expect(await page.evaluate(() => localStorage.getItem('hItinerary'))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('deleting a trip from the switcher takes only that trip', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'), 'paris.json');
    await page.getByRole('button', { name: 'Close' }).click();
    await upload(page, itinerary('Rome in spring'), 'rome.json');

    await switcher(page).click();
    const paris = rows(page).filter({ hasText: 'Paris weekend' });
    page.once('dialog', d => {
      expect(d.message()).toContain('Paris weekend');
      d.accept();
    });
    await paris.getByRole('button', { name: 'Delete this trip' }).click();

    await expect(rows(page)).toHaveCount(1);
    expect((await savedIndex(page)).map(e => e.name)).toEqual(['Rome in spring']);
    // The open trip is untouched by deleting another.
    await expect(page.locator('#htname')).toContainText('Rome in spring');
    expect(errors).toEqual([]);
  });

  test('forgetting everything clears the library and closes the trip', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    await switcher(page).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Forget all saved trips' }).click();

    await expect(page.locator('#hupl')).toBeVisible();
    await expect(page.locator('#hupl-recent')).toBeHidden();
    expect(await savedIndex(page)).toEqual([]);
    expect(await savedDoc(page)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('the label on saved changes is remembered and shown in the switcher', async ({ page }) => {
    await upload(page, itinerary('Paris weekend'));
    await switcher(page).click();
    await page.locator('#hlib-by').fill('Sarah');
    await page.locator('#hlib-by').blur();
    await page.locator('#hlib-hd button').click();

    await rename(page, 'Paris, renamed');
    expect((await savedDoc(page)).updated_by).toBe('Sarah');

    await switcher(page).click();
    await expect(rows(page).first()).toContainText('by Sarah');
    await expect(page.locator('#hlib-by')).toHaveValue('Sarah');
    expect(errors).toEqual([]);
  });
});
