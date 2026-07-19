// Manual JSON edit modal validation (issue #47): saveEdit must run the edited
// value through the schema validators before committing, blocking the save and
// showing errors in #hedit-err. Hermetic: ajv is stubbed (same pattern as
// llm.spec.js) so validity is driven via __SEG_VALID__ / __DOC_VALID__ /
// __ERRORS__ globals.
import { test, expect } from '@playwright/test';

const baseItinerary = {
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

test.describe('JSON edit modal validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
    await page.addInitScript(itin => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');
    await page.waitForFunction("typeof window.hValidateSegment === 'function'");
  });

  test('schema-invalid segment edit is blocked with errors in the modal', async ({ page }) => {
    await page.evaluate("globalThis.__SEG_VALID__ = false; globalThis.__ERRORS__ = [{ instancePath: '/date', message: 'must match format \"date\"', params: {} }]");
    await page.evaluate('hOpenEdit(0)');
    await expect(page.locator('#hedit-modal')).toBeVisible();
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-err')).toContainText('Schema:');
    await expect(page.locator('#hedit-err')).toContainText('/date');
    await expect(page.locator('#hedit-modal')).toBeVisible(); // save blocked

    // Once the value validates again, the same Save goes through.
    await page.evaluate('globalThis.__SEG_VALID__ = true');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
  });

  test('trip edit is blocked by /trip schema errors', async ({ page }) => {
    await page.evaluate("globalThis.__DOC_VALID__ = false; globalThis.__ERRORS__ = [{ instancePath: '/trip/start', message: 'must match format \"date\"', params: {} }]");
    await page.evaluate('hOpenEditTrip()');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-err')).toContainText('/trip/start');
    await expect(page.locator('#hedit-modal')).toBeVisible();
  });

  test('trip edit is not blocked by pre-existing segment errors elsewhere', async ({ page }) => {
    await page.evaluate("globalThis.__DOC_VALID__ = false; globalThis.__ERRORS__ = [{ instancePath: '/segments/0/cost', message: 'stub: invalid', params: {} }]");
    await page.evaluate('hOpenEditTrip()');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
  });

  test('valid segment edit still saves and re-renders', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    const ta = page.locator('#hedit-ta');
    const edited = JSON.parse(await ta.inputValue());
    edited.operator = 'TGV Lyria';
    await ta.fill(JSON.stringify(edited, null, 2));
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).toBeHidden();
    await expect(page.locator('#hvlist')).toContainText('TGV Lyria');
  });

  test('invalid JSON still shows a parse error', async ({ page }) => {
    await page.evaluate('hOpenEdit(0)');
    await page.locator('#hedit-ta').fill('{ not json');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-err')).toContainText('Invalid JSON');
    await expect(page.locator('#hedit-modal')).toBeVisible();
  });
});
