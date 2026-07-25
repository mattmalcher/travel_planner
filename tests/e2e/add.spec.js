// Adding the top-level things by hand (issue #76): starting an itinerary from
// scratch on the upload screen, and adding segments to it from the Itinerary
// tab — both without a file and without the AI assistant.
//
// Hermetic like edit-modal.spec.js: ajv is stubbed and validity is driven from
// __SEG_VALID__ / __DOC_VALID__, so these tests exercise the flows rather than
// racing the esm.sh import. What the drafts actually leave for the schema to
// reject is covered by tests/unit/drafts.test.js.
import { test, expect } from '@playwright/test';
import { savedDoc, savedIndex } from './library.js';

const AJV_STUB = `
// The app validates a segment against the ONE subschema its type names, and
// falls back to the oneOf only for an unknown type (issue #76) — so a segment
// validator is either shape.
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

const field = (page, path) => page.locator(`#hedit-form [data-p="${path}"]`);
const save = page => page.locator('#hedit-ft').getByRole('button', { name: 'Save' });

/** Fill in the from-scratch trip form and save it. */
async function startFromScratch(page, { name = 'Weekend in Paris', start = '2026-09-18', end = '2026-09-20' } = {}) {
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await expect(page.locator('#hedit-modal')).toBeVisible();
  await field(page, 'name').fill(name);
  await field(page, 'travellers').fill('Judy Jetson, George Jetson');
  await field(page, 'start').fill(start);
  await field(page, 'end').fill(end);
  await save(page).click();
  await expect(page.locator('#hedit-modal')).toBeHidden();
}

