import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePatch } from '../../src/lib/merge-patch.js';

// RFC 7386 appendix A test cases (the ones meaningful for object patching).
test('mergePatch follows RFC 7386 semantics', () => {
  assert.deepEqual(mergePatch({ a: 'b' }, { a: 'c' }), { a: 'c' });
  assert.deepEqual(mergePatch({ a: 'b' }, { b: 'c' }), { a: 'b', b: 'c' });
  assert.deepEqual(mergePatch({ a: 'b' }, { a: null }), {});
  assert.deepEqual(mergePatch({ a: 'b', b: 'c' }, { a: null }), { b: 'c' });
  assert.deepEqual(mergePatch({ a: ['b'] }, { a: 'c' }), { a: 'c' });
  assert.deepEqual(mergePatch({ a: 'c' }, { a: ['b'] }), { a: ['b'] });
  assert.deepEqual(mergePatch({ a: { b: 'c' } }, { a: { b: 'd', c: null } }), { a: { b: 'd' } });
  assert.deepEqual(mergePatch({ a: [{ b: 'c' }] }, { a: [1] }), { a: [1] });
  assert.deepEqual(mergePatch(['a', 'b'], ['c', 'd']), ['c', 'd']);
  assert.deepEqual(mergePatch({ a: 'b' }, ['c']), ['c']);
  assert.equal(mergePatch({ a: 'foo' }, null), null);
  assert.equal(mergePatch({ a: 'foo' }, 'bar'), 'bar');
  assert.deepEqual(mergePatch({ e: null }, { a: 1 }), { e: null, a: 1 });
  assert.deepEqual(mergePatch([1, 2], { a: 'b', c: null }), { a: 'b' });
  assert.deepEqual(mergePatch({}, { a: { bb: { ccc: null } } }), { a: { bb: {} } });
});

test('mergePatch edits a segment without touching unrelated fields', () => {
  const seg = {
    id: 'seg-1', type: 'transport', mode: 'train', operator: 'Eurostar', ref: 'AB1234',
    date: '2026-09-18',
    departs: { station: 'London St Pancras', time: '16:31' },
    arrives: { station: 'Paris Gare du Nord', time: '19:49' },
    duration_min: 138, class: 'Standard',
    cost: { total: 156, currency: 'GBP', status: 'pending' },
  };
  const out = mergePatch(seg, { departs: { time: '17:01' }, cost: { status: 'paid' } });
  assert.equal(out.departs.time, '17:01');
  assert.equal(out.departs.station, 'London St Pancras');
  assert.equal(out.cost.status, 'paid');
  assert.equal(out.cost.total, 156);
  assert.equal(out.operator, 'Eurostar');
});

test('mergePatch does not mutate the target', () => {
  const seg = { id: 'seg-1', cost: { total: 10, status: 'pending' }, notes: 'x' };
  const before = structuredClone(seg);
  mergePatch(seg, { cost: { status: 'paid' }, notes: null });
  assert.deepEqual(seg, before);
});
