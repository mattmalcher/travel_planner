// Issue #109: a url written into free prose — a segment note, a warning, a list
// item's note, a phrase's note — renders as a clickable link rather than text
// you have to select and copy. The rendering lives in lib/linkify.js (unit
// tested there); this spec is about the four surfaces being wired to it, and
// about the link surviving the views' wholesale re-render intact.
import { test, expect } from '@playwright/test';

const TIMETABLE = 'https://ter.sncf.com/aura/horaires';
const OPERATOR = 'https://transdev.example/ligne-6000';
const MARKET = 'https://market.example/hours';
const GREETING = 'https://pron.example/bonjour';

const linkItinerary = {
  trip: {
    name: 'Links Test Trip',
    travellers: ['Judy Jetson'],
    start: '2026-09-18',
    end: '2026-09-20',
    currency_primary: 'GBP'
  },
  segments: [
    {
      id: 'seg-1',
      type: 'transport',
      mode: 'train',
      operator: 'TER',
      date: '2026-09-18',
      departs: { place: 'Lyon Part-Dieu', time: '09:12' },
      arrives: { place: 'Grenoble', time: '10:35' },
      duration_min: 83,
      cost: { amount: 24, currency: 'GBP', status: 'paid', paid_by: 'Judy Jetson' },
      notes: `Fiche horaire at ${TIMETABLE} (checked 1 Aug).`,
      warnings: [`Sunday service is thinner — see ${OPERATOR}.`]
    }
  ],
  lists: [
    {
      id: 'list-1',
      name: 'Food',
      kind: 'food',
      items: [{ id: 'li-1', name: 'Covered market', note: `Opening times: ${MARKET}` }]
    }
  ],
  phrases: [
    {
      id: 'phr-1',
      name: 'Getting by',
      language: 'French',
      kind: 'greetings',
      items: [{ id: 'ph-1', text: 'Good morning', local: 'Bonjour', note: `Hear it: ${GREETING}` }]
    }
  ]
};

async function open(page) {
  await page.goto('/holiday_itinerary_viewer.html');
  await page.setInputFiles('#hfile', {
    name: 'links.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(linkItinerary))
  });
  await expect(page.locator('#happ')).toBeVisible();
}

test.describe('Links in prose (issue #109)', () => {

  test('a url in a segment note and a warning becomes an anchor', async ({ page }) => {
    await open(page);
    const note = page.locator(`#hvlist a.hlink[href="${TIMETABLE}"]`);
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(TIMETABLE);
    await expect(note).toHaveAttribute('rel', 'noopener');
    await expect(note).toHaveAttribute('target', '_blank');
    // The prose either side of it is still there, and the full stop after the
    // url did not get swallowed into the href.
    await expect(page.locator('#hvlist')).toContainText('Fiche horaire at');
    await expect(page.locator('#hvlist')).toContainText('(checked 1 Aug).');
    await expect(page.locator(`#hvlist .hwarn a.hlink[href="${OPERATOR}"]`)).toHaveCount(1);
  });

  test('a url in a list item note and a phrase note becomes an anchor', async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="lists"]');
    await expect(page.locator(`#hvlists .hli-note a.hlink[href="${MARKET}"]`)).toHaveCount(1);
    await page.click('.htab[data-v="phrases"]');
    await expect(page.locator(`#hvphrases .hph-note a.hlink[href="${GREETING}"]`)).toHaveCount(1);
  });

  test('the link survives a mutation that redraws the list', async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="lists"]');
    // Ticking an item rewrites the whole view's innerHTML (issue #93).
    await page.locator('#hvlists .hli', { hasText: 'Covered market' }).locator('input[type=checkbox]').check();
    await expect(page.locator(`#hvlists .hli-note a.hlink[href="${MARKET}"]`)).toHaveCount(1);
  });
});
