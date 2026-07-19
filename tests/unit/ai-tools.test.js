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

beforeEach(() => {
  state.draft = { trip: { name: 'Trip', travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-28', currency_primary: 'GBP' }, segments: [baseSegment()] };
  state.ops = [];
  state.reads = new Set();
  delete globalThis.window.hValidateSegment;
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

test('unparseable tool arguments are reported, not thrown', () => {
  const res = applyTool({ id: 'c1', type: 'function', function: { name: 'add_segment', arguments: '{not json' } });
  assert.match(res, /^ERROR: could not parse tool arguments/);
});
