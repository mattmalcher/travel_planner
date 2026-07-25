// The trip library (issue #80): document identity, the index, revision
// history and what happens when localStorage says no.
//
// lib/library.js takes the store as a parameter, so all of this runs against a
// plain object — including the quota path, which is otherwise only reachable
// on a phone in private browsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryFor, upsertIndex, removeFromIndex, sortIndex, readIndex, writeIndex,
  nextRevision, withIdentity, restoredFrom, copyIdentity, legacyTripId, newTripId,
  contentHash, sameContent, classifyImport, forkOf,
  writeDoc, readDoc, deleteTrip, clearLibrary, migrateLegacy,
  readHistory, writeHistory, nextHistory, historyMeta, safeSetItem,
  pruneOldestHistory, isQuotaError, currentTripId,
  INDEX_KEY, LEGACY_KEY, MIGRATED_KEY, docKey, histKey, HISTORY_CAP, COALESCE_MS,
} from '../../src/lib/library.js';

const NOW = '2026-07-25T12:00:00.000Z';

const trip = (name = 'Paris') => ({
  name, travellers: ['Judy Jetson'], start: '2026-09-18', end: '2026-09-21', currency_primary: 'GBP',
});

const doc = (over = {}) => ({
  trip_id: 'trip-a', rev: 1, updated_at: NOW, trip: trip(), segments: [], ...over,
});

/** A localStorage stand-in, optionally with a character budget so a write can
    be made to fail exactly as mobile Safari's does. */
function fakeStore(initial = {}, { limit = Infinity } = {}) {
  const map = new Map(Object.entries(initial));
  const used = skip => [...map].reduce((n, [k, v]) => n + (k === skip ? 0 : k.length + v.length), 0);
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (used(k) + k.length + String(v).length > limit) {
        const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e;
      }
      map.set(k, String(v));
    },
    removeItem: k => { map.delete(k); },
  };
}

/* --- identity ------------------------------------------------------------ */

test('a legacy document gets the same id wherever it is imported', () => {
  const a = { trip: trip(), segments: [{ id: 'seg-1' }] };
  const b = { trip: trip(), segments: [] }; // same trip, different contents
  assert.equal(legacyTripId(a), legacyTripId(b));
  assert.notEqual(legacyTripId(a), legacyTripId({ trip: trip('Rome') }));
  assert.match(legacyTripId(a), /^trip-[0-9a-f]{16}$/);
});

