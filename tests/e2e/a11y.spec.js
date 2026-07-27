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
      if (await page.locator('.htab[data-v="list"]').evaluate(el => el === globalThis.document.activeElement)) break;
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

  // WCAG 2.5.8 (issue #91). The unit test cannot see this one: the shortfall
  // was in what the browser computes from a font size and a padding, not in
  // anything written down. Every interactive control in a live view is swept,
  // so a new chip added without a min-height fails here rather than shipping
  // a 16px tap target.
  //
  // No spacing exception is granted: the rows these sit in are gap:8px flex
  // rows, so the chips are genuinely adjacent, and the toolbar buttons sit 8px
  // apart too. 23.5 rather than 24 is the .5px borders' rounding, not slack.
  test('every control clears the 24x24 minimum target size', async ({ page }) => {
    await page.click('#hedit-toggle'); // reveals the pencils and inline deletes
    const undersized = [];
    for (const v of ORDER) {
      await page.click(`.htab[data-v="${v}"]`);
      undersized.push(...await page.locator(`#hv${v} button, #hv${v} a, #happ > div:first-child button`)
        .evaluateAll(els => els.flatMap(el => {
          const r = el.getBoundingClientRect();
          if (!r.width) return []; // not rendered in this view
          return r.width < 23.5 || r.height < 23.5
            ? [`${el.className || el.tagName} "${(el.textContent || '').trim().slice(0, 20)}" `
              + `${r.width.toFixed(1)}x${r.height.toFixed(1)}`]
            : [];
        })));
    }
    expect(undersized).toEqual([]);
  });

  test('a keyboard-focused input has a visible outline', async ({ page }) => {
    await page.click('.htab[data-v="lists"]');
    const input = page.locator('#hvlists .hli-add-in').first();
    await input.evaluate(el => el.focus());
    const style = await input.evaluate(el => {
      const s = globalThis.getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(style.style).not.toBe('none');
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
  });
});

// Issue #92: the Itinerary and Lists views used to be structurally flat div
// soup, with every relationship carried by size, colour and position. These
// assert the semantics a screen reader actually navigates by — the heading
// outline, the list structure, and the computed accessible name of the
// controls (via getByRole, which goes through the same name computation a
// screen reader does, rather than reading the attribute back).
const semanticItinerary = {
  trip: {
    name: 'Semantics Test Trip',
    travellers: ['Judy Jetson'],
    start: '2026-09-18',
    end: '2026-09-19',
    currency_primary: 'GBP'
  },
  segments: [
    {
      id: 'seg-1',
      type: 'transport',
      mode: 'train',
      operator: 'Eurostar',
      date: '2026-09-18',
      departs: { place: 'London St Pancras', time: '16:31' },
      arrives: { place: 'Paris Gare du Nord', time: '19:49' },
      duration_min: 138,
      warnings: ['Check in 60 minutes before departure.'],
      cost: { amount: 100, currency: 'GBP', status: 'paid', paid_by: 'Judy Jetson' }
    },
    {
      id: 'seg-2',
      type: 'accommodation',
      name: 'Studio near the Canal',
      address: '42 Rue Exemple',
      phone: '+33 1 23 45 67 89',
      checkin: { date: '2026-09-18', from: '15:00' },
      checkout: { date: '2026-09-19', by: '11:00' },
      cost: { amount: 90, currency: 'GBP', status: 'pending', due: '2026-09-01' }
    },
    {
      id: 'seg-3',
      type: 'event',
      subtype: 'gig',
      name: 'Jazz at Le Petit Exemple',
      date: '2026-09-19',
      time: '20:30',
      cost: { amount: 40, currency: 'GBP', status: 'paid', paid_by: 'Judy Jetson' }
    }
  ],
  lists: [
    {
      id: 'list-food',
      name: 'Foods to try',
      kind: 'food',
      items: [
        { id: 'li-1', name: 'Custard tart' },
        { id: 'li-2', name: 'Jazz-club cocktail', segment_id: 'seg-3' },
        { id: 'li-3', name: 'Packed lunch', done: true }
      ]
    }
  ]
};

