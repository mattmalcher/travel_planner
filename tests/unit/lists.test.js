import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listProgress, partitionItems, danglingListRefs, takenListIds, takenItemIds,
  displayOrder, locateItem, toggleMessage, deleteMessage, restoreMessage, addMessage,
} from '../../src/lib/lists.js';
import { newId } from '../../src/lib/ids.js';

const item = (over = {}) => ({ id: 'li-1', name: 'Custard tart', ...over });

test('listProgress counts done vs total', () => {
  const list = { id: 'list-1', name: 'Foods', items: [item({ done: true }), item({ id: 'li-2' }), item({ id: 'li-3', done: false })] };
  assert.deepEqual(listProgress(list), { done: 1, total: 3 });
});

test('listProgress tolerates missing or junk items', () => {
  assert.deepEqual(listProgress({ id: 'list-1', name: 'Empty' }), { done: 0, total: 0 });
  assert.deepEqual(listProgress(null), { done: 0, total: 0 });
  assert.deepEqual(listProgress({ items: [null, item({ done: true })] }), { done: 1, total: 2 });
});

test('partitionItems splits open from done, preserving order in each half', () => {
  const a = item({ id: 'li-a' }), b = item({ id: 'li-b', done: true }), c = item({ id: 'li-c' }), d = item({ id: 'li-d', done: true });
  const { open, done } = partitionItems({ items: [a, b, c, d] });
  assert.deepEqual(open.map(i => i.id), ['li-a', 'li-c']);
  assert.deepEqual(done.map(i => i.id), ['li-b', 'li-d']);
});

test('danglingListRefs finds items whose segment_id matches no segment', () => {
  const doc = {
    segments: [{ id: 'seg-1' }],
    lists: [{
      id: 'list-1', name: 'Foods',
      items: [item({ segment_id: 'seg-1' }), item({ id: 'li-2', segment_id: 'seg-gone' }), item({ id: 'li-3' })],
    }],
  };
  assert.deepEqual(danglingListRefs(doc), [{ listId: 'list-1', itemId: 'li-2', segmentId: 'seg-gone' }]);
});

test('danglingListRefs tolerates junk and documents without lists', () => {
  assert.deepEqual(danglingListRefs(null), []);
  assert.deepEqual(danglingListRefs({}), []);
  assert.deepEqual(danglingListRefs({ lists: [null, { items: [null] }] }), []);
});

/* Manual add (issue #72): a new item's id has to miss every item in the
   document, not just the list it lands in — segment_id back-references and
   the AI tools both assume item ids are document-unique. */

const doc = {
  lists: [
    { id: 'list-food', name: 'Foods', items: [item(), item({ id: 'li-2' })] },
    { id: 'list-packing', name: 'Packing', items: [item({ id: 'li-3' })] },
  ],
};

test('takenListIds / takenItemIds collect ids across the whole document', () => {
  assert.deepEqual([...takenListIds(doc)], ['list-food', 'list-packing']);
  assert.deepEqual([...takenItemIds(doc)], ['li-1', 'li-2', 'li-3']);
});

test('taken id sets tolerate junk and documents without lists', () => {
  for (const junk of [null, {}, { lists: null }, { lists: [null, { items: null }, { items: [null, {}] }] }]) {
    assert.equal(takenListIds(junk).size, 0);
    assert.equal(takenItemIds(junk).size, 0);
  }
});

test('a quick-added item id collides with nothing already in the document', () => {
  const taken = takenItemIds(doc);
  for (let i = 0; i < 200; i++) {
    const id = newId('li-', taken);
    assert.equal(taken.has(id), false);
    assert.match(id, /^li-.{5}$/);
    taken.add(id);
  }
});

/* --- in-place mutation and its announcements (issue #93) --- */

test('displayOrder is the rendered order: open items above done ones', () => {
  const a = item({ id: 'li-a' }), b = item({ id: 'li-b', done: true }), c = item({ id: 'li-c' });
  assert.deepEqual(displayOrder({ items: [a, b, c] }).map(i => i.id), ['li-a', 'li-c', 'li-b']);
  assert.deepEqual(displayOrder({ items: [null, a] }).map(i => i.id), ['li-a']);
  assert.deepEqual(displayOrder(null), []);
});

test('locateItem finds an item by identity, across lists', () => {
  const a = item({ id: 'li-a' }), b = item({ id: 'li-b' });
  const doc = { lists: [{ id: 'list-1', name: 'One', items: [a] }, { id: 'list-2', name: 'Two', items: [b] }] };
  assert.deepEqual(locateItem(doc, b), { li: 1, ii: 0, list: doc.lists[1], item: b });
  assert.equal(locateItem(doc, item({ id: 'li-a' })), null); // an equal copy is not the same item
  assert.equal(locateItem(doc, a) && locateItem(doc, a).li, 0);
});

test('locateItem survives the index shift a delete leaves behind', () => {
  const a = item({ id: 'li-a' }), b = item({ id: 'li-b' }), c = item({ id: 'li-c' });
  const doc = { lists: [{ id: 'list-1', name: 'One', items: [a, b, c] }] };
  assert.equal(locateItem(doc, c).ii, 2);
  doc.lists[0].items.splice(0, 1); // a is deleted; c's row is still on the page
  assert.equal(locateItem(doc, c).ii, 1);
  assert.equal(locateItem(doc, a), null);
});

test('locateItem tolerates junk documents', () => {
  for (const junk of [null, {}, { lists: null }, { lists: [null, { items: null }] }])
    assert.equal(locateItem(junk, item()), null);
});

test('announcements name the thing and carry the counts the badge shows', () => {
  const a = item({ id: 'li-a', name: 'Custard tart' }), b = item({ id: 'li-b', name: 'Croissant' });
  const list = { id: 'list-1', name: 'Foods', items: [a, b] };
  a.done = true;
  assert.equal(toggleMessage(a, list), 'Custard tart ticked off. 1 of 2 done.');
  a.done = false;
  assert.equal(toggleMessage(a, list), 'Custard tart unticked. 0 of 2 done.');
  assert.equal(deleteMessage(a), 'Deleted Custard tart. Undo available.');
  assert.equal(restoreMessage(a, list), 'Custard tart restored. 2 items.');
  assert.equal(addMessage(b, list), 'Croissant added. 2 items.');
  assert.equal(addMessage(b, { items: [b] }), 'Croissant added. 1 item.');
});

test('an unnamed item still announces as something', () => {
  const bare = { id: 'li-x' };
  assert.equal(deleteMessage(bare), 'Deleted Item. Undo available.');
  assert.equal(toggleMessage(bare, { items: [bare] }), 'Item unticked. 0 of 1 done.');
});
