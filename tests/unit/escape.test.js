import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../../src/lib/escape.js';

test('esc escapes &, < and >', () => {
  assert.equal(esc('<b>x & y</b>'), '&lt;b&gt;x &amp; y&lt;/b&gt;');
  assert.equal(esc('plain'), 'plain');
});

test('esc stringifies non-string input', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(null), 'null');
});
