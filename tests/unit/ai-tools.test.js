// applyTool / buildTools from the AI assistant (src/ai/tools.js). The module
// only touches the DOM-ish globals (window, localStorage) at call time, so a
// couple of stubs make it unit-testable under node (issues #42, #41, #43).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };

const { applyTool, buildTools } = await import('../../src/ai/tools.js');
const { state } = await import('../../src/state.js');

const call = (name, args) => ({ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } });

const baseSegment = () => ({
  id: 'seg-1', type: 'transport', mode: 'train', operator: 'Eurostar', date: '2026-09-18',
  departs: { place: 'London', time: '16:31' }, arrives: { place: 'Paris', time: '19:49' }, duration_min: 138,
});

const baseList = () => ({
  id: 'list-food', name: 'Foods to try', kind: 'food',
  items: [{ id: 'li-1', name: 'Custard tart', note: 'best warm' }],
});

beforeEach(() => {
  state.draft = {
    trip: { name: 'Trip', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP' },
    segments: [baseSegment()],
    lists: [baseList()],
  };
  state.ops = [];
  state.reads = new Set();
  state.listReads = new Set();
  delete globalThis.window.hValidateSegment;
  delete globalThis.window.hValidateTrip;
  delete globalThis.window.hValidateList;
});

test('tool schemas type payload params as objects, not *_json strings', () => {
  const byName = Object.fromEntries(buildTools().filter(t => t.function).map(t => [t.function.name, t.function.parameters]));
  assert.equal(byName.add_segment.properties.segment.type, 'object');
  assert.deepEqual(byName.add_segment.required, ['segment']);
  assert.equal(byName.patch_segment.properties.changes.type, 'object');
  assert.deepEqual(byName.patch_segment.required, ['id', 'changes']);
  assert.equal(byName.update_segment.properties.segment.type, 'object');
  assert.equal(byName.update_trip.properties.trip.type, 'object');
  for (const params of Object.values(byName))
    for (const prop of Object.keys(params.properties)) assert.ok(!prop.endsWith('_json'), prop);
});

test('add_segment accepts a typed object payload', () => {
  const seg = { ...baseSegment(), id: 'seg-2' };
  const res = applyTool(call('add_segment', { segment: seg }));
  assert.match(res, /^OK/);
  assert.equal(state.draft.segments.length, 2);
  assert.deepEqual(state.ops, [{ kind: 'add', after: state.draft.segments[1] }]);
});

test('add_segment still accepts a JSON-encoded string payload', () => {
  const seg = { ...baseSegment(), id: 'seg-2' };
  assert.match(applyTool(call('add_segment', { segment: JSON.stringify(seg) })), /^OK/);
  assert.equal(state.draft.segments.length, 2);
});

test('add_segment still accepts the legacy segment_json argument name', () => {
  const seg = { ...baseSegment(), id: 'seg-2' };
  assert.match(applyTool(call('add_segment', { segment_json: JSON.stringify(seg) })), /^OK/);
  assert.equal(state.draft.segments.length, 2);
});

test('add_segment rejects a payload that is not an object', () => {
  const res = applyTool(call('add_segment', { segment: 42 }));
  assert.match(res, /^ERROR/);
  assert.match(res, /must be a JSON object/);
  assert.equal(state.draft.segments.length, 1);
});

test('patch_segment merges a typed changes object', () => {
  state.reads.add('seg-1');
  const res = applyTool(call('patch_segment', { id: 'seg-1', changes: { departs: { time: '17:01' }, notes: 'moved' } }));
  assert.match(res, /^OK/);
  const seg = state.draft.segments[0];
  assert.equal(seg.departs.time, '17:01');
  assert.equal(seg.departs.place, 'London');
  assert.equal(seg.notes, 'moved');
});

test('patch_segment still accepts the legacy changes_json string', () => {
  state.reads.add('seg-1');
  const res = applyTool(call('patch_segment', { id: 'seg-1', changes_json: JSON.stringify({ notes: 'moved' }) }));
  assert.match(res, /^OK/);
  assert.equal(state.draft.segments[0].notes, 'moved');
});

test('update_segment replaces via typed object and respects the read guard', () => {
  const seg = { ...baseSegment(), operator: 'SNCF' };
  assert.match(applyTool(call('update_segment', { id: 'seg-1', segment: seg })), /has not been read this turn/);
  state.reads.add('seg-1');
  assert.match(applyTool(call('update_segment', { id: 'seg-1', segment: seg })), /^OK/);
  assert.equal(state.draft.segments[0].operator, 'SNCF');
});

test('update_trip accepts a typed trip object (and legacy trip_json)', () => {
  const trip = { ...state.draft.trip, name: 'Renamed' };
  assert.match(applyTool(call('update_trip', { trip })), /^OK/);
  assert.equal(state.draft.trip.name, 'Renamed');
  assert.match(applyTool(call('update_trip', { trip_json: JSON.stringify({ ...trip, name: 'Again' }) })), /^OK/);
  assert.equal(state.draft.trip.name, 'Again');
});

test('patch_trip merges changes into the trip, keeping unseen fields', () => {
  const before = state.draft.trip;
  const res = applyTool(call('patch_trip', { changes: { name: 'Renamed' } }));
  assert.match(res, /^OK/);
  assert.equal(state.draft.trip.name, 'Renamed');
  assert.deepEqual(state.draft.trip.travellers, ['Judy Jetson']);
  assert.equal(state.draft.trip.currency_primary, 'GBP');
  assert.deepEqual(state.ops, [{ kind: 'trip', before, after: state.draft.trip }]);
});

test('patch_trip validates the resulting trip and reports errors', () => {
  globalThis.window.hValidateTrip = () => ({ ok: false, errors: [{ path: '/end', message: 'stub: bad trip' }] });
  const res = applyTool(call('patch_trip', { changes: { end: 'not-a-date' } }));
  assert.match(res, /^ERROR — trip failed schema validation/);
  assert.match(res, /stub: bad trip/);
  assert.equal(state.draft.trip.end, '2026-09-28');
  assert.equal(state.ops.length, 0);
});

test('update_trip validates the replacement trip', () => {
  globalThis.window.hValidateTrip = () => ({ ok: false, errors: [{ path: '/', message: 'stub: bad trip' }] });
  const res = applyTool(call('update_trip', { trip: { name: 'Only a name' } }));
  assert.match(res, /^ERROR — trip failed schema validation/);
  assert.equal(state.draft.trip.name, 'Trip');
});

test('segment validation failures are returned as errors', () => {
  globalThis.window.hValidateSegment = () => ({ ok: false, errors: [{ path: '/', message: 'stub: invalid' }] });
  const res = applyTool(call('add_segment', { segment: { ...baseSegment(), id: 'seg-2' } }));
  assert.match(res, /^ERROR/);
  assert.match(res, /stub: invalid/);
  assert.equal(state.draft.segments.length, 1);
});

test('add_segment assigns an id when the payload omits one, and returns it', () => {
  const seg = baseSegment(); delete seg.id;
  const res = applyTool(call('add_segment', { segment: seg }));
  const m = res.match(/^OK — created segment "(seg-[a-z0-9]{5})"/);
  assert.ok(m, res);
  assert.equal(state.draft.segments[1].id, m[1]);
  assert.ok(state.reads.has(m[1]));
});

test('add_segment overrides a colliding id instead of creating a duplicate', () => {
  const res = applyTool(call('add_segment', { segment: baseSegment() })); // reuses seg-1
  const m = res.match(/created segment "(seg-[a-z0-9]{5})"/);
  assert.ok(m, res);
  assert.notEqual(m[1], 'seg-1');
  assert.deepEqual(state.draft.segments.map(s => s.id), ['seg-1', m[1]]);
});

test('add_segment keeps a supplied id that is unique', () => {
  const res = applyTool(call('add_segment', { segment: { ...baseSegment(), id: 'seg-2' } }));
  assert.match(res, /created segment "seg-2"/);
});

test('update_segment rejects a replacement carrying another segment\'s id', () => {
  applyTool(call('add_segment', { segment: { ...baseSegment(), id: 'seg-2' } }));
  state.reads.add('seg-1');
  const res = applyTool(call('update_segment', { id: 'seg-1', segment: { ...baseSegment(), id: 'seg-2' } }));
  assert.match(res, /^ERROR: replacement id "seg-2" already belongs to another segment/);
  assert.equal(state.draft.segments[0].id, 'seg-1');
});

test('wrong-id errors list the known ids so the model can self-correct', () => {
  for (const res of [
    applyTool(call('get_segment', { ids: ['seg-9'] })),
    applyTool(call('patch_segment', { id: 'seg-9', changes: { notes: 'x' } })),
    applyTool(call('update_segment', { id: 'seg-9', segment: baseSegment() })),
    applyTool(call('remove_segment', { id: 'seg-9' })),
  ]) {
    assert.match(res, /^ERROR: no segment with id "seg-9"/);
    assert.match(res, /Known ids: seg-1/);
  }
});

test('get_list returns full list JSON and marks it read (issue #40)', () => {
  const res = applyTool(call('get_list', { ids: ['list-food'] }));
  assert.deepEqual(JSON.parse(res), baseList());
  assert.ok(state.listReads.has('list-food'));
});

test('patch_list enforces the read-before-edit guard', () => {
  const changes = { items: [{ id: 'li-1', name: 'Custard tart', note: 'best warm', done: true }] };
  assert.match(applyTool(call('patch_list', { id: 'list-food', changes })), /has not been read this turn/);
  state.listReads.add('list-food');
  assert.match(applyTool(call('patch_list', { id: 'list-food', changes })), /^OK/);
  assert.equal(state.draft.lists[0].items[0].done, true);
  assert.deepEqual(state.ops.map(o => o.kind), ['update-list']);
});

test('add_list assigns list and item ids and returns them', () => {
  const res = applyTool(call('add_list', { list: { name: 'Packing', kind: 'packing', items: [{ name: 'Passports' }] } }));
  const m = res.match(/^OK — created list "(list-[a-z0-9]{5})" with item ids (li-[a-z0-9]{5})/);
  assert.ok(m, res);
  const added = state.draft.lists[1];
  assert.equal(added.id, m[1]);
  assert.equal(added.items[0].id, m[2]);
  assert.ok(state.listReads.has(m[1])); // authored in full — editable without a read
});

test('add_list overrides colliding list and item ids instead of duplicating', () => {
  const res = applyTool(call('add_list', { list: { id: 'list-food', name: 'Again', items: [{ id: 'li-1', name: 'x' }] } }));
  assert.match(res, /^OK/);
  const added = state.draft.lists[1];
  assert.notEqual(added.id, 'list-food');
  assert.notEqual(added.items[0].id, 'li-1');
});

test('remove_list removes by id and records the op', () => {
  assert.match(applyTool(call('remove_list', { id: 'list-food' })), /^OK/);
  assert.deepEqual(state.draft.lists, []);
  assert.deepEqual(state.ops.map(o => o.kind), ['remove-list']);
});

test('wrong list ids list the known list ids so the model can self-correct', () => {
  for (const res of [
    applyTool(call('get_list', { ids: ['list-9'] })),
    applyTool(call('patch_list', { id: 'list-9', changes: { name: 'x' } })),
    applyTool(call('remove_list', { id: 'list-9' })),
  ]) {
    assert.match(res, /^ERROR: no list with id "list-9"/);
    assert.match(res, /Known list ids: list-food/);
  }
});

test('list validation failures are returned as errors', () => {
  globalThis.window.hValidateList = () => ({ ok: false, errors: [{ path: '/', message: 'stub: bad list' }] });
  const res = applyTool(call('add_list', { list: { name: 'Broken' } }));
  assert.match(res, /^ERROR — list failed schema validation/);
  assert.equal(state.draft.lists.length, 1);
});

test('list tools work on a document that has no lists array yet', () => {
  delete state.draft.lists;
  assert.match(applyTool(call('add_list', { list: { name: 'First' } })), /^OK/);
  assert.equal(state.draft.lists.length, 1);
});

test('unparseable tool arguments are reported, not thrown', () => {
  const res = applyTool({ id: 'c1', type: 'function', function: { name: 'add_segment', arguments: '{not json' } });
  assert.match(res, /^ERROR: could not parse tool arguments/);
});
