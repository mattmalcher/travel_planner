import { test, expect } from '@playwright/test';
import { savedDoc } from './library.js';

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
      departs: { place: "London St Pancras Int'l", time: "16:31" },
      arrives: { place: "Paris Gare du Nord", time: "19:49" },
      duration_min: 138,
      cost: { amount: 156.0, currency: "GBP", status: "paid", paid_by: "Judy Jetson" }
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
  departs: { place: "Paris Gare du Nord", time: "10:00" },
  arrives: { place: "London St Pancras Int'l", time: "11:30" },
  duration_min: 150,
  cost: { amount: 120.0, currency: "GBP", status: "paid", paid_by: "George Jetson" }
};

// ajv and the schema are compiled into the page (src/validate.js), so tool
// payloads and the resulting draft are checked by the real validator here —
// which is the point of the two validation tests below: an invalid payload is
// refused at tool time with the schema's own messages, and a draft that is
// invalid for some other reason blocks Apply in the preview.

// Build an OpenRouter mock that replays a scripted sequence of assistant
// turns: each entry is either an array of tool calls or a final text reply
// (the last entry repeats if the app asks again). Returns the captured
// request bodies so tests can assert on the prompt and tool results sent.
async function mockOpenRouter(page, turns) {
  const requests = [];
  let call = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    requests.push(JSON.parse(route.request().postData()));
    const t = turns[Math.min(call++, turns.length - 1)];
    const message = typeof t === 'string'
      ? { role: 'assistant', content: t }
      : { role: 'assistant', content: null, tool_calls: t };
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
  });
  return requests;
}

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test.describe('AI assistant (OpenRouter)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((itin) => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
      localStorage.setItem('hOpenRouterKey', 'test-key');
      localStorage.setItem('hOpenRouterModel', 'test/model');
      globalThis.__DOC_VALID__ = true;
      globalThis.__SEG_VALID__ = true;
      globalThis.__TRIP_VALID__ = true;
    }, baseItinerary);
  });

  test('adds a segment via tool call, previews it, and applies on confirm', async ({ page }) => {
    const requests = await mockOpenRouter(page, [
      [toolCall('call_1', 'add_segment', { segment: newSegment })],
      'Done — I made the requested change.',
    ]);
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
    const stored = await savedDoc(page);
    expect(stored.segments.map(s => s.id)).toContain('seg-2');
    await expect(preview).toBeHidden();

    // The system prompt carries the one-line digest, not the raw itinerary
    // JSON (issue #31).
    const system = requests[0].messages[0].content;
    expect(system).toContain("seg-1 | transport/train | 2026-09-18 16:31 London St Pancras Int'l → 19:49 Paris Gare du Nord | Eurostar ref AB1234 | paid GBP 156");
    expect(system).not.toContain('"departs"');
  });

  test('reads a segment with get_segment, then patches it, merging changes into the original', async ({ page }) => {
    const requests = await mockOpenRouter(page, [
      [toolCall('call_1', 'get_segment', { ids: ['seg-1'] })],
      [toolCall('call_2', 'patch_segment', { id: 'seg-1', changes: { departs: { time: '17:01' }, cost: { status: 'pending' } } })],
      'Done — I made the requested change.',
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('The outbound train now leaves at 17:01 and the payment is pending');
    await page.locator('#hchat-send').click();

    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Updated transport (seg-1)');
    await preview.getByRole('button', { name: 'Apply changes' }).click();

    // get_segment returned the full segment JSON to the model.
    const readResult = requests[1].messages.at(-1);
    expect(readResult.role).toBe('tool');
    expect(JSON.parse(readResult.content)).toEqual(baseItinerary.segments[0]);

    // Patched fields changed; everything else on the segment survived the merge.
    const stored = await savedDoc(page);
    const seg = stored.segments.find(s => s.id === 'seg-1');
    expect(seg.departs.time).toBe('17:01');
    expect(seg.departs.place).toBe("London St Pancras Int'l");
    expect(seg.cost.status).toBe('pending');
    expect(seg.cost.amount).toBe(156.0);
    expect(seg.ref).toBe('AB1234');
  });

  test('rejects an edit to an unread segment and lets the model recover', async ({ page }) => {
    const requests = await mockOpenRouter(page, [
      [toolCall('call_1', 'patch_segment', { id: 'seg-1', changes: { notes: 'Upgraded to Standard Premier' } })],
      [toolCall('call_2', 'get_segment', { ids: ['seg-1'] })],
      [toolCall('call_3', 'patch_segment', { id: 'seg-1', changes: { notes: 'Upgraded to Standard Premier' } })],
      'Done — I made the requested change.',
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Upgrade the outbound train to Standard Premier');
    await page.locator('#hchat-send').click();

    // The blind patch was refused with a pointer at get_segment…
    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    const refusal = requests[1].messages.at(-1);
    expect(refusal.role).toBe('tool');
    expect(refusal.content).toMatch(/^ERROR: segment "seg-1" has not been read this turn/);
    expect(refusal.content).toContain('get_segment');

    // …and only the read-then-retry patch landed (a single update op).
    await expect(preview).toContainText('Updated transport (seg-1)');
    await preview.getByRole('button', { name: 'Apply changes' }).click();
    const stored = await savedDoc(page);
    expect(stored.segments.find(s => s.id === 'seg-1').notes).toBe('Upgraded to Standard Premier');
  });

  test('patches the trip with patch_trip, keeping fields the changes omit (issue #43)', async ({ page }) => {
    await mockOpenRouter(page, [
      [toolCall('call_1', 'patch_trip', { changes: { name: 'Paris & Lyon 2026' } })],
      'Done — I renamed the trip.',
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Rename the trip to Paris & Lyon 2026');
    await page.locator('#hchat-send').click();

    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Updated trip details');
    await preview.getByRole('button', { name: 'Apply changes' }).click();

    // Only the name changed; the fields the patch omitted survived.
    const stored = await savedDoc(page);
    expect(stored.trip.name).toBe('Paris & Lyon 2026');
    expect(stored.trip.travellers).toEqual(['Judy Jetson', 'George Jetson']);
    expect(stored.trip.currency_primary).toBe('GBP');
  });

  test('says so when the tool loop exhausts, and pins a low temperature (issue #44)', async ({ page }) => {
    // The mock repeats its last entry, so every iteration returns a tool
    // call and the loop can never reach a final text reply.
    const requests = await mockOpenRouter(page, [
      [toolCall('call_1', 'get_segment', { ids: ['seg-1'] })],
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Read everything forever');
    await page.locator('#hchat-send').click();

    // Instead of ending the turn silently, the exhaustion note is posted.
    await expect(page.locator('#hchat-msgs')).toContainText('Stopped after 12 tool steps');
    expect(requests.length).toBe(12);

    // Tool-calling requests pin a low temperature (fewer malformed calls).
    for (const r of requests) expect(r.temperature).toBe(0.2);
  });

  test('refuses a half-formed segment at tool time and hands the errors back', async ({ page }) => {
    const requests = await mockOpenRouter(page, [
      // Legacy *_json string form, still accepted for older transcripts and
      // models that stringify anyway (issue #42) — and a transport segment
      // with nothing on it but an id and a type.
      [toolCall('call_1', 'add_segment', { segment_json: JSON.stringify({ id: 'seg-2', type: 'transport' }) })],
      'Sorry — I could not complete that.',
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Add a broken segment');
    await page.locator('#hchat-send').click();
    await expect(page.locator('#hchat-msgs')).toContainText('could not complete');

    // The tool result carries the schema's own complaints, so the model can
    // fix them rather than guess — this is the real validator talking.
    const result = requests[1].messages.at(-1);
    expect(result.role).toBe('tool');
    expect(result.content).toMatch(/^ERROR — segment failed schema validation/);
    expect(result.content).toContain('operator');

    // Nothing was recorded, so there is no preview and nothing to apply.
    await expect(page.locator('#hchat-preview')).toBeHidden();
    const stored = await savedDoc(page);
    expect(stored.segments.map(s => s.id)).not.toContain('seg-2');
  });

  test('blocks apply when the document as a whole is not schema-valid', async ({ page }) => {
    // Every tool payload is checked on the way in, so the way a draft still
    // ends up invalid is a fault that was already in the document: saved trips
    // are restored without revalidation, so one that arrived via "Load anyway"
    // (or predates a schema change) stays broken until someone fixes it. A
    // valid AI edit on top must not be applied over the top of that.
    const broken = { ...baseItinerary, segments: [{ ...baseItinerary.segments[0] }] };
    delete broken.segments[0].duration_min;
    await page.addInitScript(itin => {
      localStorage.setItem('hItinerary', JSON.stringify(itin));
    }, broken);

    await mockOpenRouter(page, [
      [toolCall('call_1', 'add_segment', { segment: newSegment })],
      'Done — I made the requested change.',
    ]);
    await page.goto('/holiday_itinerary_viewer.html');

    await page.getByRole('button', { name: 'AI' }).click();
    await page.locator('#hchat-input').fill('Add the return leg');
    await page.locator('#hchat-send').click();

    const preview = page.locator('#hchat-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Added transport (seg-2)'); // the edit itself was fine
    await expect(preview).toContainText('schema errors remain');
    await expect(preview).toContainText('duration_min');
    await expect(preview.getByRole('button', { name: 'Apply changes' })).toBeDisabled();

    // Itinerary in storage is unchanged (no seg-2 applied).
    const stored = await savedDoc(page);
    expect(stored.segments.map(s => s.id)).not.toContain('seg-2');
  });
});

test.describe('Schema version guard', () => {

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
      localStorage.setItem('hSchemaVersion', '3.0.0');
    }, baseItinerary);
    await page.goto('/holiday_itinerary_viewer.html');

    await expect(page.locator('#hverwarn')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();
    await expect(page.locator('#hvlist')).toContainText('AB1234');
  });
});