test('minted trip ids are uuid-shaped and distinct', () => {
  const a = newTripId(), b = newTripId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('withIdentity fills in only what is missing', () => {
  const settled = withIdentity({ trip: trip(), segments: [] }, { nowIso: NOW });
  assert.equal(settled.trip_id, legacyTripId({ trip: trip() }));
  assert.equal(settled.rev, 1);
  assert.equal(settled.updated_at, NOW);
  const kept = withIdentity(doc({ trip_id: 'keep', rev: 7, updated_at: 'x' }), { nowIso: NOW });
  assert.deepEqual([kept.trip_id, kept.rev, kept.updated_at], ['keep', 7, 'x']);
});

test('content comparison ignores the meta fields, not the itinerary', () => {
  const a = doc();
  assert.ok(sameContent(a, { ...a, rev: 9, updated_at: 'later', updated_by: 'Sarah', schema_version: '9.9.9' }));
  assert.ok(!sameContent(a, { ...a, segments: [{ id: 'seg-1' }] }));
  // Key order is not content.
  assert.equal(contentHash({ trip: trip(), segments: [] }), contentHash({ segments: [], trip: trip() }));
});

test('copyIdentity settles the loaded document in place, without replacing it', () => {
  const loaded = doc({ updated_by: 'Matt' });
  const same = copyIdentity(loaded, { trip_id: 'trip-a', rev: 2, updated_at: 'then' });
  assert.equal(same, loaded, 'the same object must come back — views hold references to it');
  assert.equal(loaded.rev, 2);
  assert.ok(!('updated_by' in loaded), 'a field the new revision drops must not linger');
});

/* --- rev bumping --------------------------------------------------------- */

test('rev is bumped on a real change and only then', () => {
  const stored = doc({ rev: 7 });
  const reopened = nextRevision({ ...stored }, stored, { nowIso: 'later', updatedBy: 'Matt' });
  assert.equal(reopened.changed, false);
  assert.equal(reopened.doc.rev, 7, 'opening a trip must not inflate its rev');
  assert.equal(reopened.doc.updated_at, NOW);

  const edited = nextRevision({ ...stored, segments: [{ id: 'seg-1' }] }, stored, { nowIso: 'later', updatedBy: 'Matt' });
  assert.equal(edited.changed, true);
  assert.equal(edited.doc.rev, 8);
  assert.equal(edited.doc.updated_at, 'later');
  assert.equal(edited.doc.updated_by, 'Matt');
});

test('a first save keeps the rev the document arrived with', () => {
  const { doc: out, changed } = nextRevision(doc({ rev: 4 }), null, { nowIso: 'later', updatedBy: 'Matt' });
  assert.equal(changed, true);
  assert.equal(out.rev, 4);
});

test('a document that already declares a newer rev is taken at its word', () => {
  const stored = doc({ rev: 7 });
  const incoming = doc({ rev: 9, segments: [{ id: 'seg-1' }], updated_by: 'Sarah' });
  const { doc: out } = nextRevision(incoming, stored, { nowIso: 'later', updatedBy: 'Matt' });
  assert.equal(out.rev, 9, 'an import must not be renumbered');
  assert.equal(out.updated_by, 'Sarah');
});

test('an empty updated_by is left off rather than stored as blank', () => {
  const stored = doc({ rev: 1 });
  const { doc: out } = nextRevision({ ...stored, segments: [{ id: 's' }] }, stored, { nowIso: 'later', updatedBy: '' });
  assert.ok(!('updated_by' in out));
});

/* --- the index ----------------------------------------------------------- */

test('an index row is derived from the document, so a rename needs no second write', () => {
  const row = entryFor(doc({ rev: 3, updated_by: 'Sarah', trip: trip('Rome') }));
  assert.deepEqual(row, {
    trip_id: 'trip-a', name: 'Rome', start: '2026-09-18', end: '2026-09-21',
    rev: 3, updated_at: NOW, updated_by: 'Sarah',
  });
});

test('upsert replaces the row for a trip and orders by most recently edited', () => {
  let index = [];
  index = upsertIndex(index, entryFor(doc({ trip_id: 'a', updated_at: '2026-01-01T00:00:00Z' })));
  index = upsertIndex(index, entryFor(doc({ trip_id: 'b', updated_at: '2026-03-01T00:00:00Z' })));
  index = upsertIndex(index, entryFor(doc({ trip_id: 'a', rev: 2, updated_at: '2026-04-01T00:00:00Z' })));
  assert.deepEqual(index.map(e => e.trip_id), ['a', 'b']);
  assert.equal(index.length, 2);
  assert.equal(index[0].rev, 2);
  index = removeFromIndex(index, 'a');
  assert.deepEqual(index.map(e => e.trip_id), ['b']);
});

test('equal timestamps fall back to rev, so a stopped clock still orders', () => {
  const at = '2026-04-01T00:00:00Z';
  const index = sortIndex([entryFor(doc({ trip_id: 'a', rev: 2, updated_at: at })), entryFor(doc({ trip_id: 'b', rev: 9, updated_at: at }))]);
  assert.deepEqual(index.map(e => e.trip_id), ['b', 'a']);
});

test('a corrupt index reads as empty rather than throwing', () => {
  assert.deepEqual(readIndex(fakeStore({ [INDEX_KEY]: 'not json' })), []);
  assert.deepEqual(readIndex(fakeStore({ [INDEX_KEY]: '{"nope":1}' })), []);
});

test('writing a document stores it, indexes it and makes it current', () => {
  const store = fakeStore();
  writeDoc(store, doc());
  assert.deepEqual(readDoc(store, 'trip-a'), doc());
  assert.deepEqual(readIndex(store).map(e => e.trip_id), ['trip-a']);
  assert.equal(currentTripId(store), 'trip-a');

  writeDoc(store, doc({ trip_id: 'trip-b', trip: trip('Rome') }));
  assert.deepEqual(readIndex(store).map(e => e.name).sort(), ['Paris', 'Rome']);
  assert.deepEqual(readDoc(store, 'trip-a').trip.name, 'Paris', 'a second trip must not evict the first');
});

test('deleting a trip takes its history and index row with it', () => {
  const store = fakeStore();
  writeDoc(store, doc());
  writeHistory(store, 'trip-a', [{ rev: 1, at: 1, enc: 'plain', data: '{}' }]);
  deleteTrip(store, 'trip-a');
  assert.equal(store.getItem(docKey('trip-a')), null);
  assert.equal(store.getItem(histKey('trip-a')), null);
  assert.deepEqual(readIndex(store), []);
  assert.equal(currentTripId(store), null);
});

test('clearing the library leaves nothing of it behind', () => {
  const store = fakeStore({ [LEGACY_KEY]: '{}', [MIGRATED_KEY]: '1' });
  writeDoc(store, doc());
  writeDoc(store, doc({ trip_id: 'trip-b' }));
  writeHistory(store, 'trip-b', [{ rev: 1, at: 1, enc: 'plain', data: '{}' }]);
  clearLibrary(store);
  assert.deepEqual([...store.map.keys()], []);
});

/* --- migration ----------------------------------------------------------- */

test('a pre-library hItinerary becomes the first library entry', () => {
  const legacy = { trip: trip(), segments: [{ id: 'seg-1' }] };
  const store = fakeStore({ [LEGACY_KEY]: JSON.stringify(legacy) });
  const migrated = migrateLegacy(store, { nowIso: NOW });
  assert.equal(migrated.trip_id, legacyTripId(legacy));
  assert.equal(migrated.rev, 1);
  assert.deepEqual(readIndex(store).map(e => e.name), ['Paris']);
  assert.equal(currentTripId(store), migrated.trip_id);
  assert.equal(store.getItem(LEGACY_KEY), JSON.stringify(legacy), 'the old value stays as a backup for a release');
});

test('migration runs once, so deleting the migrated trip does not resurrect it', () => {
  const store = fakeStore({ [LEGACY_KEY]: JSON.stringify({ trip: trip(), segments: [] }) });
  const migrated = migrateLegacy(store, { nowIso: NOW });
  deleteTrip(store, migrated.trip_id);
  assert.equal(migrateLegacy(store, { nowIso: NOW }), null);
  assert.deepEqual(readIndex(store), []);
});

test('migration ignores an empty or unusable legacy value', () => {
  assert.equal(migrateLegacy(fakeStore(), { nowIso: NOW }), null);
  assert.equal(migrateLegacy(fakeStore({ [LEGACY_KEY]: 'nonsense' }), { nowIso: NOW }), null);
  assert.equal(migrateLegacy(fakeStore({ [LEGACY_KEY]: '{"no":"trip"}' }), { nowIso: NOW }), null);
});

test('migration does not steal the current trip from a library already in use', () => {
  const store = fakeStore({ [LEGACY_KEY]: JSON.stringify({ trip: trip('Old'), segments: [] }) });
  writeDoc(store, doc({ trip_id: 'trip-b' }));
  migrateLegacy(store, { nowIso: NOW });
  assert.equal(currentTripId(store), 'trip-b');
  assert.equal(readIndex(store).length, 2);
});

/* --- import decisions ---------------------------------------------------- */

test('importing classifies the file against the copy already held', () => {
  const stored = doc({ rev: 7 });
  assert.equal(classifyImport(doc({ rev: 1 }), null).kind, 'new');
  assert.equal(classifyImport({ ...stored, updated_by: 'Sarah' }, stored).kind, 'duplicate');
  assert.equal(classifyImport({ ...stored, rev: 9, segments: [{ id: 's' }] }, stored).kind, 'newer');
  assert.equal(classifyImport({ ...stored, rev: 3, segments: [{ id: 's' }] }, stored).kind, 'older');
  const fork = classifyImport({ ...stored, segments: [{ id: 's' }] }, stored);
  assert.deepEqual(fork, { kind: 'fork', rev: 7, mine: 7 });
});

test('keeping both gives the incoming copy its own id and a note of its origin', () => {
  const forked = forkOf(doc({ rev: 7 }), { tripId: 'trip-new', nowIso: 'later', updatedBy: 'Sarah' });
  assert.equal(forked.trip_id, 'trip-new');
  assert.deepEqual(forked.forked_from, { trip_id: 'trip-a', rev: 7 });
  assert.equal(forked.updated_by, 'Sarah');
  // A fork is a different trip, so the two no longer collide on import.
  assert.equal(classifyImport(forked, doc({ rev: 7 })).kind, 'fork');
  assert.equal(forkOf(doc()).trip_id.length, 36);
});

/* --- revision history ---------------------------------------------------- */

const entry = (rev, at) => ({ rev, at, enc: 'plain', data: `{"rev":${rev}}` });

test('history keeps one entry per superseded revision, oldest first', () => {
  let list = [];
  list = nextHistory(list, entry(1, 0));
  list = nextHistory(list, entry(2, 10 * COALESCE_MS));
  assert.deepEqual(list.map(e => e.rev), [1, 2]);
});

test('a burst of edits leaves the state the burst started from', () => {
  let list = nextHistory([], entry(1, 0));
  list = nextHistory(list, entry(2, 10 * COALESCE_MS));        // a separate sitting
  list = nextHistory(list, entry(3, 10 * COALESCE_MS + 1000)); // …then a flurry
  list = nextHistory(list, entry(4, 10 * COALESCE_MS + 2000));
  assert.deepEqual(list.map(e => e.rev), [1, 2],
    'the flurry costs one slot, and rev 2 is what winding it back means');
});

test('the same rev is not recorded twice', () => {
  const list = nextHistory([entry(3, 0)], entry(3, 10 * COALESCE_MS));
  assert.deepEqual(list.map(e => e.rev), [3]);
});

test('history is capped, dropping the oldest', () => {
  let list = [];
  for (let i = 1; i <= HISTORY_CAP + 10; i++) list = nextHistory(list, entry(i, i * 10 * COALESCE_MS));
  assert.equal(list.length, HISTORY_CAP);
  assert.equal(list[0].rev, 11);
  assert.equal(list[list.length - 1].rev, HISTORY_CAP + 10);
});

test('an entry carries what the picker shows without decompressing anything', () => {
  assert.deepEqual(historyMeta(doc({ rev: 3, updated_by: 'Sarah' }), 1234),
    { rev: 3, updated_at: NOW, at: 1234, updated_by: 'Sarah' });
  assert.ok(!('updated_by' in historyMeta(doc(), 1)));
});

test('restoring is append-only: the counter never goes backwards', () => {
  const current = doc({ rev: 9, updated_by: 'Sarah', schema_version: '3.4.0' });
  const snapshot = doc({ rev: 3, updated_at: 'then', updated_by: 'Matt', segments: [{ id: 'old' }] });
  const restored = restoredFrom(current, snapshot, { nowIso: 'now', updatedBy: 'Matt' });
  assert.equal(restored.rev, 10, 'rev 3 restored at rev 9 is written as rev 10');
  assert.equal(restored.trip_id, 'trip-a');
  assert.equal(restored.updated_at, 'now');
  assert.equal(restored.schema_version, '3.4.0');
  assert.deepEqual(restored.segments, [{ id: 'old' }], 'the content is the snapshot’s');
  // …and saving it does not renumber it again.
  assert.equal(nextRevision(restored, current, { nowIso: 'now', updatedBy: 'Matt' }).doc.rev, 10);
});

/* --- quota --------------------------------------------------------------- */

test('a full quota spends history rather than losing the working copy', () => {
  const store = fakeStore({}, { limit: 900 });
  writeDoc(store, doc());
  // Three revisions of padding, the oldest first.
  writeHistory(store, 'trip-a', [1, 2, 3].map(rev => ({ rev, at: rev, enc: 'plain', data: 'x'.repeat(100) })));
  const before = readHistory(store, 'trip-a').length;

  const bigger = JSON.stringify(doc({ segments: [{ id: 'seg-1', notes: 'y'.repeat(200) }] }));
  safeSetItem(store, docKey('trip-a'), bigger);

  assert.equal(store.getItem(docKey('trip-a')), bigger, 'the working copy landed');
  const after = readHistory(store, 'trip-a');
  assert.ok(after.length < before, 'revisions were spent to make room');
  assert.ok(after.every(e => e.rev > 1), 'the oldest went first');
});

test('a write that no amount of pruning can fit still throws', () => {
  const store = fakeStore({}, { limit: 400 });
  writeDoc(store, doc());
  assert.throws(() => safeSetItem(store, docKey('trip-a'), 'z'.repeat(500)), e => isQuotaError(e));
});

test('pruning reports when there is nothing left to spend', () => {
  const store = fakeStore();
  writeDoc(store, doc());
  assert.equal(pruneOldestHistory(store), false);
  writeHistory(store, 'trip-a', [entry(1, 1)]);
  assert.equal(pruneOldestHistory(store), true);
  assert.deepEqual(readHistory(store, 'trip-a'), []);
});

test('the quota error is recognised under the names the engines give it', () => {
  assert.ok(isQuotaError({ name: 'QuotaExceededError' }));
  assert.ok(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }));
  assert.ok(isQuotaError({ code: 22 }));
  assert.ok(!isQuotaError(new TypeError('nope')));
  assert.ok(!isQuotaError(null));
});

test('the index write goes through the same quota guard', () => {
  const store = fakeStore({}, { limit: 900 });
  writeDoc(store, doc());
  writeHistory(store, 'trip-a', [1, 2].map(rev => ({ rev, at: rev, enc: 'plain', data: 'x'.repeat(200) })));
  writeIndex(store, [...readIndex(store), entryFor(doc({ trip_id: 'trip-b', trip: trip('A very long trip name '.repeat(8)) }))]);
  assert.equal(readIndex(store).length, 2);
});
