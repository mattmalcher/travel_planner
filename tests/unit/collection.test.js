import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arr, groupIds, itemIds, plural } from '../../src/lib/collection.js';

test('arr tolerates the shapes an unvalidated document can arrive in', () => {
  assert.deepEqual(arr([1, 2]), [1, 2]);
  assert.deepEqual(arr(undefined), []);
  assert.deepEqual(arr(null), []);
  assert.deepEqual(arr('lists'), []);
  assert.deepEqual(arr({ 0: 'a' }), []);
});

test('groupIds collects group ids, skipping holes and unsaved groups', () => {
  const doc = { lists: [{ id: 'list-a' }, { name: 'no id yet' }, null, { id: 'list-b' }] };
  assert.deepEqual([...groupIds(doc, 'lists')], ['list-a', 'list-b']);
});

test('groupIds reads the key it is given, and empties for a missing one', () => {
  const doc = { lists: [{ id: 'list-a' }], phrases: [{ id: 'phr-a' }] };
  assert.deepEqual([...groupIds(doc, 'phrases')], ['phr-a']);
  assert.deepEqual([...groupIds(doc, 'segments')], []);
  assert.deepEqual([...groupIds(null, 'lists')], []);
});

test('itemIds spans every group — item ids are document-unique, not group-unique', () => {
  const doc = {
    lists: [
      { id: 'list-a', items: [{ id: 'li-1' }, { id: 'li-2' }] },
      { id: 'list-b', items: [{ id: 'li-3' }] },
    ],
  };
  assert.deepEqual([...itemIds(doc, 'lists')], ['li-1', 'li-2', 'li-3']);
});

test('itemIds tolerates a group with no items array yet', () => {
  const doc = { phrases: [{ id: 'phr-a' }, { id: 'phr-b', items: [{ id: 'p-1' }, null, {}] }] };
  assert.deepEqual([...itemIds(doc, 'phrases')], ['p-1']);
});

test('plural agrees with the noun it is given', () => {
  assert.equal(plural(0, 'item'), '0 items');
  assert.equal(plural(1, 'item'), '1 item');
  assert.equal(plural(3, 'phrase'), '3 phrases');
});
