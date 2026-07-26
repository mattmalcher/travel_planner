// Lists tab (issue #40): tick-off persistence, the promoted-segment link
// chip (and its dangling state), and promoting an item via "Schedule".
import { test, expect } from '@playwright/test';
import { savedDoc } from './library.js';

const listItinerary = {
  trip: {
    name: 'Lists Test Trip',
    travellers: ['Judy Jetson'],
    start: '2026-09-18',
    end: '2026-09-20',
    currency_primary: 'GBP'
  },
  segments: [
    {
      id: 'seg-1',
      type: 'event',
      subtype: 'gig',
      name: 'Jazz at Le Petit Exemple',
      date: '2026-09-19',
      time: '20:30',
      duration_min: 120,
      cost: { amount: 40, currency: 'GBP', status: 'paid', paid_by: 'Judy Jetson' }
    }
  ],
  lists: [
    {
      id: 'list-food',
      name: 'Foods to try',
      kind: 'food',
      items: [
        { id: 'li-1', name: 'Custard tart', local_name: 'Flan pâtissier', note: 'From a proper bakery.' },
        { id: 'li-2', name: 'Jazz-club cocktail', segment_id: 'seg-1' },
        { id: 'li-3', name: 'Lost dinner', segment_id: 'seg-gone' }
      ]
    },
    {
      id: 'list-packing',
      name: 'Packing',
      kind: 'packing',
      items: [{ id: 'li-4', name: 'Passports', done: true }]
    }
  ]
};

// Same ajv stub as viewer.spec.js: these tests exercise the view, not
// validation, and must not race the esm.sh import.

test.describe('Lists view', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.setInputFiles('#hfile', {
      name: 'lists.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(listItinerary))
    });
    await page.click('.htab[data-v="lists"]');
  });

  test('renders lists with progress counts and item detail', async ({ page }) => {
    await expect(page.locator('#hvlists')).toBeVisible();
    const cards = page.locator('#hvlists .hseg');
    await expect(cards).toHaveCount(2);

    const food = cards.first();
    await expect(food).toContainText('Foods to try');
    await expect(food.locator('.hli-progress')).toHaveText('0/3');
    await expect(food).toContainText('Custard tart');
    await expect(food).toContainText('Flan pâtissier');
    await expect(food).toContainText('From a proper bakery.');

    // The packing list is fully ticked and says so.
    await expect(cards.nth(1).locator('.hli-progress')).toHaveText('1/1');
    await expect(cards.nth(1).locator('.hli.done')).toContainText('Passports');
  });

  test('ticking an item off updates progress and persists to localStorage', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();
    await food.locator('.hli', { hasText: 'Custard tart' }).locator('input[type=checkbox]').check();

    await expect(food.locator('.hli-progress')).toHaveText('1/3');
    // Done items sink below the open ones with a strike-through.
    await expect(food.locator('.hli').last()).toContainText('Custard tart');
    await expect(food.locator('.hli.done')).toHaveCount(1);

    const saved = await savedDoc(page);
    expect(saved.lists[0].items.find(i => i.id === 'li-1').done).toBe(true);
  });

  test('a promoted item links to its segment; a dangling one warns instead', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();

    // Working link chip jumps to the segment's itinerary card and flashes it.
    await food.locator('.hli', { hasText: 'Jazz-club cocktail' }).locator('.hli-chip').click();
    await expect(page.locator('.htab[data-v="list"]')).toHaveClass(/on/);
    await expect(page.locator('#hvlist .hseg.hl')).toContainText('Jazz at Le Petit Exemple');

    // Dangling segment_id renders the broken style, not a link.
    await page.click('.htab[data-v="lists"]');
    const broken = food.locator('.hli', { hasText: 'Lost dinner' }).locator('.hli-chip.broken');
    await expect(broken).toBeVisible();
    await expect(broken).toContainText('seg-gone');
  });

  test('Schedule promotes an item into a prefilled event segment and back-links it', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();
    await food.locator('.hli', { hasText: 'Custard tart' }).getByRole('button', { name: /Schedule/ }).click();

    // The ordinary edit modal opens on a draft event prefilled from the item —
    // as a form (issue #65), so the fields to adjust are visible without
    // reading the schema.
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);
    await expect(page.locator('#hedit-title')).toHaveText('Schedule: Custard tart');
    await expect(page.locator('#hedit-form [data-p="name"]')).toHaveValue('Custard tart');
    await expect(page.locator('#hedit-form [data-p="date"]')).toHaveValue('2026-09-18');
    await expect(page.locator('#hedit-form [data-p="time"]')).toHaveValue('10:00');
    await expect(page.locator('#hedit-form [data-p="duration_min"]')).toHaveValue('120');

    await page.click('#hedit-tab-json');
    const draft = JSON.parse(await page.inputValue('#hedit-ta'));
    expect(draft.type).toBe('event');
    expect(draft.subtype).toBe('meal'); // food list → meal
    expect(draft.name).toBe('Custard tart');
    expect(draft.notes).toBe('From a proper bakery.');
    expect(draft.date).toBe('2026-09-18'); // trip start
    // time/duration are prefilled with the lib/dates.js defaults, so the draft
    // is schedulable as-is rather than needing every field filled in.
    expect(draft.time).toBe('10:00');
    expect(draft.duration_min).toBe(120);
    expect(draft.cost).toEqual({ status: 'not_booked' });
    await expect(page.locator('#hedit-del')).toBeHidden(); // nothing to delete yet

    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);

    // The segment exists on the itinerary and the item now links to it.
    await expect(page.locator('#hvlist .hseg')).toHaveCount(2);
    const saved = await savedDoc(page);
    expect(saved.segments).toHaveLength(2);
    const item = saved.lists[0].items.find(i => i.id === 'li-1');
    expect(item.segment_id).toBe(draft.id);
    await expect(food.locator('.hli', { hasText: 'Custard tart' }).locator('.hli-chip')).toContainText(draft.id);
  });
});

