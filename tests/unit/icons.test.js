// Every `ti-*` class the app renders has to be a glyph Tabler actually ships:
// an unknown name matches no CSS rule and silently renders as nothing, which
// is how the Schedule tab sat with a blank `ti-chart-gantt` until issue #75.
//
// The font is no longer a CDN load — the build subsets it to the glyphs src/
// names and inlines the result (scripts/icon-font.mjs) — so an unknown name now
// fails the *build*, which is a better place to find out than the page. This
// file is the fast version of that check, plus the properties of the generated
// CSS the build itself cannot assert about itself.
//
// The scanner is imported from the build rather than copied here on purpose: a
// second copy that drifted would pass a name the build never subset, and the
// icon would render as nothing again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codepoints, usedIcons, iconFontCss, version } from '../../scripts/icon-font.mjs';

const root = new URL('../../', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const SHIPPED = codepoints();

test('the pinned webfont is the one the subset is cut from', () => {
  assert.equal(pkg.devDependencies['@tabler/icons-webfont'], version(),
    'the installed icon set and the pinned devDependency must not drift');
});

test('the webfont CSS parsed into a plausible set of glyph names', () => {
  assert.ok(SHIPPED.size > 1000, `only ${SHIPPED.size} names parsed — the CSS shape changed?`);
  assert.ok(SHIPPED.has('calendar-time'));
  assert.ok(!SHIPPED.has('chart-gantt'), 'the icon that motivated this test is still absent');
});

test('every icon the app renders is one Tabler ships', () => {
  const missing = usedIcons().filter(name => !SHIPPED.has(name));
  assert.deepEqual(missing.map(n => `ti-${n}`), []);
});

test('the page carries its icons rather than fetching them', () => {
  const html = readFileSync(join(root, 'src/index.html'), 'utf8');
  assert.ok(!html.includes('icons-webfont'),
    'the icon font is subset into the page — src/index.html must not link it from a CDN');
  assert.ok(html.includes('<!-- build:icons -->'), 'the subset has nowhere to be injected');
});

test('the generated CSS covers every icon in use, from an inlined font', async () => {
  const { css, used, bytes } = await iconFontCss();
  assert.ok(used.length > 40, `only ${used.length} icons found — did the scan break?`);

  // The face is inline: no URL, no host, nothing to fail on a saved file://
  // page or a cold offline load, which is the whole point of subsetting it.
  assert.match(css, /@font-face\{[^}]*src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)\}/);
  assert.ok(!css.includes('http'), 'the generated icon CSS reaches for the network');

  // One rule per icon, at the codepoint Tabler's own CSS gives it.
  for (const name of used)
    assert.ok(css.includes(`.ti-${name}:before{content:"\\${SHIPPED.get(name)}"}`), `no rule for ti-${name}`);

  // A subset that stopped subsetting would still pass everything above.
  assert.ok(bytes < 120 * 1024, `the subset is ${(bytes / 1024).toFixed(0)} kB — is it still a subset?`);
});

test('the tabs each carry an icon, so none renders as a bare label', () => {
  const html = readFileSync(join(root, 'src/index.html'), 'utf8');
  const tabs = [...html.matchAll(/<button[^>]*\bclass="htab[^"]*"[^>]*\bdata-v="([a-z]+)"[^>]*>(.*?)<\/button>/g)];
  assert.ok(tabs.length >= 6, `found ${tabs.length} tabs`);
  const icons = tabs.map(([, view, body]) => {
    const icon = body.match(/\bti ti-([a-z0-9-]+)/);
    assert.ok(icon, `the ${view} tab has no icon`);
    return icon[1];
  });
  assert.equal(new Set(icons).size, icons.length, 'two tabs share an icon');
});
