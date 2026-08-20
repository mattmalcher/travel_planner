// The room record and its rules (issue #124): where the key lives, what
// "unpushed" means, and — the part that decides whether live sharing is
// pleasant or maddening — what an automatically pulled document is allowed to
// do without asking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_PREFIX, roomKey, readRoom, writeRoom, forgetRoom, canWrite,
  unpushedCount, pullAction, pushed, aboveRev,
} from '../../src/lib/room.js';
import { deleteTrip, clearLibrary, writeDoc, forkOf } from '../../src/lib/library.js';

/** The same plain-object store lib/library.js is tested against. */
function fakeStore(seed = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
  };
}

const doc = (over = {}) => ({
  trip_id: 't1', rev: 5, trip: { name: 'Orbit City' }, segments: [], ...over,
});
const room = (over = {}) => ({ k: 'KKK', id: 'rid', enc: 'eee', rev_pushed: 5, etag: 'e5', ...over });

test('the record lives in its own key space, keyed by trip', () => {
  assert.equal(roomKey('t1'), `${ROOM_PREFIX}t1`);
  const store = fakeStore();
  writeRoom(store, 't1', room());
  assert.deepEqual(readRoom(store, 't1'), room());
  assert.equal(readRoom(store, 't2'), null);
});

test('junk in the slot reads as no room rather than throwing', () => {
  assert.equal(readRoom(fakeStore({ 'hShare:t1': 'not json' }), 't1'), null);
  assert.equal(readRoom(fakeStore({ 'hShare:t1': '{"no":"id"}' }), 't1'), null);
});

test('the master key is what makes a device a writer', () => {
  assert.equal(canWrite(room()), true);
  // A viewer link leaves the id and the content key and no `k` at all.
  assert.equal(canWrite({ id: 'rid', enc: 'eee' }), false);
  assert.equal(canWrite(null), false);
});

test('unpushed is rev minus rev_pushed, and never negative', () => {
  assert.equal(unpushedCount(doc({ rev: 8 }), room({ rev_pushed: 5 })), 3);
  assert.equal(unpushedCount(doc({ rev: 5 }), room({ rev_pushed: 5 })), 0);
  // A pull can leave the room ahead of the local copy for an instant; that is
  // "nothing to send", not "minus two to send".
  assert.equal(unpushedCount(doc({ rev: 3 }), room({ rev_pushed: 5 })), 0);
  assert.equal(unpushedCount(null, room()), 0);
});

test('deleting a trip forgets its room — a live link must not outlive it', () => {
  const store = fakeStore();
  writeDoc(store, doc());
  writeRoom(store, 't1', room());
  deleteTrip(store, 't1');
  assert.equal(readRoom(store, 't1'), null);
});

test('clearing the library forgets every room with it', () => {
  const store = fakeStore();
  writeDoc(store, doc());
  writeDoc(store, doc({ trip_id: 't2' }));
  writeRoom(store, 't1', room());
  writeRoom(store, 't2', room());
  clearLibrary(store);
  assert.equal(readRoom(store, 't1'), null);
  assert.equal(readRoom(store, 't2'), null);
});

test('a fork does not inherit the room, because the record follows the trip_id', () => {
  const store = fakeStore();
  writeRoom(store, 't1', room());
  const fork = forkOf(doc(), { nowIso: '2026-01-01T00:00:00Z' });
  assert.notEqual(fork.trip_id, 't1');
  // "Keep both" therefore means "leave the room" with nothing extra to unset.
  assert.equal(readRoom(store, fork.trip_id), null);
});

test('forgetting is explicit, because a kept key resurrects the room', () => {
  const store = fakeStore();
  writeRoom(store, 't1', room());
  forgetRoom(store, 't1');
  assert.equal(store.getItem('hShare:t1'), null);
});

/* --- what an automatic pull may do --------------------------------------- */

test('a newer version lands silently when nothing local is unpushed', () => {
  const local = doc({ rev: 5 });
  const incoming = doc({ rev: 6, trip: { name: 'Orbit City II' } });
  assert.equal(pullAction(incoming, local, room({ rev_pushed: 5 })).action, 'apply');
});

test('a newer version is parked when there are unpushed local edits', () => {
  const local = doc({ rev: 7, trip: { name: 'Mine' } });
  const incoming = doc({ rev: 8, trip: { name: 'Theirs' } });
  // Higher rev, but this device has work of its own that has not gone out —
  // applying would silently discard the reason the user is sitting here.
  const act = pullAction(incoming, local, room({ rev_pushed: 5 }));
  assert.equal(act.action, 'park');
  assert.equal(act.kind, 'newer');
});

test('a fork is always parked, never applied', () => {
  const local = doc({ rev: 6, trip: { name: 'Mine' } });
  const incoming = doc({ rev: 6, trip: { name: 'Theirs' } });
  const act = pullAction(incoming, local, room({ rev_pushed: 6 }));
  assert.equal(act.action, 'park');
  assert.equal(act.kind, 'fork');
});

test('a poll that regresses says nothing at all', () => {
  const local = doc({ rev: 9 });
  // KV is eventually consistent, so a stale edge can serve rev 8 after a fresh
  // one served rev 9. A poll going backwards must be silent, not a decision.
  assert.equal(pullAction(doc({ rev: 8, trip: { name: 'Old' } }), local, room({ rev_pushed: 9 })).action, 'drop');
  // And the version we already have is not news either.
  assert.equal(pullAction(doc({ rev: 9 }), local, room({ rev_pushed: 9 })).action, 'drop');
});

/* --- pushing ------------------------------------------------------------- */

test('a push records what went out and what it now sits on', () => {
  const after = pushed(room({ rev_pushed: 5, etag: 'e5' }), doc({ rev: 8 }), 'e8', '2026-05-01T09:00:00Z');
  assert.equal(after.rev_pushed, 8);
  assert.equal(after.etag, 'e8');
  assert.equal(after.last_push, '2026-05-01T09:00:00Z');
  assert.equal(after.k, 'KKK'); // the key is not disturbed by a push
});

test('"keep mine" numbers my content above theirs, never beside it', () => {
  // Pushing my rev 8 over their rev 8 would leave the *other* side seeing a
  // fork, permanently. One chain, so the next number is above both.
  assert.equal(aboveRev(8, 8), 9);
  assert.equal(aboveRev(8, 12), 13);
  assert.equal(aboveRev(12, 8), 13);
});
