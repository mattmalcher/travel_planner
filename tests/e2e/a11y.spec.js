// Keyboard access and focus visibility (issue #90). These two are the failures
// that lock people out rather than merely inconvenience them: five of the six
// views used to be pointer-only, and a focused control gave no visible sign of
// it. Scoped to the tab strip and the focus ring — the Map and Schedule views
// have their own, larger problems, and none of this is a conformance claim.
import { test, expect } from '@playwright/test';

const itinerary = {
  trip: {
    name: 'Keyboard Test Trip',
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
    { id: 'list-food', name: 'Foods to try', kind: 'food', items: [{ id: 'li-1', name: 'Custard tart' }] }
  ]
};

/** The strip's order, which the arrow keys walk. */
const ORDER = ['list', 'map', 'gantt', 'lists', 'phrases', 'budget'];

test.describe('keyboard access', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.setInputFiles('#hfile', {
      name: 'a11y.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(itinerary))
    });
    await expect(page.locator('#hvlist')).toBeVisible();
  });

  test('the tab strip is one tab stop, and arrows reach every view', async ({ page }) => {
    // Tab until the strip is reached — the roving tabindex means only the
    // selected tab is in the tab order, so this lands on Itinerary.
    for (let i = 0; i < 20; i++) {
      if (await page.locator('.htab[data-v="list"]').evaluate(el => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.locator('.htab[data-v="list"]')).toBeFocused();

    // Right arrow walks the strip, activating as it goes, and focus stays on
    // the strip so the next arrow keeps working.
    for (const v of ORDER.slice(1)) {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(`.htab[data-v="${v}"]`)).toBeFocused();
      await expect(page.locator(`.htab[data-v="${v}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#hv' + v)).toBeVisible();
    }
    // Lists — a view that was unreachable without a pointer — is real content.
    await page.keyboard.press('Home');
    await expect(page.locator('#hvlist')).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#hvlists')).toBeVisible();
    await expect(page.locator('#hvlists')).toContainText('Foods to try');

    // End/Home are the ends of the strip, and Right wraps from the last.
    await page.keyboard.press('End');
    await expect(page.locator('#hvbudget')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#hvlist')).toBeVisible();
  });

  test('exactly one tab is in the tab order, whichever is selected', async ({ page }) => {
    await page.click('.htab[data-v="budget"]');
    const idx = await page.locator('.htab').evaluateAll(els => els.map(e => e.tabIndex));
    expect(idx.filter(i => i === 0)).toHaveLength(1);
    await expect(page.locator('.htab[data-v="budget"]')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.htab[data-v="list"]')).toHaveAttribute('aria-selected', 'false');
  });

  test('each panel is labelled by its tab', async ({ page }) => {
    await expect(page.locator('.htabs')).toHaveAttribute('role', 'tablist');
    for (const v of ORDER) {
      await expect(page.locator(`.htab[data-v="${v}"]`)).toHaveAttribute('aria-controls', 'hv' + v);
      await expect(page.locator('#hv' + v)).toHaveAttribute('role', 'tabpanel');
      await expect(page.locator('#hv' + v)).toHaveAttribute('aria-labelledby', 'htab-' + v);
    }
  });

  test('a keyboard-focused input has a visible outline', async ({ page }) => {
    await page.click('.htab[data-v="lists"]');
    const input = page.locator('#hvlists .hli-add-in').first();
    await input.evaluate(el => el.focus());
    const style = await input.evaluate(el => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(style.style).not.toBe('none');
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
  });
});
