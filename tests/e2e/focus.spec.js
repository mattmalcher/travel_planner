// Focus survival and status messages across a re-render (issue #93).
//
// The Lists and Phrases views redraw themselves wholesale on every mutation, so
// operating a control used to destroy it: focus fell back to <body> and the next
// Tab restarted at the top of the document (3.2.2), and nothing was announced
// (4.1.3). These specs drive the views by keyboard only, which is the case that
// was broken — a pointer user never noticed.
//
// Playwright cannot verify a screen reader actually spoke, so the live-region
// assertions are on its content; that it EXISTS before anything writes to it is
// asserted separately, because a region created and populated in the same frame
// is the usual way this silently fails.
import { test, expect } from '@playwright/test';

const itinerary = {
  trip: {
    name: 'Focus Test Trip',
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
    {
      id: 'list-food',
      name: 'Foods to try',
      kind: 'food',
      items: [
        { id: 'li-1', name: 'Custard tart' },
        { id: 'li-2', name: 'Cassoulet' },
        { id: 'li-3', name: 'Bordeaux' }
      ]
    }
  ],
  phrases: [
    {
      id: 'phr-1',
      name: 'Greetings',
      kind: 'greetings',
      language: 'French',
      items: [
        { id: 'ph-1', text: 'Good morning', local: 'Bonjour' },
        { id: 'ph-2', text: 'Thank you', local: 'Merci' }
      ]
    }
  ]
};

/** The data-focus key of whatever currently has focus — the identity the app
    restores by, and the only stable way to assert it: the Lists view re-sorts
    done items below open ones, so the row's position changes under it. */
const focused = page => page.evaluate(() => {
  const el = globalThis.document.activeElement;
  return el ? (el.dataset.focus || null) : null;
});

async function open(page) {
  await page.goto('/holiday_itinerary_viewer.html');
  await page.setInputFiles('#hfile', {
    name: 'focus.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(itinerary))
  });
}

test.describe('Focus and announcements in the Lists view', () => {

  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="lists"]');
  });

  test('the live region is in the DOM, empty, before anything writes to it', async ({ page }) => {
    const live = page.locator('#hlive');
    await expect(live).toBeAttached();
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    // Without aria-atomic a reader may announce only the text node that
    // changed rather than the whole sentence.
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    await expect(live).toHaveText('');
    // Announced, not shown: sr-only clips it to a 1px box out of the layout.
    expect(await live.boundingBox()).toMatchObject({ width: 1, height: 1 });
  });

  test('ticking an item with the keyboard keeps focus on that same checkbox', async ({ page }) => {
    const third = page.locator('#hvlists input[data-focus="li-check:0:2"]');
    await third.focus();
    await page.keyboard.press('Space');

    // The item is now done and has sunk below the two open ones — a positional
    // assertion would pass on the wrong row, so this is on its identity.
    await expect(page.locator('#hvlists .hli.done')).toContainText('Bordeaux');
    expect(await focused(page)).toBe('li-check:0:2');
    await expect(page.locator('#hvlists .hli-progress')).toHaveText('1/3');

    // Un-ticking is the same round trip.
    await page.keyboard.press('Space');
    expect(await focused(page)).toBe('li-check:0:2');
    await expect(page.locator('#hvlists .hli.done')).toHaveCount(0);
  });

  test('a tick is announced with the item and the new count', async ({ page }) => {
    await page.locator('#hvlists input[data-focus="li-check:0:2"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#hlive')).toHaveText(/Bordeaux ticked off\. 1 of 3 done\./);

    await page.keyboard.press('Space');
    await expect(page.locator('#hlive')).toHaveText(/Bordeaux unticked\. 0 of 3 done\./);
  });

  test('deleting an item moves focus to Undo and says the offer is there', async ({ page }) => {
    await page.click('#hedit-toggle');
    const del = page.locator('#hvlists button[data-focus="li-del:0:2"]');
    await del.focus();
    await page.keyboard.press('Enter');

    // The row focus was on no longer exists; the Undo button is both where
    // focus lands and the only recovery from the delete.
    expect(await focused(page)).toBe('li-undo:0');
    await expect(page.locator('#hlive')).toHaveText(/Deleted Bordeaux\. Undo available\./);
    await expect(page.locator('#hvlists .hli')).toHaveCount(2);

    // Undo from the keyboard puts the item back, with focus on it.
    await page.keyboard.press('Enter');
    await expect(page.locator('#hvlists .hli')).toHaveCount(3);
    expect(await focused(page)).toBe('li-check:0:2');
    // The count is the half a non-visual user cannot see, so every message
    // that changes one carries it (lib/lists.js builds them from listProgress).
    await expect(page.locator('#hlive')).toHaveText(/Bordeaux restored\. 3 items\./);
  });

  test('the quick-add keeps the cursor in the box and announces the item', async ({ page }) => {
    const box = page.locator('#hvlists input[data-focus="li-add:0"]');
    await box.fill('Croissant');
    await box.press('Enter');

    expect(await focused(page)).toBe('li-add:0');
    await expect(box).toHaveValue('');
    await expect(page.locator('#hlive')).toHaveText(/Croissant added\. 4 items\./);
  });

  test('the same announcement twice in a row still changes the region', async ({ page }) => {
    // A live region announces when its text *changes*, so a message identical
    // to the one already sitting there is silent. The counts in the add and
    // tick messages make consecutive sentences differ most of the time, but
    // not always: a delete carries no count, so deleting two items of the same
    // name produces exactly this, and it must still be heard.
    const box = page.locator('#hvlists input[data-focus="li-add:0"]');
    await box.fill('Croissant');
    await box.press('Enter');
    await box.fill('Croissant');
    await box.press('Enter');

    await page.click('#hedit-toggle');
    const del = page.locator('#hvlists button[data-focus="li-del:0:3"]');
    await del.click();
    const first = await page.locator('#hlive').textContent();
    // The second Croissant has shifted up into index 3 behind the first.
    await del.click();
    const second = await page.locator('#hlive').textContent();

    expect(first.trim()).toBe('Deleted Croissant. Undo available.');
    expect(second.trim()).toBe(first.trim()); // the same sentence…
    expect(second).not.toBe(first);           // …but not the identical string
  });
});

