// Edit-modal form model (issue #65): the descriptors are resolved from the
// real schema, so these tests double as a drift check between LAYOUT and
// schema/holiday_itinerary_schema.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LAYOUT, specFromSchema, fieldsFor, getValue, inputValue,
  parseField, applyForm, uncoveredPaths,
} from '../../src/lib/edit-form.js';

const schema = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../schema/holiday_itinerary_schema.json', import.meta.url)), 'utf8'));
const spec = specFromSchema(schema);
const byPath = (fields, path) => fields.find(f => f.path === path);

test('every layout path resolves against the schema', () => {
  assert.deepEqual(Object.keys(spec), Object.keys(LAYOUT));
  for (const [kind, fields] of Object.entries(spec))
    assert.equal(fields.length, LAYOUT[kind].length);
});

test('a layout path the schema does not have fails loudly', () => {
  assert.throws(
    () => specFromSchema({ properties: { trip: { properties: {} } }, definitions: {} }),
    /trip\.name is not in the schema/,
  );
});

test('input kinds come from the schema, not the label', () => {
  const ev = spec.event;
  assert.equal(byPath(ev, 'date').kind, 'date');          // format: date
  assert.equal(byPath(ev, 'time').kind, 'time');          // HH:MM pattern
  assert.equal(byPath(ev, 'all_day').kind, 'checkbox');   // boolean
  assert.equal(byPath(ev, 'url').kind, 'url');            // format: uri
  assert.equal(byPath(ev, 'notes').kind, 'textarea');     // multiline layout opt
  assert.equal(byPath(ev, 'venue').kind, 'text');
  assert.equal(byPath(spec.trip, 'travellers').kind, 'csv'); // array of strings
  const dur = byPath(ev, 'duration_min');
  assert.equal(dur.kind, 'number');
  assert.deepEqual([dur.step, dur.min], ['1', 1]);        // integer, minimum 1
  const lat = byPath(ev, 'lat');
  assert.deepEqual([lat.step, lat.min, lat.max], ['any', -90, 90]);
});

test('enums become selects, optional ones with a blank choice', () => {
  const subtype = byPath(spec.event, 'subtype');
  assert.equal(subtype.kind, 'select');
  assert.deepEqual(subtype.options, schema.definitions.EventSegment.properties.subtype.enum);
  assert.equal(subtype.allowEmpty, undefined); // required
  assert.equal(byPath(spec.event, 'proposal.status').allowEmpty, true);
  assert.deepEqual(byPath(spec.transport, 'mode').options, ['train', 'bus', 'ferry', 'flight', 'taxi']);
});

test('required is tracked through nested paths', () => {
  // departs is required on the segment and time is required on the stop.
  assert.equal(byPath(spec.transport, 'departs.time').required, true);
  // cost is required, but its amount is not.
  assert.equal(byPath(spec.transport, 'cost.status').required, true);
  assert.equal(byPath(spec.transport, 'cost.amount').required, undefined);
  // proposal itself is optional, so nothing under it is required.
  assert.equal(byPath(spec.event, 'proposal.status').required, undefined);
});

test('fieldsFor picks the list for a target, null for anything unknown', () => {
  assert.equal(fieldsFor(spec, 'event'), spec.event);
  assert.equal(fieldsFor(spec, 'sleepover'), null);
  assert.equal(fieldsFor(spec, undefined), null);
});

test('inputValue renders stored values for their control', () => {
  const seg = { name: 'Gig', duration_min: 90, all_day: true, cost: { amount: 12.5 } };
  assert.equal(inputValue(byPath(spec.event, 'name'), seg), 'Gig');
  assert.equal(inputValue(byPath(spec.event, 'duration_min'), seg), '90');
  assert.equal(inputValue(byPath(spec.event, 'cost.amount'), seg), '12.5');
  assert.equal(inputValue(byPath(spec.event, 'all_day'), seg), true);
  assert.equal(inputValue(byPath(spec.event, 'venue'), seg), '');       // absent
  assert.equal(inputValue(byPath(spec.event, 'time'), {}), '');         // absent nested parent
  assert.equal(inputValue(byPath(spec.trip, 'travellers'),
    { travellers: ['Judy Jetson', 'George Jetson'] }), 'Judy Jetson, George Jetson');
});

