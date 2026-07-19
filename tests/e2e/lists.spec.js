// Lists tab (issue #40): tick-off persistence, the promoted-segment link
// chip (and its dangling state), and promoting an item via "Schedule".
import { test, expect } from '@playwright/test';

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
const AJV_STUB = `
export default class Ajv {
  constructor() {}
  compile() {
    function validate() { validate.errors = null; return true; }
    return validate;
  }
}
`;
const FMT_STUB = `export default function addFormats() {}`;

test.describe('Lists view', () => {

  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
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

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hItinerary')));
    expect(saved.lists[0].items.find(i => i.id === 'li-1').done).toBe(true);
  });

  test('a promoted item links to its segment; a dangling one warns instead', async ({ page }) => {
    const food = page.locator('#hvlists .hseg').first();

    // Working link chip jumps to the segment's timeline card and flashes it.
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

    // The ordinary edit modal opens on a draft event prefilled from the item.
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);
    await expect(page.locator('#hedit-title')).toHaveText('Schedule: Custard tart');
    const draft = JSON.parse(await page.inputValue('#hedit-ta'));
    expect(draft.type).toBe('event');
    expect(draft.subtype).toBe('meal'); // food list → meal
    expect(draft.name).toBe('Custard tart');
    expect(draft.notes).toBe('From a proper bakery.');
    expect(draft.date).toBe('2026-09-18'); // trip start
    expect(draft.cost).toEqual({ status: 'not_booked' });
    await expect(page.locator('#hedit-del')).toBeHidden(); // nothing to delete yet

    await page.click('text=Save');
    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);

    // The segment exists on the timeline and the item now links to it.
    await expect(page.locator('#hvlist .hseg')).toHaveCount(2);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hItinerary')));
    expect(saved.segments).toHaveLength(2);
    const item = saved.lists[0].items.find(i => i.id === 'li-1');
    expect(item.segment_id).toBe(draft.id);
    await expect(food.locator('.hli', { hasText: 'Custard tart' }).locator('.hli-chip')).toContainText(draft.id);
  });
});