test.describe('semantics and accessible names (issue #92)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.setInputFiles('#hfile', {
      name: 'semantics.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(semanticItinerary))
    });
    await expect(page.locator('#hvlist')).toBeVisible();
  });

  test('the trip name is the page h1, and the opening screen has its own', async ({ page }) => {
    // Only one <h1> is ever rendered: the other screen is display:none, which
    // takes its heading out of the accessibility tree with it. (The opening
    // screen's is sr-only — clipped to 1px, so it counts as rendered.)
    await expect(page.locator('h1:visible')).toHaveText(['Semantics Test Trip']);

    await page.click('.htool[title^="Close this trip"]');
    await expect(page.locator('#hupl')).toBeVisible();
    await expect(page.locator('h1:visible')).toHaveText([/^Holiday itinerary viewer/]);
  });

  test('the Itinerary view has one h2 per day and one h3 per segment', async ({ page }) => {
    // Two days: 18 September (train + stay) and 19 September (the gig).
    await expect(page.locator('#hvlist h2')).toHaveCount(2);
    await expect(page.locator('#hvlist h2').first()).toContainText('18');
    await expect(page.locator('#hvlist h3')).toHaveCount(3);
    await expect(page.locator('#hvlist h3').first()).toHaveText('Eurostar');

    // Each day's segments are a real list, so a reader is told how many.
    const days = page.locator('#hvlist ul.hplain-list');
    await expect(days).toHaveCount(2);
    await expect(days.first().getByRole('listitem')).toHaveCount(2);
    await expect(days.nth(1).getByRole('listitem')).toHaveCount(1);
  });

  test('the Lists view names each list with an h2 and exposes a real list', async ({ page }) => {
    await page.click('.htab[data-v="lists"]');
    await expect(page.locator('#hvlists h2')).toHaveText(['Foods to try']);
    // The role is implicit on <ul>, but it is the whole point of the markup —
    // getByRole is what checks the browser really exposes it.
    const items = page.locator('#hvlists').getByRole('list');
    await expect(items).toHaveCount(1);
    await expect(items.getByRole('listitem')).toHaveCount(3);
  });

  test('the aria-hidden arrow does not take the relationship with it', async ({ page }) => {
    // The transport row is four values in a row; only the sr-only word says
    // which place is the origin and which the destination.
    await expect(page.locator('#hvlist .hseg').first())
      .toContainText('16:31 London St Pancras to Paris Gare du Nord 19:49');
  });

  test('a warning says it is a warning, and a phone number says it is one', async ({ page }) => {
    const warn = page.locator('#hvlist .hwarn');
    await expect(warn).toHaveAttribute('role', 'note');
    await expect(warn).toContainText('Warning: Check in 60 minutes before departure.');
    await expect(page.locator('#hvlist .hseg').nth(1)).toContainText('Phone: +33 1 23 45 67 89');
  });

  test('icon-only controls have accessible names that say which thing', async ({ page }) => {
    await page.click('#hedit-toggle'); // the pencils live behind edit mode
    // Three pencils on the page, each naming its own segment rather than all
    // three announcing "Edit segment".
    await expect(page.locator('#hvlist').getByRole('button', { name: 'Edit Eurostar' })).toHaveCount(1);
    await expect(page.locator('#hvlist').getByRole('button', { name: 'Edit Jazz at Le Petit Exemple' })).toHaveCount(1);

    await page.click('.htab[data-v="lists"]');
    await expect(page.locator('#hvlists').getByRole('button', { name: 'Edit list Foods to try' })).toHaveCount(1);
    // The promoted-segment chip announced as its bare id before this.
    await expect(page.locator('#hvlists').getByRole('button', { name: 'Open seg-3 in itinerary' })).toHaveCount(1);
    // The progress badge reads as "1 of 3 done", not "one slash three".
    await expect(page.locator('#hvlists').getByRole('img', { name: '1 of 3 done' })).toHaveCount(1);
    await expect(page.locator('#hvlists .hli-progress')).toHaveText('1/3'); // and looks unchanged
  });

  test('the jump strip is a labelled landmark and marks the current chip', async ({ page }) => {
    const nav = page.locator('#hvlist nav.hjump-nav');
    await expect(nav).toHaveAttribute('aria-label', 'Jump to day');
    // The scroll spy settles aria-current alongside the .on class, so state is
    // not conveyed by colour alone.
    await expect(nav.locator('.hjump-chip.on')).toHaveCount(1);
    await expect(nav.locator('.hjump-chip[aria-current="true"]')).toHaveCount(1);
    await expect(nav.locator('.hjump-chip.on')).toHaveAttribute('aria-current', 'true');
  });
});
