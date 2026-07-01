import { test, expect } from '@playwright/test';

// Minimal itinerary the AI assistant will edit.
const baseItinerary = {
  trip: {
    name: "Paris 2026",
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
      departs: { station: "London St Pancras Int'l", time: "16:31" },
      arrives: { station: "Paris Gare du Nord", time: "19:49" },
      duration_min: 138,
      class: "Standard",
      cost: { total: 156.0, currency: "GBP", status: "paid", paid_by: "Judy Jetson" }
    }
  ]
};

// A valid new segment the mocked model "adds".
const newSegment = {
  id: "seg-2",
  type: "transport",
  mode: "train",
  operator: "Eurostar",
  ref: "CD5678",
  date: "2026-09-28",
  departs: { station: "Paris Gare du Nord", time: "10:00" },
  arrives: { station: "London St Pancras Int'l", time: "11:30" },
  duration_min: 150,
  class: "Standard",
  cost: { total: 120.0, currency: "GBP", status: "paid", paid_by: "George Jetson" }
};

// Stub the ajv ESM modules so the test is hermetic (no esm.sh network needed) and
// so we can deterministically drive validation outcomes. The app compiles two
// validators — the full document and a single segment (a oneOf schema) — which
// are driven independently via globalThis.__DOC_VALID__ / __SEG_VALID__ so a
// tool call can be accepted while the resulting document still fails.
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

// Build an OpenRouter mock that returns a tool call first, then a final text reply.
function mockOpenRouter(page, toolCalls) {
  let call = 0;
  return page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    call++;
    const message = call === 1
      ? { role: 'assistant', content: null, tool_calls: toolCalls }
      : { role: 'assistant', content: 'Done — I made the requested change.' };
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
  });
}

test.describe('AI assistant (OpenRouter)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
    await page.addInitScript((itin) => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
      localStorage.setItem('hOpenRouterKey', 'test-key');
      localStorage.setItem('hOpenRouterModel', 'test/model');
      globalThis.__DOC_VALID__ = true;
      globalThis.__SEG_VALID__ = true;
    }, baseItinerary);
  });

  test('adds a segment via tool call, previews it, and applies on confirm', async ({ page }) => {
    await mockOpenRouter(page, [{
      id: 'call_1',
      type: 'function',
      function: { name: 'add_segment', arguments: JSON.stringify({ segment_json: JSON.stringify(newSegment) }) }
    }]);
    await page.goto('/holiday_itinerary_viewer.html');

    // Open the assistant and send an instruction.
    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Add a return Eurostar on 28 September at 10:00');
    await page.locator('#hchat-send').click();

    // Diff preview appears, describing the added segment.
    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Proposed changes');
    await expect(preview).toContainText('Added transport (seg-2)');

    // Apply is enabled (valid); applying updates the timeline and localStorage.
    const applyBtn = preview.getByRole('button', { name: 'Apply changes' });
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();

    await expect(page.locator('#hvlist')).toContainText('CD5678');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hItinerary')));
    expect(stored.segments.map(s => s.id)).toContain('seg-2');
    await expect(preview).toBeHidden();
  });

  test('patches a segment via patch_segment, merging changes into the original', async ({ page }) => {
    await mockOpenRouter(page, [{
      id: 'call_1',
      type: 'function',
      function: { name: 'patch_segment', arguments: JSON.stringify({ id: 'seg-1', changes_json: JSON.stringify({ departs: { time: '17:01' }, cost: { status: 'pending' } }) }) }
    }]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('The outbound train now leaves at 17:01 and the payment is pending');
    await page.locator('#hchat-send').click();

    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Updated transport (seg-1)');
    await preview.getByRole('button', { name: 'Apply changes' }).click();

    // Patched fields changed; everything else on the segment survived the merge.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hItinerary')));
    const seg = stored.segments.find(s => s.id === 'seg-1');
    expect(seg.departs.time).toBe('17:01');
    expect(seg.departs.station).toBe("London St Pancras Int'l");
    expect(seg.cost.status).toBe('pending');
    expect(seg.cost.total).toBe(156.0);
    expect(seg.ref).toBe('AB1234');
  });

  test('blocks apply and surfaces errors when the result is not schema-valid', async ({ page }) => {
    await mockOpenRouter(page, [{
      id: 'call_1',
      type: 'function',
      function: { name: 'add_segment', arguments: JSON.stringify({ segment_json: JSON.stringify({ id: 'seg-2', type: 'transport' }) }) }
    }]);
    await page.goto('/holiday_itinerary_viewer.html');
    // Accept the tool call (segment validation passes) but fail validation of
    // the resulting document, so the preview must block Apply.
    await page.evaluate(() => {
      globalThis.__DOC_VALID__ = false;
      globalThis.__ERRORS__ = [{ instancePath: '/segments/1', message: "must have required property 'operator'", params: {} }];
    });

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Add a broken segment');
    await page.locator('#hchat-send').click();

    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('schema errors remain');
    await expect(preview).toContainText("must have required property 'operator'");
    await expect(preview.getByRole('button', { name: 'Apply changes' })).toBeDisabled();

    // Itinerary in storage is unchanged (no seg-2 applied).
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hItinerary')));
    expect(stored.segments.map(s => s.id)).not.toContain('seg-2');
  });
});

test.describe('Schema version guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
    await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
  });

  test('does not auto-load saved data from an incompatible major version', async ({ page }) => {
    await page.addInitScript((itin) => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
      localStorage.setItem('hSchemaVersion', '1.0.0');
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');

    // App stays on the upload screen with a version warning instead of loading.
    await expect(page.locator('#hverwarn')).toBeVisible();
    await expect(page.locator('#hverwarn')).toContainText('different version');
    await expect(page.locator('#hverwarn')).toContainText('1.0.0');
    await expect(page.locator('#happ')).toBeHidden();

    // "Load anyway" overrides the guard and loads the data.
    await page.getByRole('button', { name: 'Load anyway' }).click();
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#hvlist')).toContainText('AB1234');
  });

  test('auto-loads saved data from a compatible major version', async ({ page }) => {
    await page.addInitScript((itin) => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
      localStorage.setItem('hSchemaVersion', '2.0.0');
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');

    await expect(page.locator('#hverwarn')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#hvlist')).toContainText('AB1234');
  });
});