test.describe('Focus and announcements in the Phrases view', () => {

  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="phrases"]');
  });

  test('deleting a phrase moves focus to Undo, and undo restores both', async ({ page }) => {
    await page.click('#hedit-toggle');
    await page.locator('#hvphrases button[data-focus="ph-del:0:1"]').focus();
    await page.keyboard.press('Enter');

    expect(await focused(page)).toBe('ph-undo:0');
    await expect(page.locator('#hlive')).toHaveText(/Deleted Thank you\. Undo available\./);

    await page.keyboard.press('Enter');
    await expect(page.locator('#hvphrases .hph')).toHaveCount(2);
    expect(await focused(page)).toBe('ph-edit:0:1');
    await expect(page.locator('#hlive')).toHaveText(/Thank you restored\. 2 phrases\./);
  });

  test('the quick-add keeps the cursor in the box', async ({ page }) => {
    const box = page.locator('#hvphrases input[data-focus="ph-add:0"]');
    await box.fill('Where is the station?');
    await box.press('Enter');
    expect(await focused(page)).toBe('ph-add:0');
    await expect(page.locator('#hlive')).toHaveText(/Where is the station\? added\. 3 phrases\./);
  });
});

test.describe('Focus around the edit modal', () => {

  test('saving an edit returns focus to the pencil that opened it', async ({ page }) => {
    await open(page);
    await page.click('#hedit-toggle');
    // The itinerary is redrawn wholesale on save, so the pencil that opened the
    // modal is a different element by the time focus goes back to it.
    await page.locator('#hvlist button[data-focus="seg-edit:0"]').click();
    await expect(page.locator('#hedit-modal')).toHaveClass(/on/);
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);
    expect(await focused(page)).toBe('seg-edit:0');
  });

  test('cancelling returns focus to the pencil too', async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="lists"]');
    await page.click('#hedit-toggle');
    await page.locator('#hvlists button[data-focus="li-edit:0:1"]').click();
    await page.locator('#hedit-ft').getByRole('button', { name: 'Cancel' }).click();
    expect(await focused(page)).toBe('li-edit:0:1');
  });

  test('deleting from the modal leaves focus in the view, not on <body>', async ({ page }) => {
    await open(page);
    await page.click('.htab[data-v="lists"]');
    await page.click('#hedit-toggle');
    page.on('dialog', d => d.accept()); // the modal's Delete confirms first
    // The last item, so its key really is gone afterwards: deleting from the
    // middle leaves the same key on the item that shifts up into the position,
    // and focus lands there instead.
    await page.locator('#hvlists button[data-focus="li-edit:0:2"]').click();
    await page.locator('#hedit-del').click();

    await expect(page.locator('#hvlists .hli')).toHaveCount(2);
    // The pencil is gone with the item, so the open panel takes focus — the
    // next Tab carries on from the view rather than the top of the document.
    expect(await page.evaluate(() => globalThis.document.activeElement.id)).toBe('hvlists');
  });
});