// Manual authoring (issue #72): adding is always available; everything that
// edits an existing list — the pencils (item detail fields, the list itself)
// and the per-item × (issue #69) — needs edit mode on, using the same
// .hedit-btn set the itinerary and trip header use.
test.describe('Editing lists by hand', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.setInputFiles('#hfile', {
      name: 'lists.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(listItinerary))
    });
    await page.click('.htab[data-v="lists"]');
  });

  test('adding is always available; the pencils wait for edit mode', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();
    // Add affordances are on without edit mode.
    await expect(food.locator('.hli-add')).toBeVisible();
    await expect(food.locator('.hli-add-in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
    // Editing or deleting an existing list or item still is not.
    await expect(food.getByRole('button', { name: 'Edit list' })).toBeHidden();
    await expect(food.locator('.hli').first().getByRole('button', { name: 'Edit item' })).toBeHidden();
    await expect(food.locator('.hli').first().getByRole('button', { name: 'Delete item' })).toBeHidden();

    await page.click('#hedit-toggle');
    await expect(food.getByRole('button', { name: 'Edit list' })).toBeVisible();
    await expect(food.locator('.hli').first().getByRole('button', { name: 'Edit item' })).toBeVisible();
    await expect(food.locator('.hli').first().getByRole('button', { name: 'Delete item' })).toBeVisible();
    // …and the add affordances are unaffected by the toggle.
    await expect(food.locator('.hli-add')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
  });

  test('quick-add appends an item and stays ready for the next one', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();
    const box = food.locator('.hli-add-in');

    // Enter adds without touching the button, and the box is cleared and
    // refocused so a run of items can be typed straight through.
    await box.fill('Croissant');
    await box.press('Enter');
    await expect(food.locator('.hli-progress')).toHaveText('0/4');
    await expect(food.locator('.hli').nth(3)).toContainText('Croissant');
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();

    // The Add button is the same action for pointer users.
    await box.fill('Espresso');
    await food.getByRole('button', { name: 'Add' }).click();
    await expect(food.locator('.hli-progress')).toHaveText('0/5');

    // Blank input adds nothing.
    await box.press('Enter');
    await expect(food.locator('.hli-progress')).toHaveText('0/5');

    const saved = await savedDoc(page);
    const added = saved.lists[0].items.slice(-2);
    expect(added.map(i => i.name)).toEqual(['Croissant', 'Espresso']);
    // Ids are assigned, unique across the document, and nothing else is invented.
    expect(Object.keys(added[0]).sort()).toEqual(['id', 'name']);
    const ids = saved.lists.flatMap(l => l.items.map(i => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the item pencil opens the form for the detail fields', async ({ page }) => {
    await page.click('#hedit-toggle');
    const food = page.locator('#hvlists .hseg').first();
    await food.locator('.hli', { hasText: 'Custard tart' }).getByRole('button', { name: 'Edit item' }).click();

    await expect(page.locator('#hedit-title')).toHaveText('Edit: Custard tart');
    await expect(page.locator('#hedit-form [data-p="name"]')).toHaveValue('Custard tart');
    await expect(page.locator('#hedit-form [data-p="local_name"]')).toHaveValue('Flan pâtissier');
    await expect(page.locator('#hedit-form [data-p="note"]')).toHaveValue('From a proper bakery.');

    await page.fill('#hedit-form [data-p="local_name"]', 'Pastel de nata');
    await page.fill('#hedit-form [data-p="url"]', 'https://example.com/tart');
    await page.locator('#hedit-form [data-p="done"]').check();
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);
    await expect(food.locator('.hli-progress')).toHaveText('1/3');
    const row = food.locator('.hli', { hasText: 'Custard tart' });
    await expect(row).toHaveClass(/done/);
    await expect(row).toContainText('Pastel de nata');

    const saved = await savedDoc(page);
    const item = saved.lists[0].items.find(i => i.id === 'li-1');
    expect(item).toMatchObject({ id: 'li-1', local_name: 'Pastel de nata', url: 'https://example.com/tart', done: true });
  });

  test('an item can be deleted; the segment it was scheduled into survives', async ({ page }) => {
    await page.click('#hedit-toggle');
    const food = page.locator('#hvlists .hseg').first();
    const row = food.locator('.hli', { hasText: 'Jazz-club cocktail' });
    await row.getByRole('button', { name: 'Edit item' }).click();

    // Dismissing the confirm changes nothing.
    page.once('dialog', d => d.dismiss());
    await page.click('#hedit-del');
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);

    page.once('dialog', d => {
      expect(d.message()).toContain('stays on the itinerary');
      d.accept();
    });
    await page.click('#hedit-del');
    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);
    await expect(food.locator('.hli-progress')).toHaveText('0/2');

    const saved = await savedDoc(page);
    expect(saved.lists[0].items.map(i => i.id)).toEqual(['li-1', 'li-3']);
    expect(saved.segments).toHaveLength(1); // the promoted segment is untouched
  });

  test('the × deletes an item straight away, and Undo puts it back (issue #69)', async ({ page }) => {
    await page.click('#hedit-toggle');
    const food = page.locator('#hvlists .hseg').first();
    const row = food.locator('.hli', { hasText: 'Custard tart' });

    // One click, no confirm and no modal — the Undo below the list is the
    // safety net.
    await row.getByRole('button', { name: 'Delete item' }).click();
    await expect(food.locator('.hli-progress')).toHaveText('0/2');
    await expect(food.locator('.hli', { hasText: 'Custard tart' })).toHaveCount(0);
    let saved = await savedDoc(page);
    expect(saved.lists[0].items.map(i => i.id)).toEqual(['li-2', 'li-3']);

    // The undo offer sits in the list the item came from, and restores it in
    // place with everything it held.
    const undo = food.locator('.hli-undo');
    await expect(undo).toContainText('Custard tart');
    await expect(page.locator('#hvlists .hli-undo')).toHaveCount(1);
    await undo.getByRole('button', { name: 'Undo' }).click();

    await expect(food.locator('.hli-progress')).toHaveText('0/3');
    await expect(food.locator('.hli').first()).toContainText('Custard tart');
    await expect(food.locator('.hli-undo')).toHaveCount(0);
    saved = await savedDoc(page);
    expect(saved.lists[0].items[0]).toMatchObject({
      id: 'li-1', name: 'Custard tart', local_name: 'Flan pâtissier', note: 'From a proper bakery.'
    });
  });

  test('deleting a promoted item leaves its segment alone; the next change retires the undo', async ({ page }) => {
    await page.click('#hedit-toggle');
    const food = page.locator('#hvlists .hseg').first();
    await food.locator('.hli', { hasText: 'Jazz-club cocktail' })
      .getByRole('button', { name: 'Delete item' }).click();
    await expect(food.locator('.hli-undo')).toBeVisible();

    // The segment it was scheduled into is a segment now — untouched.
    await expect(page.locator('#hvlist .hseg')).toHaveCount(1);

    // Adding an item is a new action, so the stale undo goes away.
    await food.locator('.hli-add-in').fill('Croissant');
    await food.locator('.hli-add-in').press('Enter');
    await expect(food.locator('.hli-undo')).toHaveCount(0);

    const saved = await savedDoc(page);
    expect(saved.lists[0].items.map(i => i.name)).toEqual(['Custard tart', 'Lost dinner', 'Croissant']);
    expect(saved.segments).toHaveLength(1);
  });

  test('the jump strip scrolls to a list and tracks the one in view (issue #69)', async ({ page }) => {
    const chips = page.locator('#hvlists .hjump-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('Foods to try');
    await expect(chips.nth(1)).toContainText('Packing');

    // Long lists, so the second one has somewhere to be scrolled to and the
    // strip earns its keep.
    const long = structuredClone(listItinerary);
    // Its own trip_id, so uploading it is a second trip in the library rather
    // than a divergent copy of the seeded one (issue #80).
    long.trip_id = 'trip-long-lists';
    long.lists[0].items = Array.from({ length: 20 }, (_, i) => ({ id: `li-a${i}`, name: `Snack ${i}` }));
    long.lists[1].items = Array.from({ length: 40 }, (_, i) => ({ id: `li-b${i}`, name: `Sock ${i}` }));
    await page.setInputFiles('#hfile', {
      name: 'long_lists.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(long))
    });
    await page.click('.htab[data-v="lists"]');

    await chips.nth(1).click();
    await expect.poll(() => page.locator('#hvlists .hjump-a[data-k="1"]')
      .evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(120);
    expect(await page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(200);

    // The scroll-spy marks the list now under the strip.
    await expect(chips.nth(1)).toHaveClass(/on/);
    await expect(chips.nth(0)).not.toHaveClass(/on/);
  });

  test('a list can be renamed, re-kinded and deleted without losing its items', async ({ page }) => {
    await page.click('#hedit-toggle');
    const food = page.locator('#hvlists .hseg').first();
    await food.getByRole('button', { name: 'Edit list' }).click();

    await expect(page.locator('#hedit-title')).toHaveText('Edit list: Foods to try');
    await page.fill('#hedit-form [data-p="name"]', 'Snacks to find');
    await page.selectOption('#hedit-form [data-p="kind"]', 'restaurant');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    await expect(food).toContainText('Snacks to find');
    await expect(food.locator('.hli-progress')).toHaveText('0/3'); // items intact
    let saved = await savedDoc(page);
    expect(saved.lists[0]).toMatchObject({ id: 'list-food', name: 'Snacks to find', kind: 'restaurant' });
    expect(saved.lists[0].items).toHaveLength(3);

    // Deleting takes the whole list with its items.
    await food.getByRole('button', { name: 'Edit list' }).click();
    page.once('dialog', d => {
      expect(d.message()).toContain('3 items');
      d.accept();
    });
    await page.click('#hedit-del');
    await expect(page.locator('#hvlists .hseg')).toHaveCount(1);
    saved = await savedDoc(page);
    expect(saved.lists.map(l => l.id)).toEqual(['list-packing']);
  });

  test('an itinerary with no lists can grow its first one', async ({ page }) => {
    const bare = structuredClone(listItinerary);
    bare.trip_id = 'trip-no-lists'; // a separate trip, not a fork of the seeded one
    delete bare.lists;
    await page.setInputFiles('#hfile', {
      name: 'no-lists.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bare))
    });
    await page.click('.htab[data-v="lists"]');
    await expect(page.locator('#hvlists')).toContainText('No lists yet');

    await page.getByRole('button', { name: 'New list' }).click();
    await page.fill('#hedit-form [data-p="name"]', 'Packing');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    const list = page.locator('#hvlists .hseg').first();
    await expect(list).toContainText('Packing');
    await list.locator('.hli-add-in').fill('Passports');
    await list.locator('.hli-add-in').press('Enter');

    const saved = await savedDoc(page);
    expect(saved.lists).toHaveLength(1);
    expect(saved.lists[0].items[0].name).toBe('Passports');
  });

  test('New list creates one, ready to take items', async ({ page }) => {
    await page.getByRole('button', { name: 'New list' }).click();
    await expect(page.locator('#hedit-title')).toHaveText('New list');
    await expect(page.locator('#hedit-del')).toBeHidden(); // nothing to delete yet

    await page.fill('#hedit-form [data-p="name"]', 'Sights');
    await page.selectOption('#hedit-form [data-p="kind"]', 'sight');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    const added = page.locator('#hvlists .hseg').nth(2);
    await expect(added).toContainText('Sights');
    await expect(added.locator('.hli-progress')).toHaveText('0/0');

    await added.locator('.hli-add-in').fill('Miradouro');
    await added.locator('.hli-add-in').press('Enter');
    await expect(added.locator('.hli-progress')).toHaveText('0/1');

    const saved = await savedDoc(page);
    const list = saved.lists[2];
    expect(list).toMatchObject({ name: 'Sights', kind: 'sight' });
    expect(list.id).toMatch(/^list-.{5}$/); // assigned, not typed
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('Miradouro');
  });
});
