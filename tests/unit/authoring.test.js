// The pure authoring core (src/lib/authoring.js). tests/unit/ai-tools.test.js
// covers each tool's behaviour through the app's adapter; this file pins what
// makes the core shareable: it never mutates its inputs, validators and the
// read record are parameters, and a null read record turns the guard off.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, applyTool, newReads } from '../../src/lib/authoring.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const doc = () => deepFreeze({
  schema_version: '3.0.0',
  trip: { name: 'Trip', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP' },
  segments: [{ id: 'seg-1', type: 'event', name: 'Museum', date: '2026-09-19', time: '10:00' }],
  lists: [{ id: 'list-food', name: 'Foods to try', items: [{ id: 'li-1', name: 'Custard tart' }] }],
  phrases: [{ id: 'phr-basics', name: 'Getting by', items: [{ id: 'ph-1', text: 'Hello', local: 'Bonjour' }] }],
});

const call = (name, args) => ({ name, arguments: args });

test('tool definitions are plain JSON Schema with unique names', () => {
  const names = TOOLS.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.deepEqual(Object.keys(t).sort(), ['description', 'name', 'parameters']);
    assert.equal(t.parameters.type, 'object');
  }
});

test('no tool mutates the document or its arguments', () => {
  const calls = [
    call('add_segment', deepFreeze({ segment: { type: 'event', name: 'Walk', date: '2026-09-20' } })),
    call('patch_segment', deepFreeze({ id: 'seg-1', changes: { name: 'Gallery' } })),
    call('update_segment', deepFreeze({ id: 'seg-1', segment: { id: 'seg-1', type: 'event', name: 'Gallery', date: '2026-09-19' } })),
    call('remove_segment', { id: 'seg-1' }),
    call('add_list', deepFreeze({ list: { name: 'Packing', items: [{ name: 'Hat' }] } })),
    call('patch_list', deepFreeze({ id: 'list-food', changes: { name: 'Snacks' } })),
    call('remove_list', { id: 'list-food' }),
    call('add_phrase_group', deepFreeze({ group: { name: 'Food', items: [{ text: 'Bill please' }] } })),
    call('patch_phrase_group', deepFreeze({ id: 'phr-basics', changes: { name: 'Basics' } })),
    call('remove_phrase_group', { id: 'phr-basics' }),
    call('patch_trip', deepFreeze({ changes: { name: 'Renamed' } })),
    call('update_trip', deepFreeze({ trip: { name: 'Renamed', start: '2026-09-18', end: '2026-09-28' } })),
  ];
  for (const c of calls) {
    const before = doc();
    const snapshot = structuredClone(before);
    const out = applyTool(before, c); // frozen inputs: any write would throw
    assert.match(out.result, /^OK/, `${c.name}: ${out.result}`);
    assert.notEqual(out.doc, before, `${c.name} returned the input document`);
    assert.deepEqual(before, snapshot, `${c.name} changed its input`);
    assert.ok(out.op, `${c.name} recorded no op`);
  }
});

test('patch_list leaves the document\'s own items untouched while assigning ids', () => {
  const before = deepFreeze({ ...doc(), lists: [{ id: 'list-food', name: 'Foods', items: [{ name: 'No id yet' }] }] });
  const out = applyTool(before, call('patch_list', { id: 'list-food', changes: { name: 'Snacks' } }));
  assert.match(out.result, /^OK/);
  assert.match(out.doc.lists[0].items[0].id, /^li-/);
  assert.equal(before.lists[0].items[0].id, undefined);
});

test('reads, failures and unchanged documents come back as the same objects', () => {
  const before = doc();
  const got = applyTool(before, call('get_segment', { ids: ['seg-1'] }));
  assert.equal(got.doc, before);
  assert.equal(got.op, null);
  const missing = applyTool(before, call('patch_segment', { id: 'seg-9', changes: {} }));
  assert.equal(missing.doc, before);
  assert.match(missing.result, /no segment with id "seg-9"\. Known ids: seg-1/);
});

test('a read record guards edits, and is returned updated rather than changed in place', () => {
  const before = doc();
  const reads = newReads();
  const blocked = applyTool(before, call('patch_segment', { id: 'seg-1', changes: { name: 'X' } }), { reads });
  assert.match(blocked.result, /has not been read this turn/);
  const got = applyTool(before, call('get_segment', { ids: ['seg-1'] }), { reads });
  assert.equal(reads.segments.size, 0, 'the caller\'s read record was mutated');
  assert.ok(got.reads.segments.has('seg-1'));
  const ok = applyTool(before, call('patch_segment', { id: 'seg-1', changes: { name: 'X' } }), { reads: got.reads });
  assert.match(ok.result, /^OK/);
});

test('without a read record the guard is off and stays off', () => {
  const before = doc();
  for (const c of [
    call('patch_segment', { id: 'seg-1', changes: { name: 'X' } }),
    call('update_segment', { id: 'seg-1', segment: { id: 'seg-1', type: 'event', name: 'X', date: '2026-09-19' } }),
    call('patch_list', { id: 'list-food', changes: { name: 'X' } }),
    call('patch_phrase_group', { id: 'phr-basics', changes: { name: 'X' } }),
  ]) {
    const out = applyTool(before, c);
    assert.match(out.result, /^OK/, `${c.name}: ${out.result}`);
    assert.equal(out.reads, null);
  }
  assert.equal(applyTool(before, call('get_segment', { ids: ['seg-1'] })).reads, null);
});

test('validators are parameters, and an absent one skips its check', () => {
  const before = doc();
  const reject = () => ({ ok: false, errors: [{ message: 'stub: rejected' }] });
  const c = call('add_segment', { segment: { type: 'event', name: 'Walk', date: '2026-09-20' } });
  assert.match(applyTool(before, c, { validators: { segment: reject } }).result, /^ERROR — segment failed schema validation[\s\S]*stub: rejected/);
  assert.match(applyTool(before, c, { validators: { trip: reject } }).result, /^OK/);
  assert.match(applyTool(before, call('patch_trip', { changes: { name: 'X' } }), { validators: { trip: reject } }).result, /^ERROR — trip failed/);
  assert.match(applyTool(before, call('add_list', { list: { name: 'X' } }), { validators: { list: reject } }).result, /^ERROR — list failed/);
  assert.match(applyTool(before, call('add_phrase_group', { group: { name: 'X' } }), { validators: { phraseGroup: reject } }).result, /^ERROR — phrase group failed/);
});

test('arguments may be an object or a JSON string', () => {
  const before = doc();
  const asString = applyTool(before, call('patch_trip', JSON.stringify({ changes: { name: 'A' } })));
  const asObject = applyTool(before, call('patch_trip', { changes: { name: 'A' } }));
  assert.equal(asString.doc.trip.name, 'A');
  assert.equal(asObject.doc.trip.name, 'A');
  assert.match(applyTool(before, call('patch_trip', '{oops')).result, /^ERROR: could not parse tool arguments/);
  assert.match(applyTool(before, call('nope', {})).result, /^ERROR: unknown tool "nope"/);
});
