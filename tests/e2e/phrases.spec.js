// Phrases tab (issue #75): the phrasebook. Not a checklist — no tick-off, no
// Schedule chip — but the same authoring rules as the Lists view: quick-add
// and "New group" always on, the pencils and the inline × behind edit mode
// with one level of undo.
import { test, expect } from '@playwright/test';
import { savedDoc } from './library.js';

const phraseItinerary = {
  trip: {
    name: 'Phrases Test Trip',
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
  phrases: [
    {
      id: 'phr-basics',
      name: 'Getting by',
      language: 'French',
      kind: 'greetings',
      items: [
        { id: 'ph-1', text: 'Good morning', local: 'Bonjour', pronunciation: 'bon-ZHOOR', note: 'Say it on entering a shop.' },
        { id: 'ph-2', text: 'Do you speak English?', local: 'Parlez-vous anglais ?' },
        { id: 'ph-3', text: 'Where is the station?' }
      ]
    },
    {
      id: 'phr-food',
      name: 'Ordering food',
      language: 'French',
      kind: 'food',
      items: [{ id: 'ph-4', text: 'The bill, please', local: "L'addition, s'il vous plaît" }]
    }
  ]
};

// Same ajv stub as the other view specs: these test the view, not validation,
// and must not race the esm.sh import.
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

async function open(page, doc = phraseItinerary) {
  await page.route(/esm\.sh\/ajv@8/, r => r.fulfill({ contentType: 'application/javascript', body: AJV_STUB }));
  await page.route(/esm\.sh\/ajv-formats/, r => r.fulfill({ contentType: 'application/javascript', body: FMT_STUB }));
  await page.goto('/holiday_itinerary_viewer.html');
  await page.setInputFiles('#hfile', {
    name: 'phrases.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc))
  });
  await page.click('.htab[data-v="phrases"]');
}

test.describe('Phrases view', () => {

  test.beforeEach(async ({ page }) => { await open(page); });

  test('renders groups with their language, counts and phrase detail', async ({ page }) => {
    await expect(page.locator('#hvphrases')).toBeVisible();
    const cards = page.locator('#hvphrases .hseg');
    await expect(cards).toHaveCount(2);

    const basics = cards.first();
    await expect(basics).toContainText('Getting by');
    await expect(basics).toContainText('French');
    await expect(basics.locator('.hli-progress').last()).toHaveText('3');

    const row = basics.locator('.hph', { hasText: 'Good morning' });
    await expect(row.locator('.hph-local')).toHaveText('Bonjour');
    await expect(row.locator('.hph-say')).toHaveText('bon-ZHOOR');
    await expect(row.locator('.hph-note')).toHaveText('Say it on entering a shop.');
  });

  test('a phrase with no translation says so and is counted', async ({ page }) => {
    const basics = page.locator('#hvphrases .hseg').first();
    await expect(basics.locator('.hph-todo-count')).toHaveText('1 to translate');
    await expect(basics.locator('.hph', { hasText: 'Where is the station?' }).locator('.hph-local'))
      .toHaveText('Not translated yet');
    // A fully translated group makes no such offer.
    await expect(page.locator('#hvphrases .hseg').nth(1).locator('.hph-todo-count')).toHaveCount(0);
  });

  test('phrases are reference, not a checklist: no tick-off and no Schedule', async ({ page }) => {
    await expect(page.locator('#hvphrases input[type=checkbox]')).toHaveCount(0);
    await expect(page.locator('#hvphrases').getByRole('button', { name: /Schedule/ })).toHaveCount(0);
    // …and nothing about the phrasebook reaches the itinerary or the budget.
    await page.click('.htab[data-v="list"]');
    await expect(page.locator('#hvlist .hseg')).toHaveCount(1);
    await expect(page.locator('#hvlist')).not.toContainText('Bonjour');
  });

  test('adding is always available; the pencils wait for edit mode', async ({ page }) => {
    const basics = page.locator('#hvphrases .hseg').first();
    await expect(basics.locator('.hph-add-in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New group' }).first()).toBeVisible();
    await expect(basics.getByRole('button', { name: 'Edit group' })).toBeHidden();
    await expect(basics.locator('.hph').first().getByRole('button', { name: 'Edit phrase' })).toBeHidden();
    await expect(basics.locator('.hph').first().getByRole('button', { name: 'Delete phrase' })).toBeHidden();

    await page.click('#hedit-toggle');
    await expect(basics.getByRole('button', { name: 'Edit group' })).toBeVisible();
    await expect(basics.locator('.hph').first().getByRole('button', { name: 'Edit phrase' })).toBeVisible();
    await expect(basics.locator('.hph').first().getByRole('button', { name: 'Delete phrase' })).toBeVisible();
    await expect(basics.locator('.hph-add-in')).toBeVisible();
  });

  test('quick-add appends an untranslated phrase and stays ready for the next', async ({ page }) => {
    const basics = page.locator('#hvphrases .hseg').first();
    const box = basics.locator('.hph-add-in');

    await box.fill('Two coffees, please');
    await box.press('Enter');
    await expect(basics.locator('.hli-progress').last()).toHaveText('4');
    await expect(basics.locator('.hph').nth(3)).toContainText('Two coffees, please');
    await expect(basics.locator('.hph-todo-count')).toHaveText('2 to translate');
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();

    await box.fill('Thank you');
    await basics.getByRole('button', { name: 'Add' }).click();
    await expect(basics.locator('.hli-progress').last()).toHaveText('5');

    await box.press('Enter'); // blank adds nothing
    await expect(basics.locator('.hli-progress').last()).toHaveText('5');

    const saved = await savedDoc(page);
    const added = saved.phrases[0].items.slice(-2);
    expect(added.map(p => p.text)).toEqual(['Two coffees, please', 'Thank you']);
    // Nothing is invented: no guessed translation, just an id and the text.
    expect(Object.keys(added[0]).sort()).toEqual(['id', 'text']);
    const ids = saved.phrases.flatMap(g => g.items.map(p => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the phrase pencil opens the form for the translation fields', async ({ page }) => {
    await page.click('#hedit-toggle');
    const basics = page.locator('#hvphrases .hseg').first();
    await basics.locator('.hph', { hasText: 'Where is the station?' })
      .getByRole('button', { name: 'Edit phrase' }).click();

    await expect(page.locator('#hedit-title')).toHaveText('Edit: Where is the station?');
    await expect(page.locator('#hedit-form [data-p="text"]')).toHaveValue('Where is the station?');
    await expect(page.locator('#hedit-form [data-p="local"]')).toHaveValue('');

    await page.fill('#hedit-form [data-p="local"]', 'Où est la gare ?');
    await page.fill('#hedit-form [data-p="pronunciation"]', 'oo ay la GAR');
    await page.fill('#hedit-form [data-p="note"]', 'Point at the map as you ask.');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#hedit-modal')).not.toHaveClass(/on/);
    const row = basics.locator('.hph', { hasText: 'Where is the station?' });
    await expect(row.locator('.hph-local')).toHaveText('Où est la gare ?');
    await expect(row.locator('.hph-say')).toHaveText('oo ay la GAR');
    await expect(basics.locator('.hph-todo-count')).toHaveCount(0); // nothing left to translate

    const saved = await savedDoc(page);
    expect(saved.phrases[0].items.find(p => p.id === 'ph-3')).toMatchObject({
      local: 'Où est la gare ?', pronunciation: 'oo ay la GAR', note: 'Point at the map as you ask.'
    });
  });

  test('the × deletes a phrase straight away, and Undo puts it back', async ({ page }) => {
    await page.click('#hedit-toggle');
    const basics = page.locator('#hvphrases .hseg').first();

    await basics.locator('.hph', { hasText: 'Good morning' })
      .getByRole('button', { name: 'Delete phrase' }).click();
    await expect(basics.locator('.hli-progress').last()).toHaveText('2');
    let saved = await savedDoc(page);
    expect(saved.phrases[0].items.map(p => p.id)).toEqual(['ph-2', 'ph-3']);

    const undo = basics.locator('.hli-undo');
    await expect(undo).toContainText('Good morning');
    await undo.getByRole('button', { name: 'Undo' }).click();

    await expect(basics.locator('.hli-progress').last()).toHaveText('3');
    await expect(basics.locator('.hli-undo')).toHaveCount(0);
    saved = await savedDoc(page);
    // Restored in place, with the pronunciation and note it held.
    expect(saved.phrases[0].items[0]).toMatchObject({
      id: 'ph-1', text: 'Good morning', local: 'Bonjour', pronunciation: 'bon-ZHOOR'
    });
  });

  test('a group can be renamed and deleted, and the strip tracks the groups', async ({ page }) => {
    const chips = page.locator('#hvphrases .hjump-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('Getting by');
    await expect(chips.nth(1)).toContainText('Ordering food');

    await page.click('#hedit-toggle');
    const basics = page.locator('#hvphrases .hseg').first();
    await basics.getByRole('button', { name: 'Edit group' }).click();

    await expect(page.locator('#hedit-title')).toHaveText('Edit group: Getting by');
    await page.fill('#hedit-form [data-p="name"]', 'Small talk');
    await page.fill('#hedit-form [data-p="language"]', 'Québécois French');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    await expect(basics).toContainText('Small talk');
    await expect(basics).toContainText('Québécois French');
    await expect(basics.locator('.hli-progress').last()).toHaveText('3'); // phrases intact

    await basics.getByRole('button', { name: 'Edit group' }).click();
    page.once('dialog', d => {
      expect(d.message()).toContain('3 phrases');
      d.accept();
    });
    await page.click('#hedit-del');
    await expect(page.locator('#hvphrases .hseg')).toHaveCount(1);
    const saved = await savedDoc(page);
    expect(saved.phrases.map(g => g.id)).toEqual(['phr-food']);
  });

  test('an itinerary with no phrasebook can grow its first group', async ({ page }) => {
    const bare = structuredClone(phraseItinerary);
    bare.trip_id = 'trip-no-phrases'; // a separate trip, not a fork of the seeded one
    delete bare.phrases;
    await page.setInputFiles('#hfile', {
      name: 'no-phrases.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bare))
    });
    await page.click('.htab[data-v="phrases"]');
    await expect(page.locator('#hvphrases')).toContainText('No phrases yet');

    await page.getByRole('button', { name: 'New group' }).first().click();
    await expect(page.locator('#hedit-title')).toHaveText('New phrase group');
    await expect(page.locator('#hedit-del')).toBeHidden(); // nothing to delete yet

    await page.fill('#hedit-form [data-p="name"]', 'Emergencies');
    await page.fill('#hedit-form [data-p="language"]', 'French');
    await page.selectOption('#hedit-form [data-p="kind"]', 'emergency');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();

    const group = page.locator('#hvphrases .hseg').first();
    await expect(group).toContainText('Emergencies');
    await group.locator('.hph-add-in').fill('I need a doctor');
    await group.locator('.hph-add-in').press('Enter');

    const saved = await savedDoc(page);
    expect(saved.phrases).toHaveLength(1);
    expect(saved.phrases[0]).toMatchObject({ name: 'Emergencies', language: 'French', kind: 'emergency' });
    expect(saved.phrases[0].id).toMatch(/^phr-.{5}$/); // assigned, not typed
    expect(saved.phrases[0].items[0].text).toBe('I need a doctor');
  });

  test('the JSON tab is still the escape hatch, and downloads carry the phrasebook', async ({ page }) => {
    await page.click('#hedit-toggle');
    await page.locator('#hvphrases .hseg').first()
      .locator('.hph', { hasText: 'Good morning' }).getByRole('button', { name: 'Edit phrase' }).click();

    await page.click('#hedit-tab-json');
    const value = JSON.parse(await page.inputValue('#hedit-ta'));
    expect(value).toMatchObject({ id: 'ph-1', text: 'Good morning', local: 'Bonjour' });

    // Round-tripping through the form must not drop what it doesn't show.
    await page.click('#hedit-tab-form');
    await page.locator('#hedit-ft').getByRole('button', { name: 'Save' }).click();
    const saved = await savedDoc(page);
    expect(saved.phrases[0].items[0]).toEqual(phraseItinerary.phrases[0].items[0]);
  });
});
