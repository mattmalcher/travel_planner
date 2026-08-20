// Upload validation guard (issue #15): uploaded files are checked against the
// declared schema_version and validated against the schema before loading,
// with a "load anyway" escape hatch.
//
// ajv and the schema are compiled into the page (src/validate.js), so these
// run against the real validator — hermetic without a stub, and testing the
// guard users actually get rather than a fake standing in for it.
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
      cost: { amount: 156.0, currency: "GBP", status: "paid", paid_by: "Judy Jetson" }
    }
  ]
};

// Same stub pattern as llm.spec.js: validation outcome is controlled by
// globalThis flags so the test drives ajv deterministically and offline.

/* Genuinely invalid rather than flagged invalid: the transport segment is
   missing `duration_min`, which its subschema requires, so ajv reports it
   at /segments/0. */
const invalidItinerary = {
  ...validItinerary,
  segments: [{ ...validItinerary.segments[0], duration_min: undefined }],
};

function uploadFile(page, doc) {
  return page.setInputFiles('#hfile', {
    name: 'itinerary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc))
  });
}

test.describe('Upload validation guard', () => {

  test('valid upload loads straight into the app', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, validItinerary);
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#hverwarn')).toBeHidden();
  });

  test('schema-invalid upload shows a warning and Load anyway proceeds', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, invalidItinerary);
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
    await page.goto('/holiday_itinerary_viewer.html');
    await uploadFile(page, invalidItinerary);
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
    // Download moved into the share sheet, with the other ways a copy of the
    // trip leaves this page.
    await page.locator('#happ button[title="Share this trip"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#hshare-body button', { hasText: 'Download JSON' }).click()
    ]);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    expect(doc.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.trip.name).toBe(validItinerary.trip.name);
  });
});
