// Upload validation guard (issue #15): uploaded files are checked against the
// declared schema_version and validated with ajv before loading, with a
// "load anyway" escape hatch. Hermetic: ajv is stubbed so validation outcomes
// are driven deterministically via globalThis.__DOC_VALID__ / __ERRORS__.
import { test, expect } from '@playwright/test';

const validItinerary = {
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
      class: "Standard",
      cost: { amount: 156.0, currency: "GBP", status: "paid", paid_by: "Judy Jetson" }
    }
  ]
};

// Same stub pattern as llm.spec.js: validation outcome is controlled by
// globalThis flags so the test drives ajv deterministically and offline.
const AJV_STUB = `
export default class Ajv {
  constructor() {}
  compile(schema) {
    const flag = schema && schema.oneOf ? '__SEG_VALID__' : '__DOC_VALID__';
    function validate(data) {
      const ok = (globalThis[flag] !== false);
      validate.errors = ok ? null : (globalThis.__ERRORS__ || [{ instancePath: '/segments/0', message: 'stub: invalid', params: {} }]);
      return ok;
    }
    return validate;
  }
}
`;
const FMT_STUB = `export default function addFormats() {}`;

function uploadFile(page, doc) {
  return page.setInputFiles('#hfile', {
    name: 'itinerary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc))
  });
}

test.describe('Upload validation guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
  });

  test('valid upload loads straight into the app', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, validItinerary);
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#hverwarn')).toBeHidden();
  });

  test('schema-invalid upload shows a warning and Load anyway proceeds', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__DOC_VALID__ = false; });
    await page.goto('/holiday_itinerary_viewer.html');
    // wait for the (stubbed) validator to finish loading so the guard is live
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await uploadFile(page, validItinerary);
    const warn = page.locator('#hverwarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('does not match');
    await expect(warn).toContainText('/segments/0');
    await expect(page.locator('#happ')).toBeHidden();
    await warn.getByRole('button', { name: 'Load anyway' }).click();
    await expect(page.locator('#happ')).toBeVisible();
    await expect(warn).toBeHidden();
  });

  test('Cancel on an invalid upload keeps the upload screen', async ({ page }) => {
    await page.addInitScript(() => { globalThis.__DOC_VALID__ = false; });
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidate === 'function'");
    await uploadFile(page, validItinerary);
    await expect(page.locator('#hverwarn')).toBeVisible();
    await page.locator('#hverwarn').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#hverwarn')).toBeHidden();
    await expect(page.locator('#happ')).toBeHidden();
    await expect(page.locator('#hupl')).toBeVisible();
  });

  test('file declaring a different schema MAJOR shows the version guard', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, { schema_version: '1.0.0', ...validItinerary });
    const warn = page.locator('#hverwarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('different schema version');
    await expect(warn).toContainText('1.0.0');
    await expect(page.locator('#happ')).toBeHidden();
    await warn.getByRole('button', { name: 'Load anyway' }).click();
    await expect(page.locator('#happ')).toBeVisible();
  });

  test('download stamps the current schema_version into the document', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, validItinerary);
    await expect(page.locator('#happ')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button[title="Download JSON"]').click()
    ]);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    expect(doc.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.trip.name).toBe(validItinerary.trip.name);
  });
});
