// The saved chat transcript (issue #99). lib/chat-history.js takes the store
// as a parameter, so the caps and the quota path run against a plain object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trimChat, writeChat, readChat, clearChat, CHAT_KEY, MAX_MESSAGES,
} from '../../src/lib/chat-history.js';

/** A localStorage stand-in with an optional character budget, so a write can be
    made to fail exactly as mobile Safari's does. */
function fakeStore(initial = {}, { limit = Infinity } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (String(v).length > limit) {
        const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e;
      }
      map.set(k, String(v));
    },
    removeItem: k => { map.delete(k); },
  };
}

const msg = (i, content = 'hello ' + i) => ({ role: i % 2 ? 'assistant' : 'user', content });
const many = n => Array.from({ length: n }, (_, i) => msg(i));

/* --- trimming ------------------------------------------------------------ */

test('a short transcript is kept whole', () => {
  const chat = many(3);
  assert.deepEqual(trimChat(chat), chat);
});

test('the newest messages win when there are too many', () => {
  const kept = trimChat(many(MAX_MESSAGES + 5));
  assert.equal(kept.length, MAX_MESSAGES);
  assert.equal(kept[kept.length - 1].content, 'hello ' + (MAX_MESSAGES + 4));
});

test('the character budget drops the oldest messages', () => {
  const chat = [msg(0, 'a'.repeat(80)), msg(1, 'b'.repeat(80)), msg(2, 'c'.repeat(80))];
  const kept = trimChat(chat, 50, 170);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].content[0], 'b');
});

test('one message longer than the whole budget is truncated, not dropped', () => {
  const kept = trimChat([msg(0, 'x'.repeat(500))], 50, 100);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].content.length, 100);
});

test('only role and content are stored — no view state rides along', () => {
  const kept = trimChat([{ role: 'user', content: 'hi', pending: true }]);
  assert.deepEqual(kept, [{ role: 'user', content: 'hi' }]);
});

/* --- round trip ---------------------------------------------------------- */

test('a transcript comes back for the trip it was saved against', () => {
  const store = fakeStore();
  assert.equal(writeChat(store, 'trip-a', many(2)), true);
  assert.deepEqual(readChat(store, 'trip-a'), many(2));
});

test('it stays hidden under another trip', () => {
  const store = fakeStore();
  writeChat(store, 'trip-a', many(2));
  assert.deepEqual(readChat(store, 'trip-b'), []);
  assert.deepEqual(readChat(store, null), []);
});

test('an empty transcript removes the slot rather than storing nothing', () => {
  const store = fakeStore();
  writeChat(store, 'trip-a', many(2));
  writeChat(store, 'trip-a', []);
  assert.equal(store.getItem(CHAT_KEY), null);
});

test('clearing forgets it', () => {
  const store = fakeStore();
  writeChat(store, 'trip-a', many(2));
  clearChat(store);
  assert.deepEqual(readChat(store, 'trip-a'), []);
});

/* --- what arrives is not trusted ----------------------------------------- */

test('damaged or foreign stored data reads as no history', () => {
  assert.deepEqual(readChat(fakeStore({ [CHAT_KEY]: 'not json' }), 'trip-a'), []);
  assert.deepEqual(readChat(fakeStore({ [CHAT_KEY]: '{"trip_id":"trip-a"}' }), 'trip-a'), []);
  assert.deepEqual(readChat(fakeStore(), 'trip-a'), []);
});

test('messages that are not a plain user/assistant line are dropped', () => {
  const store = fakeStore({
    [CHAT_KEY]: JSON.stringify({
      trip_id: 'trip-a',
      messages: [{ role: 'user', content: 'keep' }, { role: 'system', content: 'drop' },
        { role: 'assistant' }, null, { role: 'assistant', content: 'keep too' }],
    }),
  });
  assert.deepEqual(readChat(store, 'trip-a'),
    [{ role: 'user', content: 'keep' }, { role: 'assistant', content: 'keep too' }]);
});

/* --- quota: history is expendable, the trips are not --------------------- */

test('a write that does not fit drops the history instead of failing', () => {
  const store = fakeStore({ hTrips: '[]' }, { limit: 40 });
  writeChat(store, 'trip-a', many(2));
  assert.equal(store.getItem(CHAT_KEY), null);
  assert.equal(writeChat(store, 'trip-a', many(2)), false);
  assert.equal(store.getItem('hTrips'), '[]'); // the library is untouched
});
