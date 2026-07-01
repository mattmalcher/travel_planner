import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeUrl } from '../../src/lib/escape.js';

test('esc escapes &, < and >', () => {
  assert.equal(esc('<b>x & y</b>'), '&lt;b&gt;x &amp; y&lt;/b&gt;');
  assert.equal(esc('plain'), 'plain');
});

test('esc escapes quotes for attribute contexts', () => {
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(esc("a'b"), 'a&#39;b');
  assert.equal(esc('x" onerror="alert(1)'), 'x&quot; onerror=&quot;alert(1)');
});

test('esc stringifies non-string input', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(null), 'null');
});

test('safeUrl allows only absolute http(s) links', () => {
  assert.equal(safeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('  https://example.com  '), 'https://example.com');
  assert.equal(safeUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
});

test('safeUrl rejects dangerous or relative schemes', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('/relative/path'), '');
  assert.equal(safeUrl('mailto:a@b.com'), '');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
  assert.equal(safeUrl('javascript:alert(1)//https://x'), '');
});
