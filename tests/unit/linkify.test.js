import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../../src/lib/linkify.js';

const A = (href, text = href) =>
  `<a class="hlink" href="${href}" target="_blank" rel="noopener">${text}</a>`;

test('links an http(s) url inside prose', () => {
  assert.equal(
    linkify('Timetable at https://ter.sncf.com/aura today'),
    `Timetable at ${A('https://ter.sncf.com/aura')} today`
  );
  assert.equal(linkify('http://example.com'), A('http://example.com'));
});

test('links several urls in one note', () => {
  assert.equal(
    linkify('a https://x.test b https://y.test c'),
    `a ${A('https://x.test')} b ${A('https://y.test')} c`
  );
});

test('leaves prose with no url alone, and escapes it', () => {
  assert.equal(linkify('Ask at the desk'), 'Ask at the desk');
  assert.equal(linkify('<b>x & y</b>'), '&lt;b&gt;x &amp; y&lt;/b&gt;');
  assert.equal(linkify(''), '');
  assert.equal(linkify(null), '');
  assert.equal(linkify(undefined), '');
});

test('does not guess a scheme for a bare hostname', () => {
  assert.equal(linkify('see example.com for times'), 'see example.com for times');
  assert.equal(linkify('we changed at Lyon Part-Dieu, see p.4'), 'we changed at Lyon Part-Dieu, see p.4');
});

test('sentence punctuation stays prose, not part of the link', () => {
  assert.equal(linkify('Book at https://x.test/a.'), `Book at ${A('https://x.test/a')}.`);
  assert.equal(linkify('https://x.test/a, then walk'), `${A('https://x.test/a')}, then walk`);
  assert.equal(linkify('“https://x.test”'), `“${A('https://x.test')}”`);
});

test('a closing bracket is kept only when the url opened it', () => {
  assert.equal(
    linkify('(see https://x.test/a)'),
    `(see ${A('https://x.test/a')})`
  );
  assert.equal(
    linkify('https://en.wikipedia.org/wiki/Nice_(disambiguation)'),
    A('https://en.wikipedia.org/wiki/Nice_(disambiguation)')
  );
});

test('escapes the url in both the href and the link text', () => {
  const out = linkify('https://x.test/a?b=1&c=2');
  assert.equal(out, A('https://x.test/a?b=1&amp;c=2'));
  // The attribute-decoded href is the original url, entities and all.
  assert.ok(!out.includes('&c=2'));
});

test('a url-shaped payload cannot break out of the anchor', () => {
  // The regex stops at a quote or an angle bracket, so the payload lands as
  // escaped prose after the link rather than inside the tag.
  const out = linkify('https://x.test/a"><script>alert(1)</script>');
  assert.ok(out.startsWith(A('https://x.test/a')));
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('a javascript: url is never linked', () => {
  const out = linkify('javascript:alert(1) and jAvAsCrIpT:alert(2)');
  assert.ok(!out.includes('<a'));
  assert.equal(out, 'javascript:alert(1) and jAvAsCrIpT:alert(2)');
});

test('a bare scheme is not a link', () => {
  assert.equal(linkify('the https:// prefix'), 'the https:// prefix');
  assert.equal(linkify('ends here https://.'), 'ends here https://.');
});
