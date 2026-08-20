// Subresource Integrity for the CDN assets in src/index.html.
//
// The page loads two files it does not carry itself — Leaflet's CSS and JS —
// on the same origin that holds the OpenRouter key and every saved trip in
// localStorage. (The Tabler webfont was a third until the build started
// subsetting it into the page; see scripts/icon-font.mjs.) Version
// pinning alone does not stop a tampered or swapped CDN response; the SRI hash
// does. This test is what stops the hash and the URL drifting apart: every
// asset is served from jsdelivr's /npm/ path, which returns the published
// tarball file byte-for-byte, so the hash must equal the digest of that exact
// file in node_modules at the pinned version.
//
// Same contract as icons.test.js: the devDependency version must match the
// version the CDN URL names. Bump one without the other and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** Every href/src on cdn.jsdelivr.net, with the tag's integrity attribute. */
function cdnTags() {
  const out = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) || []) {
    const url = (tag.match(/(?:href|src)="([^"]+)"/) || [])[1];
    if (!url || !url.startsWith('https://')) continue;
    out.push({
      tag,
      url,
      integrity: (tag.match(/integrity="([^"]+)"/) || [])[1],
      crossorigin: (tag.match(/crossorigin="([^"]+)"/) || [])[1],
    });
  }
  return out;
}

const sri = file => 'sha384-' + createHash('sha384')
  .update(readFileSync(new URL('../../node_modules/' + file, import.meta.url)))
  .digest('base64');

const tags = cdnTags();

test('the page loads external subresources from one pinned host', () => {
  assert.ok(tags.length > 0, 'expected some external assets in src/index.html');
  for (const t of tags)
    assert.ok(t.url.startsWith('https://cdn.jsdelivr.net/npm/'), `unpinnable host: ${t.url}`);
});

test('every external subresource declares integrity and crossorigin', () => {
  for (const t of tags) {
    // Without crossorigin the request is no-cors, the response is opaque, and
    // the browser cannot check the hash at all — the attribute is not optional.
    assert.equal(t.crossorigin, 'anonymous', `missing crossorigin: ${t.url}`);
    assert.match(t.integrity || '', /^sha384-[A-Za-z0-9+/]+=*$/, `missing integrity: ${t.url}`);
  }
});

test('each integrity hash matches the pinned package file it names', () => {
  for (const t of tags) {
    // https://cdn.jsdelivr.net/npm/<name>@<version>/<path>
    const m = t.url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\/(.+)$/);
    assert.ok(m, `cannot parse a package out of ${t.url}`);
    const [, name, version, path] = m;

    const pinned = (pkg.devDependencies || {})[name] || (pkg.dependencies || {})[name];
    assert.ok(pinned, `${name} is loaded from a CDN but is not a pinned dependency`);
    assert.equal(pinned, version,
      `${name} is pinned to ${pinned} in package.json but the CDN URL asks for ${version}`);

    assert.equal(t.integrity, sri(`${name}/${path}`),
      `integrity for ${name}@${version}/${path} does not match the installed file`);
  }
});