test('parseField: blanks drop the key, numbers parse, checkboxes follow required', () => {
  const amount = byPath(spec.event, 'cost.amount');
  assert.equal(parseField(amount, '42.5'), 42.5);
  assert.equal(parseField(amount, ''), undefined);
  assert.equal(parseField(amount, '  '), undefined);
  // Unparseable numbers survive as typed so schema validation reports them
  // rather than the form silently dropping the value.
  assert.equal(parseField(amount, 'twelve'), 'twelve');
  assert.deepEqual(parseField(byPath(spec.trip, 'travellers'), 'Judy , George ,'),
    ['Judy', 'George']);
  assert.equal(parseField(byPath(spec.trip, 'travellers'), ' , '), undefined);
  // Optional booleans disappear when unticked; required ones stay as false.
  assert.equal(parseField(byPath(spec.event, 'all_day'), false), undefined);
  assert.equal(parseField(byPath(spec.event, 'all_day'), true), true);
  assert.equal(parseField(byPath(spec.accommodation, 'self_checkin'), false), false);
});

test('applyForm keeps fields the form does not cover', () => {
  const seg = {
    id: 'seg-1', type: 'transport', mode: 'train', operator: 'Eurostar',
    date: '2026-09-18',
    departs: { place: 'London St Pancras', time: '16:31', lat: 51.53, lng: -0.12 },
    arrives: { place: 'Paris Gare du Nord', time: '19:49' },
    duration_min: 138,
    seats: [{ traveller: 'Judy Jetson', coach: 5, seat: 41 }],
    cost: { amount: 156, currency: 'GBP', status: 'paid', payments: [{ amount: 156, status: 'paid' }] },
  };
  const raw = {};
  for (const f of spec.transport) raw[f.path] = inputValue(f, seg);
  raw['operator'] = 'TGV Lyria';
  raw['departs.time'] = '17:02';

  const out = applyForm(seg, spec.transport, raw);
  assert.equal(out.operator, 'TGV Lyria');
  assert.equal(out.departs.time, '17:02');
  assert.deepEqual(out.seats, seg.seats);                 // untouched
  assert.deepEqual(out.cost.payments, seg.cost.payments); // untouched
  assert.equal(out.departs.lat, 51.53);                   // nested and uncovered
  assert.equal(out.duration_min, 138);                    // number, not "138"
  assert.equal(seg.operator, 'Eurostar');                 // input not mutated
});

test('applyForm drops emptied keys and the containers left behind', () => {
  const seg = {
    id: 'seg-2', type: 'event', subtype: 'gig', name: 'Jazz', date: '2026-09-19',
    time: '21:00', cost: { status: 'free' }, proposal: { status: 'suggested' },
  };
  const raw = {};
  for (const f of spec.event) raw[f.path] = inputValue(f, seg);
  raw['time'] = '';
  raw['proposal.status'] = '';

  const out = applyForm(seg, spec.event, raw);
  assert.equal('time' in out, false);
  assert.equal('proposal' in out, false); // emptied container, not left as {}
  assert.deepEqual(out.cost, { status: 'free' });
});

test('uncoveredPaths lists what only the JSON tab reaches', () => {
  const seg = {
    id: 'seg-1', type: 'transport', mode: 'train', operator: 'Eurostar',
    date: '2026-09-18', duration_min: 138,
    departs: { place: 'A', time: '10:00', lat: 51.5 },
    arrives: { place: 'B', time: '12:00' },
    pass_id: 'IR01', warnings: ['Bring the pass'],
    seats: [{ traveller: 'Judy', coach: 5, seat: 41 }],
    cost: { status: 'paid', amount: 156, payments: [] },
  };
  assert.deepEqual(uncoveredPaths(seg, spec.transport),
    ['departs.lat', 'pass_id', 'warnings', 'seats', 'cost.payments']);
  // id/type are identity, never listed; a fully covered segment lists nothing.
  assert.deepEqual(uncoveredPaths({ id: 'x', type: 'event', name: 'N' }, spec.event), []);
});

test('getValue walks dotted paths without throwing on gaps', () => {
  assert.equal(getValue({ cost: { amount: 5 } }, 'cost.amount'), 5);
  assert.equal(getValue({}, 'cost.amount'), undefined);
  assert.equal(getValue(null, 'cost.amount'), undefined);
});
