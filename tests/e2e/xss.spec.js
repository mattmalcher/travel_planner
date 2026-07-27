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
    },
    {
      // Status values reach a badge's CSS class *and* its label, so they are
      // itinerary-supplied strings like any other. The schema pins them to an
      // enum — but "Load anyway" waives the schema, which is how this whole
      // fixture gets in, so an off-enum status does reach the badge.
      // The id is itinerary-supplied like everything else, and reaches the
      // Lists view's link chip — in a data attribute and, since issue #92, in
      // an aria-label too.
      id: `seg-4" onmouseover="window.__xss=(window.__xss||0)+1`,
      type: 'event',
      name: 'Badge breakout',
      subtype: 'activity',
      date: '2026-09-19',
      time: '09:00',
      cost: { amount: 5, currency: 'GBP', status: `paid ${IMG}` },
      proposal: { status: `suggested ${IMG}` }
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
        },
        {
          // A *live* promotion, so the chip takes the aria-label branch: the
          // id is itinerary-supplied and reaches an attribute there too
          // (issue #92).
          id: 'li-3',
          name: 'Break the label',
          segment_id: `seg-4" onmouseover="window.__xss=(window.__xss||0)+1`
        }
      ]
    }
  ],
  phrases: [
    {
      id: `phr-1 ${IMG}`,
      name: `Getting by ${IMG}`,
      language: `French ${IMG}`,
      kind: 'greetings',
      items: [
        {
          id: 'ph-1',
          text: `Hello ${IMG}`,
          local: `Bonjour ${IMG}`,
          pronunciation: `bon-ZHOOR ${IMG}`,
          note: `Note ${SCRIPT}`
        }
      ]
    }
  ]
};

/* This fixture can never be schema-valid — a javascript: url, ids with spaces
   in them, an off-enum status — and that is deliberate: escaping is the layer
   that has to hold when validation does not. Since ajv is compiled into the
   page (src/validate.js), the only way in is the one a real user has, so the
   upload goes through the warning's "Load anyway" button.

   That button is exactly the residual risk the escaping backstops, which makes
   this the right way to reach these views rather than a workaround. */
async function loadAnyway(page, doc) {
  await page.setInputFiles('#hfile', {
    name: 'xss.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc))
  });
  const warn = page.locator('#hverwarn');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('does not match the itinerary schema');
  await warn.getByRole('button', { name: 'Load anyway' }).click();
}

test.describe('Itinerary XSS escaping (issue #9)', () => {

  test('renders hostile strings literally without executing script', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e));

    await page.goto('/holiday_itinerary_viewer.html');
    await loadAnyway(page, xssItinerary);
    await expect(page.locator('#happ')).toBeVisible();

    // No injected <img>/<script> node should exist anywhere in the app.
    await expect(page.locator('#happ img[src="x"]')).toHaveCount(0);

    // Header shows the payload as literal text, not a broken element.
    await expect(page.locator('#htname')).toContainText(IMG);

    // Timeline keeps the payloads as text across transport/accommodation/event.
    await expect(page.locator('#hvlist')).toContainText(`Eurostar ${IMG}`);
    await expect(page.locator('#hvlist')).toContainText(`Studio ${IMG}`);
    await expect(page.locator('#hvlist')).toContainText(`Careful ${SCRIPT}`);

    // A javascript: url must be dropped; a valid https link is kept.
    await expect(page.locator('#hvlist a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.locator('#hvlist a[href="https://tickets.example/ok"]')).toHaveCount(1);

    // An off-enum status stays text inside the badge rather than closing its
    // class attribute and opening an element.
    await expect(page.locator('#hvlist .hbadge', { hasText: 'paid <img' })).toHaveCount(1);
    await expect(page.locator('#hvlist img[src="x"]')).toHaveCount(0);

    // Budget and map views render without executing anything either.
    await page.click('.htab[data-v="budget"]');
    await expect(page.locator('#hvbudget')).toContainText(`Studio ${IMG}`);
    await expect(page.locator('#hvbudget img[src="x"]')).toHaveCount(0);
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

    // The live promotion chip's aria-label holds the same hostile id: it must
    // land as the literal string in one attribute, not close it and open an
    // event handler (issue #92).
    const labelled = page.locator('#hvlists .hli', { hasText: 'Break the label' }).locator('.hli-chip');
    await expect(labelled).toHaveAttribute('aria-label',
      `Open seg-4" onmouseover="window.__xss=(window.__xss||0)+1 in itinerary`);
    expect(await labelled.getAttribute('onmouseover')).toBeNull();
    await labelled.hover();

    // Same sink on the Itinerary view's pencil, which names its segment.
    await page.click('.htab[data-v="list"]');
    await page.click('#hedit-toggle');
    await expect(page.locator('#hvlist .hpencil').first())
      .toHaveAttribute('aria-label', `Edit Eurostar ${IMG}`);
    await page.click('#hedit-toggle');

    // Phrases view (issue #75): every field on the card is itinerary-supplied,
    // including the language subtitle and the pronunciation line.
    await page.click('.htab[data-v="phrases"]');
    await expect(page.locator('#hvphrases')).toContainText(`Getting by ${IMG}`);
    await expect(page.locator('#hvphrases')).toContainText(`French ${IMG}`);
    await expect(page.locator('#hvphrases')).toContainText(`Bonjour ${IMG}`);
    await expect(page.locator('#hvphrases')).toContainText(`bon-ZHOOR ${IMG}`);
    await expect(page.locator('#hvphrases')).toContainText(`Note ${SCRIPT}`);
    await expect(page.locator('#hvphrases img[src="x"]')).toHaveCount(0);

    // The edit form (issue #65) puts itinerary strings into value attributes:
    // they must land as literal input values, not markup.
    await page.evaluate(() => globalThis.hOpenEdit(1));
    await expect(page.locator('#hedit-form img[src="x"]')).toHaveCount(0);
    await expect(page.locator('#hedit-form [data-p="name"]')).toHaveValue(`Studio ${IMG}`);
    await expect(page.locator('#hedit-form [data-p="address"]')).toHaveValue(`42 Rue ${IMG}`);
    await expect(page.locator('#hedit-form [data-p="notes"]')).toHaveValue(`Careful ${SCRIPT}`);
    await page.evaluate(() => globalThis.hCloseEdit());

    // The payloads never ran.
    const fired = await page.evaluate(() => globalThis.__xss || 0);
    expect(fired).toBe(0);
    expect(errors).toHaveLength(0);
  });
});
