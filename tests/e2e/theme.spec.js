// Dark mode (issue #95): the OS preference is the only control, so these run
// the same page twice under Playwright's colorScheme emulation and check that
// the palette actually flipped. The point is not the exact hexes — it is that
// nothing is left behind on a light surface, so the assertions are about
// *which* colour a surface takes from the tokens rather than a screenshot.
import { test, expect } from '@playwright/test';

const itinerary = {
  trip: {
    name: 'Night Train North',
    travellers: ['Judy Jetson', 'George Jetson'],
    start: '2026-09-18',
    end: '2026-09-20',
    currency_primary: 'GBP',
  },
  segments: [
    {
      id: 'seg-1',
      type: 'transport',
      mode: 'train',
      operator: 'Eurostar',
      date: '2026-09-18',
      departs: { place: "London St Pancras Int'l", time: '16:31', lat: 51.5322, lng: -0.1266 },
      arrives: { place: 'Paris Gare du Nord', time: '19:49', lat: 48.8809, lng: 2.3553 },
      duration_min: 138,
      cost: { amount: 156, currency: 'GBP', status: 'paid' },
    },
  ],
};

/** The computed value of a CSS custom property on :root. */
const token = (page, name) => page.evaluate(
  n => globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue(n).trim(), name);

const bg = locator => locator.evaluate(el => globalThis.getComputedStyle(el).backgroundColor);

/** Every visible element painting a near-white background — the light surfaces
    a dark palette is meant to have taken over. */
function lightSurfaces(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of globalThis.document.querySelectorAll('body *')) {
      // Laid out and painted: `display:none` subtrees are not on screen, and
      // the panels below open one at a time.
      if (!el.offsetParent) continue;
      // The current jump chip and the current form/JSON tab are inverted on
      // purpose: light pill, dark label, in both palettes.
      if (el.matches('.hjump-chip.on, .hedit-tab.on')) continue;
      const bgc = globalThis.getComputedStyle(el).backgroundColor;
      const m = bgc.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
      if (m && m.slice(1).every(v => Number(v) > 200)) out.push(`${el.id || el.className || el.tagName} ${bgc}`);
    }
    return out;
  });
}

async function load(page) {
  await page.goto('/holiday_itinerary_viewer.html');
  await page.setInputFiles('#hfile', {
    name: 'itinerary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(itinerary)),
  });
  await expect(page.locator('#happ')).toBeVisible();
}

test.describe('Dark mode follows the system preference', () => {
  test.describe('light', () => {
    test.use({ colorScheme: 'light' });

    test('keeps the light palette', async ({ page }) => {
      await load(page);
      expect(await bg(page.locator('body'))).toBe('rgb(248, 250, 252)');
      expect(await bg(page.locator('.hseg').first())).toBe('rgb(255, 255, 255)');
      expect(await token(page, '--map-tile-filter')).toBe('none');
      expect(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme)).toBe('light');
    });
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('darkens the page, the cards and the text', async ({ page }) => {
      await load(page);
      expect(await bg(page.locator('body'))).toBe('rgb(15, 23, 42)');
      expect(await bg(page.locator('.hseg').first())).toBe('rgb(28, 40, 60)');
      expect(await page.locator('body').evaluate(el => globalThis.getComputedStyle(el).color))
        .toBe('rgb(226, 232, 240)');
    });

    // color-scheme is what re-themes the controls the page never styles: the
    // header buttons, the file input, the native date/time pickers.
    test('hands the native controls over to the dark scheme', async ({ page }) => {
      await load(page);
      expect(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme)).toBe('dark');
    });

    // OSM serves one set of tiles; the dark map is that raster inverted, and
    // the filter must land on the tiles alone so the pins, the route line and
    // the popups above them keep their real colours. Leaflet itself comes
    // from a CDN and the tiles from OSM, so this asks the stylesheet rather
    // than a rendered map — the specs stay hermetic.
    test('inverts the map tiles and nothing above them', async ({ page }) => {
      await load(page);
      expect(await token(page, '--map-tile-filter')).not.toBe('none');
      const filters = await page.evaluate(() => {
        const doc = globalThis.document;
        const out = {};
        for (const cls of ['leaflet-tile', 'leaflet-marker-icon', 'leaflet-popup-content']) {
          const el = doc.createElement('div');
          el.className = cls;
          doc.body.appendChild(el);
          out[cls] = globalThis.getComputedStyle(el).filter;
          el.remove();
        }
        return out;
      });
      expect(filters['leaflet-tile']).toContain('invert');
      expect(filters['leaflet-marker-icon']).toBe('none');
      expect(filters['leaflet-popup-content']).toBe('none');
    });

    // Nothing may keep a hardcoded light surface: every themed colour comes
    // from the tokens, so a stray white background anywhere on screen means a
    // rule was written past them. Swept over the opening screen, the loaded
    // app and each of the panels that sits on top of it, since a modal is
    // exactly the sort of thing a palette change forgets.
    test('leaves no light surface behind', async ({ page }) => {
      await page.goto('/holiday_itinerary_viewer.html');
      expect(await lightSurfaces(page)).toEqual([]);

      await load(page);
      expect(await lightSurfaces(page)).toEqual([]);

      for (const [open, close, panel] of [
        ['hLibOpen', 'hLibClose', '#hlib-modal'],
        ['hSetOpen', 'hSetClose', '#hset-modal'],
        ['hChatOpen', 'hChatClose', '#hchat'],
      ]) {
        await page.evaluate(fn => globalThis[fn](), open);
        await expect(page.locator(panel)).toBeVisible();
        expect(await lightSurfaces(page)).toEqual([]);
        await page.evaluate(fn => globalThis[fn](), close);
      }
    });
  });
});
