import { test, expect } from '@playwright/test';

// Issue #9: itinerary strings (shared between travellers, written by an LLM)
// must be escaped before hitting innerHTML, or a crafted name/notes/venue can
// run script and exfiltrate the OpenRouter key from localStorage.
const IMG = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
const SCRIPT = '<script>window.__xss=(window.__xss||0)+1</script>';

const xssItinerary = {
  trip: {
    name: `Trip ${IMG}`,
    travellers: [`Judy ${IMG}`, 'George Jetson'],
    start: '2026-09-18',
    end: '2026-09-20',
    currency_primary: 'GBP'
  },
  segments: [
    {
      id: 'seg-1',
      type: 'transport',
      mode: 'train',
      operator: `Eurostar ${IMG}`,
      ref: `REF ${IMG}`,
      date: '2026-09-18',
      departs: { place: `London ${IMG}`, time: '16:31' },
      arrives: { place: 'Paris Nord', time: '19:49' },
      duration_min: 138,
      cost: { amount: 100, currency: 'GBP', status: 'paid', paid_by: 'Judy' }
    },
    {
      id: 'seg-2',
      type: 'accommodation',
      name: `Studio ${IMG}`,
      host: `Pierre ${IMG}`,
      ref: 'XY9876Z',
      address: `42 Rue ${IMG}`,
      lat: 48.8566,
      lng: 2.3522,
      checkin: { date: '2026-09-18', from: '13:00' },
      checkout: { date: '2026-09-19', by: '13:00' },
      cost: { amount: 87.24, currency: 'GBP', status: 'pending', due: '2026-09-01' },
      notes: `Careful ${SCRIPT}`
    },
    {
      id: 'seg-3',
      type: 'event',
      name: `Gig ${IMG}`,
      subtype: 'gig',
      venue: `Arena ${IMG}`,
      date: '2026-09-19',
      time: '20:00',
      lat: 48.86,
      lng: 2.35,
      url: 'javascript:window.__xss=(window.__xss||0)+1',
      tickets_url: 'https://tickets.example/ok',
      cost: { amount: 40, currency: 'GBP', status: 'pending', due: '2026-09-05' }
    }
  ],
  lists: [
    {
      id: `list-1 ${IMG}`,
      name: `Foods ${IMG}`,
      kind: 'food',
      items: [
        {
          id: 'li-1',
          name: `Tart ${IMG}`,
          local_name: `Nata ${IMG}`,
          note: `Note ${SCRIPT}`,
          url: 'javascript:window.__xss=(window.__xss||0)+1'
        },
        {
          id: 'li-2',
          name: 'Break the chip',
          // Rides in an onclick-adjacent data attribute — must not escape it.
          segment_id: `seg-1'); window.__xss=(window.__xss||0)+1;('`
        }
      ]
    }
  ]
};

// Same stub pattern as upload.spec.js: this spec is about escaping, not
// validation, so ajv is stubbed (always valid) to keep the test hermetic —
// otherwise the outcome depends on whether esm.sh loads before the upload,
// and the hostile fixture (javascript: url) can never be schema-valid.
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

test.describe('Itinerary XSS escaping (issue #9)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
  });

  test('renders hostile strings literally without executing script', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e));

    await page.goto('/holiday_itinerary_viewer.html');
    await page.setInputFiles('#hfile', {
      name: 'xss.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(xssItinerary))
    });
    await expect(page.locator('#happ')).toBeVisible();

    // No injected <img>/<script> node should exist anywhere in the app.
    await expect(page.locator('#happ img[src="x"]')).toHaveCount(0);

    // Header shows the payload as literal text, not a broken element.
    await expect(page.locator('#htname')).toContainText(IMG);
    await expect(page.locator('#htmeta')).toContainText(IMG);

    // Timeline keeps the payloads as text across transport/accommodation/event.
    await expect(page.locator('#hvlist')).toContainText(`Eurostar ${IMG}`);
    await expect(page.locator('#hvlist')).toContainText(`Studio ${IMG}`);
    await expect(page.locator('#hvlist')).toContainText(`Careful ${SCRIPT}`);

    // A javascript: url must be dropped; a valid https link is kept.
    await expect(page.locator('#hvlist a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.locator('#hvlist a[href="https://tickets.example/ok"]')).toHaveCount(1);

    // Budget and map views render without executing anything either.
    await page.click('.htab[data-v="budget"]');
    await expect(page.locator('#hvbudget')).toContainText(`Studio ${IMG}`);
    await page.click('.htab[data-v="map"]');
    await expect(page.locator('#hvmap img[src="x"]')).toHaveCount(0);

    // Lists view (issue #40): payloads stay literal, the javascript: item url
    // is dropped, and a quote-laden segment_id can't break out of the chip's
    // onclick (it renders as the dangling-link chip, which never runs JS).
    await page.click('.htab[data-v="lists"]');
    await expect(page.locator('#hvlists')).toContainText(`Foods ${IMG}`);
    await expect(page.locator('#hvlists')).toContainText(`Tart ${IMG}`);
    await expect(page.locator('#hvlists')).toContainText(`Note ${SCRIPT}`);
    await expect(page.locator('#hvlists img[src="x"]')).toHaveCount(0);
    await expect(page.locator('#hvlists a[href^="javascript:"]')).toHaveCount(0);
    await page.locator('#hvlists .hli', { hasText: 'Break the chip' }).locator('.hli-chip').click();

    // The payloads never ran.
    const fired = await page.evaluate(() => globalThis.__xss || 0);
    expect(fired).toBe(0);
    expect(errors).toHaveLength(0);
  });
});