test.describe('Adding by hand', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidateTrip === 'function'");
  });

  test('starts an itinerary from scratch, with no file and no AI', async ({ page }) => {
    await expect(page.locator('#hupl')).toBeVisible();
    await startFromScratch(page);

    await expect(page.locator('#hupl')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#htname')).toContainText('Weekend in Paris');
    // Every view has to cope with a document that has nothing in it yet.
    await expect(page.locator('#hvlist')).toContainText('Nothing planned yet');
    for (const tab of ['budget', 'gantt', 'lists', 'map']) {
      await page.locator(`.htab[data-v="${tab}"]`).click();
      await expect(page.locator('#hv' + tab)).toBeVisible();
    }
    expect(errors).toEqual([]);

    // It is the saved itinerary from here on, like any loaded file.
    const saved = await savedDoc(page);
    expect(saved.trip.name).toBe('Weekend in Paris');
    expect(saved.trip.travellers).toEqual(['Judy Jetson', 'George Jetson']);
    expect(saved.segments).toEqual([]);
    await page.reload();
    await expect(page.locator('#htname')).toContainText('Weekend in Paris');
  });

  test('a schema-invalid trip is refused, and the app is not created', async ({ page }) => {
    await page.evaluate("globalThis.__DOC_VALID__ = false; globalThis.__ERRORS__ = [{ instancePath: '/travellers', message: 'must NOT have fewer than 1 items', params: {} }]");
    await page.getByRole('button', { name: 'Start from scratch' }).click();
    await save(page).click();
    await expect(page.locator('#hedit-err')).toContainText('/travellers');
    await expect(page.locator('#hedit-modal')).toBeVisible();
    await expect(page.locator('#hupl')).toBeVisible();
    await expect(page.locator('#happ')).toBeHidden();

    // Cancelling leaves the upload screen exactly as it was.
    await page.locator('#hedit-ft').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
    await expect(page.locator('#hupl')).toBeVisible();
    expect(await savedDoc(page)).toBeNull();
    expect(await savedIndex(page)).toEqual([]);
  });

  test('adds an event to the itinerary from the add row', async ({ page }) => {
    await startFromScratch(page);
    await page.locator('#hvlist .hadd').getByRole('button', { name: 'Event' }).click();
    await expect(page.locator('#hedit-title')).toHaveText('New event');
    // The draft opens prefilled with the trip's first day and the default
    // event time, and with nothing invented for the name.
    await expect(field(page, 'date')).toHaveValue('2026-09-18');
    await expect(field(page, 'time')).toHaveValue('10:00');
    await expect(field(page, 'name')).toHaveValue('');
    // Nothing to delete on something that does not exist yet.
    await expect(page.locator('#hedit-del')).toBeHidden();

    await field(page, 'name').fill('Jazz at Le Petit Exemple');
    await field(page, 'date').fill('2026-09-19');
    await save(page).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();

    await expect(page.locator('#hvlist')).toContainText('Jazz at Le Petit Exemple');
    await expect(page.locator('#hvlist')).not.toContainText('Nothing planned yet');
    await expect(page.locator('#hvbudget')).toContainText('Jazz at Le Petit Exemple');

    const segs = (await savedDoc(page)).segments;
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('event');
    expect(segs[0].cost).toEqual({ status: 'not_booked' });
    expect(segs[0].id).toMatch(/^seg-.{5}$/);
    expect(errors).toEqual([]);
  });

  test('adds travel and a stay, and each keeps its own id', async ({ page }) => {
    await startFromScratch(page);

    await page.locator('#hvlist .hadd').getByRole('button', { name: 'Travel' }).click();
    await expect(page.locator('#hedit-title')).toHaveText('New travel');
    await expect(field(page, 'mode')).toHaveValue('train');
    await field(page, 'operator').fill('Eurostar');
    await field(page, 'departs.place').fill('London St Pancras');
    await field(page, 'arrives.place').fill('Paris Gare du Nord');
    await save(page).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();

    // A stay added by hand has no coordinates and no booking reference — both
    // optional since schema 3.2.0 — so neither is shown rather than shown blank.
    await page.locator('#hvlist .hadd').getByRole('button', { name: 'Stay' }).click();
    await expect(page.locator('#hedit-title')).toHaveText('New stay');
    await expect(field(page, 'checkin.date')).toHaveValue('2026-09-18');
    await expect(field(page, 'checkout.date')).toHaveValue('2026-09-20');
    await field(page, 'name').fill('Cosy Studio near Sacré-Cœur');
    await field(page, 'address').fill('42 Rue de l\'Exemple, Paris');
    await save(page).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();

    await expect(page.locator('#hvlist')).toContainText('London St Pancras');
    await expect(page.locator('#hvlist')).toContainText('Cosy Studio near Sacré-Cœur');
    await expect(page.locator('#hvlist')).toContainText('2 nights');
    await expect(page.locator('#hvlist')).not.toContainText('Host:');
    await expect(page.locator('#hvlist')).not.toContainText('Ref:');

    const doc = await savedDoc(page);
    expect(doc.segments).toHaveLength(2);
    expect(new Set(doc.segments.map(s => s.id)).size).toBe(2);
    // Only a draft promoted from a list item gets linked back to one.
    expect(doc.lists).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a schema-invalid new segment is refused and nothing is added', async ({ page }) => {
    await startFromScratch(page);
    await page.evaluate("globalThis.__SEG_VALID__ = false; globalThis.__ERRORS__ = [{ instancePath: '/', message: \"must have required property 'name'\", params: {} }]");
    await page.locator('#hvlist .hadd').getByRole('button', { name: 'Event' }).click();
    await save(page).click();
    await expect(page.locator('#hedit-err')).toContainText("required property 'name'");
    await expect(page.locator('#hedit-modal')).toBeVisible();
    expect((await savedDoc(page)).segments).toEqual([]);

    await page.evaluate('globalThis.__SEG_VALID__ = true');
    await field(page, 'name').fill('Jazz at Le Petit Exemple');
    await save(page).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
    expect((await savedDoc(page)).segments).toHaveLength(1);
  });

  test('the add row is on an existing itinerary too, without edit mode', async ({ page }) => {
    await startFromScratch(page);
    // The pencils are behind the edit toggle; adding never is.
    await expect(page.locator('#hvlist .hadd')).toBeVisible();
    await expect(page.locator('#happ')).not.toHaveClass(/hedit-on/);
    for (const label of ['Travel', 'Stay', 'Event'])
      await expect(page.locator('#hvlist .hadd').getByRole('button', { name: label })).toBeVisible();
  });
});
