import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takenGroupIds, takenPhraseIds, phraseCount, untranslated } from '../../src/lib/phrases.js';
import { newId } from '../../src/lib/ids.js';

const phrase = (over = {}) => ({ id: 'ph-1', text: 'Good morning', local: 'Bonjour', ...over });

const doc = {
  phrases: [
    { id: 'phr-basics', name: 'Getting by', items: [phrase(), phrase({ id: 'ph-2', text: 'Thank you', local: 'Merci' })] },
    { id: 'phr-food', name: 'Ordering food', items: [phrase({ id: 'ph-3', text: 'The bill, please', local: null })] },
  ],
};

test('phraseCount counts the phrases in a group', () => {
  assert.equal(phraseCount(doc.phrases[0]), 2);
  assert.equal(phraseCount(doc.phrases[1]), 1);
});

test('phraseCount tolerates a group with no items yet, and junk', () => {
  assert.equal(phraseCount({ id: 'phr-1', name: 'Empty' }), 0);
  assert.equal(phraseCount(null), 0);
  assert.equal(phraseCount({ items: [null, phrase()] }), 1);
});

/* A phrase with no local wording is a normal state — jotted down now,
   translated later — so it is counted, not treated as invalid. */
test('untranslated finds the phrases with no local wording', () => {
  const group = {
    items: [phrase(), phrase({ id: 'ph-2', local: undefined }), phrase({ id: 'ph-3', local: '' })],
  };
  assert.deepEqual(untranslated(group).map(p => p.id), ['ph-2', 'ph-3']);
  assert.deepEqual(untranslated({ id: 'phr-1', name: 'Empty' }), []);
  assert.deepEqual(untranslated(null), []);
});

/* Phrase ids are document-unique, not group-unique: the AI tools address a
   phrase by id alone, so a quick-added id has to miss every group. */

test('takenGroupIds / takenPhraseIds collect ids across the whole document', () => {
  assert.deepEqual([...takenGroupIds(doc)], ['phr-basics', 'phr-food']);
  assert.deepEqual([...takenPhraseIds(doc)], ['ph-1', 'ph-2', 'ph-3']);
});

test('taken id sets tolerate junk and documents without a phrasebook', () => {
  for (const junk of [null, {}, { phrases: null }, { phrases: [null, { items: null }, { items: [null, {}] }] }]) {
    assert.equal(takenGroupIds(junk).size, 0);
    assert.equal(takenPhraseIds(junk).size, 0);
  }
});

test('a quick-added phrase id collides with nothing already in the document', () => {
  const taken = takenPhraseIds(doc);
  for (let i = 0; i < 200; i++) {
    const id = newId('ph-', taken);
    assert.equal(taken.has(id), false);
    assert.match(id, /^ph-.{5}$/);
    taken.add(id);
  }
});
