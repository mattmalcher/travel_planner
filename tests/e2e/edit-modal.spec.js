// Manual edit modal: schema validation of the edited value (issue #47) and
// the generated form that fronts the raw JSON textarea (issue #65).
//
// ajv and the schema are compiled into the page (src/validate.js), so validity
// is driven the way a user drives it — by typing a value the schema rejects
// into the JSON tab — rather than by a stub told to say no.
import { test, expect } from '@playwright/test';
import { savedDoc } from './library.js';

const baseItinerary = {
  trip: {
    name: "Summer Rail Tour 2026",
    travellers: ["Judy Jetson", "George Jetson"],
    start: "2026-09-18",
    end: "2026-09-28",
    currency_primary: "GBP"
  },
  segments: [
    {
      id: "seg-1",
      type: "transport",
      mode: "train",
      operator: "Eurostar",
      ref: "AB1234",
      date: "2026-09-18",
      departs: { place: "London St Pancras Int'l", time: "16:31" },
      arrives: { place: "Paris Gare du Nord", time: "19:49" },
      duration_min: 138,
      seats: [{ traveller: "Judy Jetson", coach: 5, seat: 41 }],
      cost: { amount: 156.0, currency: "GBP", status: "paid", paid_by: "Judy Jetson" }
    }
  ]
};


test.describe('JSON edit modal validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(itin => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidateSegment === 'function'");
  });

  /** Replace the open modal's value via its JSON tab. */
  async function editJson(page, change) {
    await page.click('#hedit-tab-json');
    const ta = page.locator('#hedit-ta');
    const value = JSON.parse(await ta.inputValue());
    change(value);
    await ta.fill(JSON.stringify(value, null, 2));
  }

  const save = page => page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

  test('schema-invalid segment edit is blocked with errors in the modal', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await expect(page.locator('#hedit-modal')).toBeVisible();
    await editJson(page, v => { v.date = 'the 18th'; }); // fails format: date
    await save(page);
    await expect(page.locator('#hedit-err')).toContainText('Schema:');
    await expect(page.locator('#hedit-err')).toContainText('/date');
    await expect(page.locator('#hedit-modal')).toBeVisible(); // save blocked

    // Once the value validates again, the same Save goes through.
    await editJson(page, v => { v.date = '2026-09-18'; });
    await save(page);
    await expect(page.locator('#hedit-modal')).toBeHidden();
  });

  test('trip edit is blocked by /trip schema errors', async ({ page }) => {
    await page.evaluate('hOpenEditTrip()');
    await editJson(page, v => { v.start = 'next Tuesday'; });
    await save(page);
    await expect(page.locator('#hedit-err')).toContainText('/trip/start');
    await expect(page.locator('#hedit-modal')).toBeVisible();
  });

  test('trip edit is not blocked by pre-existing segment errors elsewhere', async ({ page }) => {
    // A saved document is restored on boot without being revalidated, so an
    // itinerary with a broken segment is a state the app really reaches (it
    // was valid under an older schema, or came in via "Load anyway"). Editing
    // the trip must not be held hostage to a fault somewhere else in it.
    const broken = { ...baseItinerary, segments: [{ ...baseItinerary.segments[0] }] };
    delete broken.segments[0].duration_min;
    await page.addInitScript(itin => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
    }, broken);
    await page.reload();
    await expect(page.locator('#happ')).toBeVisible();

    await page.evaluate('hOpenEditTrip()');
    await editJson(page, v => { v.name = 'Renamed while a segment is broken'; });
    await save(page);
    await expect(page.locator('#hedit-modal')).toBeHidden();
    await expect(page.locator('#htname')).toContainText('Renamed while a segment is broken');
  });

  test('valid segment edit still saves and re-renders', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.click('#hedit-tab-json');
    const ta = page.locator('#hedit-ta');
    const edited = JSON.parse(await ta.inputValue());
    edited.operator = 'TGV Lyria';
    await ta.fill(JSON.stringify(edited, null, 2));
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
    await expect(page.locator('#hvlist')).toContainText('TGV Lyria');
  });

  test('invalid JSON still shows a parse error', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.click('#hedit-tab-json');
    await page.locator('#hedit-ta').fill('{ not json');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-err')).toContainText('Invalid JSON');
    await expect(page.locator('#hedit-modal')).toBeVisible();

    // …and it blocks the switch back to the form, which has nothing to show
    // for an unparseable value.
    await page.click('#hedit-tab-form');
    await expect(page.locator('#hedit-err')).toContainText('Invalid JSON');
    await expect(page.locator('#hedit-tab-json')).toHaveClass(/on/);
  });
});

