// newId (src/lib/ids.js). Untested until the desktop CLI started minting ids
// from the terminal (`itin ids`), which made the collision guarantee something a
// human relies on rather than an internal detail of the AI tools.
//
// The randomness is the point, not an implementation accident: a mistyped or
// guessed id should miss and error loudly rather than resolve to whichever real
// record it happens to name (issue #41). Sequential seg-N ids made a guessed id
// usually *exist*.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newId } from '../../src/lib/ids.js';

test('an id is its prefix plus five base-36 characters', () => {
  const id = newId('seg-', new Set());
  assert.ok(id.startsWith('seg-'), id);
  assert.equal(id.length, 'seg-'.length + 5);
  assert.match(id.slice('seg-'.length), /^[0-9a-z]{5}$/);
});

test('an id already taken is never handed out', () => {
  // Leave exactly one three-character alphabet free, so collisions are near
  // certain unless the guard works.
  const taken = new Set();
  for (let i = 0; i < 500; i++) taken.add(newId('x-', taken));
  assert.equal(taken.size, 500);
  for (let i = 0; i < 200; i++) assert.ok(!taken.has(newId('x-', taken)));
});

test('threading the taken set through a batch keeps the batch distinct', () => {
  const taken = new Set();
  const batch = [];
  for (let i = 0; i < 50; i++) { const id = newId('li-', taken); taken.add(id); batch.push(id); }
  assert.equal(new Set(batch).size, 50);
});

test('every prefix the app and the CLI use round-trips', () => {
  for (const prefix of ['seg-', 'list-', 'li-', 'phr-', 'ph-']) {
    const id = newId(prefix, new Set());
    assert.ok(id.startsWith(prefix));
    assert.equal(id.length, prefix.length + 5);
  }
});

test('ids are not sequential — two draws from an empty set differ', () => {
  // Not a randomness test, just the property that made #41 worth fixing: a
  // fresh id must not be predictable from the count of existing ones.
  const draws = new Set();
  for (let i = 0; i < 50; i++) draws.add(newId('seg-', new Set()));
  assert.ok(draws.size > 40, `expected spread, got ${draws.size} distinct of 50`);
});
