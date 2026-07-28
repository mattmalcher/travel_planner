import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  takenGroupIds, takenPhraseIds, phraseCount, untranslated,
  deleteMessage, restoreMessage, addMessage,
} from '../../src/lib/phrases.js';
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

/* --- what a phrasebook mutation says out loud (issue #93) --- */

test('announcements name the phrase and carry the count the badge shows', () => {
  const group = doc.phrases[0];
  assert.equal(deleteMessage(group.items[1]), 'Deleted Thank you. Undo available.');
  assert.equal(restoreMessage(group.items[1], group), 'Thank you restored. 2 phrases.');
  assert.equal(addMessage(group.items[0], group), 'Good morning added. 2 phrases.');
  assert.equal(addMessage(group.items[0], doc.phrases[1]), 'Good morning added. 1 phrase.');
});

test('an untitled phrase still announces as something', () => {
  assert.equal(deleteMessage({ id: 'ph-x' }), 'Deleted Phrase. Undo available.');
  assert.equal(addMessage(null, null), 'Phrase added. 0 phrases.');
});