/* --- the generated form (issue #65) --- */

test.describe('Edit modal form', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(itin => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');
    await expect(page.locator('#happ')).toBeVisible();
  });

  test('opens on the form, with schema-driven controls for the segment type', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await expect(page.locator('#hedit-form')).toBeVisible();
    await expect(page.locator('#hedit-ta')).toBeHidden();
    await expect(page.locator('#hedit-tab-form')).toHaveClass(/on/);

    // Values are prefilled from the segment, including nested paths.
    await expect(page.locator('#hedit-form [data-p="operator"]')).toHaveValue('Eurostar');
    await expect(page.locator('#hedit-form [data-p="departs.time"]')).toHaveValue('16:31');
    await expect(page.locator('#hedit-form [data-p="cost.amount"]')).toHaveValue('156');

    // Enums come from the schema as selects, dates/times as native pickers.
    const mode = page.locator('#hedit-form select[data-p="mode"]');
    expect(await mode.locator('option').allTextContents()).toEqual(
      ['train', 'bus', 'ferry', 'flight', 'taxi']);
    await expect(mode).toHaveValue('train');
    await expect(page.locator('#hedit-form [data-p="date"]')).toHaveAttribute('type', 'date');
    await expect(page.locator('#hedit-form [data-p="departs.time"]')).toHaveAttribute('type', 'time');

    // The whole point of the form: a field the JSON never mentioned is still
    // offered, empty and ready to fill (this segment has no service number).
    await expect(page.locator('#hedit-form [data-p="service"]')).toHaveValue('');
  });

  test('saves form edits, leaving fields it does not cover untouched', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.fill('#hedit-form [data-p="operator"]', 'TGV Lyria');
    await page.fill('#hedit-form [data-p="service"]', '9024');
    await page.selectOption('#hedit-form select[data-p="cost.status"]', 'pending');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#hedit-modal')).toBeHidden();
    await expect(page.locator('#hvlist')).toContainText('TGV Lyria');
    const seg = (await savedDoc(page)).segments[0];
    expect(seg.operator).toBe('TGV Lyria');
    expect(seg.service).toBe('9024');
    expect(seg.cost.status).toBe('pending');
    expect(seg.duration_min).toBe(138);        // number, not the string "138"
    expect(seg.seats).toEqual(baseItinerary.segments[0].seats); // not form-covered
  });

  test('clearing an optional field removes the key', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.fill('#hedit-form [data-p="ref"]', '');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    const seg = (await savedDoc(page)).segments[0];
    expect('ref' in seg).toBe(false);
  });

  test('form ⇄ JSON round-trips without losing anything', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.fill('#hedit-form [data-p="operator"]', 'TGV Lyria');

    // Form → JSON: the edit is there and so is everything the form can't show.
    await page.click('#hedit-tab-json');
    const viaJson = JSON.parse(await page.inputValue('#hedit-ta'));
    expect(viaJson.operator).toBe('TGV Lyria');
    expect(viaJson.seats).toEqual(baseItinerary.segments[0].seats);

    // JSON → form: an edit made as JSON shows up in the fields.
    await page.locator('#hedit-ta').fill(JSON.stringify({ ...viaJson, ref: 'ZZ9999' }, null, 2));
    await page.click('#hedit-tab-form');
    await expect(page.locator('#hedit-form [data-p="ref"]')).toHaveValue('ZZ9999');
    await expect(page.locator('#hedit-form [data-p="operator"]')).toHaveValue('TGV Lyria');

    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    const seg = (await savedDoc(page)).segments[0];
    expect(seg.ref).toBe('ZZ9999');
    expect(seg.seats).toEqual(baseItinerary.segments[0].seats);
  });

  test('names the fields only the JSON tab can reach', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await expect(page.locator('#hedit-form .hef-more')).toContainText('seats');
  });

  test('the trip editor gets its own fields', async ({ page }) => {
    await page.evaluate('hOpenEditTrip()');
    await expect(page.locator('#hedit-form [data-p="name"]')).toHaveValue('Summer Rail Tour 2026');
    await expect(page.locator('#hedit-form [data-p="travellers"]')).toHaveValue('Judy Jetson, George Jetson');
    await page.fill('#hedit-form [data-p="travellers"]', 'Judy Jetson, George Jetson, Elroy Jetson');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    const trip = (await savedDoc(page)).trip;
    expect(trip.travellers).toEqual(['Judy Jetson', 'George Jetson', 'Elroy Jetson']);
  });

  // The form must not pan sideways: with overflow-y:auto its other axis would
  // otherwise be a scroll container too, and a single overwide control turns
  // the whole panel into something that slides under a thumb.
  test('the form panel cannot be scrolled sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(() => globalThis.hload({
      trip: { name: 'T', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-19', currency_primary: 'GBP' },
      segments: [{
        id: 'seg-1', type: 'event', subtype: 'gig', name: 'Jazz', date: '2026-09-18',
        // No spaces to wrap at — the classic source of a stray overwide box.
        tickets_url: 'https://www.example-jazz-club.fr/evenements/2026/septembre/quartet-au-petit-exemple-billetterie-en-ligne?ref=itinerary-viewer',
        cost: { status: 'free' },
      }],
    }));
    await page.evaluate('hOpenEdit(0)');

    const room = await page.locator('#hedit-form').evaluate(el => {
      el.scrollLeft = 9999;          // as a sideways drag would
      const moved = el.scrollLeft;
      el.scrollLeft = 0;
      return moved;
    });
    expect(room).toBe(0);

    // Nothing was clipped to achieve that: the unbreakable URL wrapped.
    const url = page.locator('#hedit-form [data-p="tickets_url"]');
    expect(await url.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await url.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  });

  // A long value in a single-line <input> is only reachable by scrolling the
  // text sideways inside the field, which on a phone means reading an address
  // a third at a time. The wide fields wrap and grow instead.
  test('no field scrolls sideways on a phone, however long the value', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(() => globalThis.hload({
      trip: { name: 'Summer Rail Tour 2026', travellers: ['Judy Jetson', 'George Jetson', 'Elroy Jetson'], start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP' },
      segments: [{
        id: 'seg-1', type: 'accommodation',
        name: 'Cosy Studio near the Cathedral with the Long Name',
        host: 'Pierre', ref: 'XY9876Z',
        address: '42 Rue de l\'Exemple, Apartment 4B (third floor, blue door), 75018 Paris, France',
        lat: 48.8867, lng: 2.3431,
        checkin: { date: '2026-09-18', from: '14:00' },
        checkout: { date: '2026-09-19', by: '11:00' },
        self_checkin: true, cost: { status: 'free' },
      }],
    }));
    await page.evaluate('hOpenEdit(0)');

    const overflowing = await page.evaluate(() => [...globalThis.document.querySelectorAll('#hedit-form .hef-in')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.dataset.p));
    expect(overflowing).toEqual([]);

    // The long address wrapped onto more than one line rather than being cut off.
    const address = page.locator('#hedit-form [data-p="address"]');
    expect(await address.evaluate(el => el.tagName)).toBe('TEXTAREA');
    expect(await address.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(50);

    // …and the form as a whole still doesn't scroll sideways.
    const form = page.locator('#hedit-form');
    expect(await form.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  });

  test('a wrapping field still saves a single-line string', async ({ page }) => {
    await page.evaluate('hOpenEditTrip()');
    // Enter is swallowed in a wrapping field, and any newline that gets in
    // another way (paste, autofill) collapses on save.
    await page.locator('#hedit-form [data-p="name"]').fill('Summer\nRail Tour');
    await page.locator('#hedit-form [data-p="name"]').press('Enter');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    const trip = (await savedDoc(page)).trip;
    expect(trip.name).toBe('Summer Rail Tour');
  });

  test('a segment type the spec cannot describe stays JSON-only', async ({ page }) => {
    await page.evaluate(() => globalThis.hload({
      trip: { name: 'T', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-19', currency_primary: 'GBP' },
      segments: [{ id: 'seg-9', type: 'spaceflight', name: 'Orbit', date: '2026-09-18', cost: { status: 'free' } }],
    }));
    await page.evaluate('hOpenEdit(0)');
    await expect(page.locator('#hedit-tab-form')).toBeHidden();
    await expect(page.locator('#hedit-ta')).toBeVisible();
    expect(JSON.parse(await page.inputValue('#hedit-ta')).type).toBe('spaceflight');
  });
});
