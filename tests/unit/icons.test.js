// Every `ti-*` class the app renders has to be a glyph Tabler actually ships:
// an unknown name matches no CSS rule and silently renders as nothing, which
// is how the Schedule tab sat with a blank `ti-chart-gantt` until issue #75.
//
// The page loads the webfont from a CDN, so this check reads the same version
// from node_modules (a devDependency pinned to the URL's version) rather than
// asserting on rendered glyphs in an e2e test that stubs the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const PINNED = pkg.devDependencies['@tabler/icons-webfont'];

const css = readFileSync(join(root, 'node_modules/@tabler/icons-webfont/dist/tabler-icons.css'), 'utf8');
const SHIPPED = new Set([...css.matchAll(/\.ti-([a-z0-9-]+):before/g)].map(m => m[1]));

/** Every file under src/, so a new view is covered without touching this. */
function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}

/** The icon names a source file references, in either of the two forms the
    codebase uses: `class="ti ti-x"` in markup, and a bare 'ti-x' string
    returned by the per-kind icon helpers (views/badges.js, lists.js,
    phrases.js). */
function iconNames(text) {
  return [
    ...[...text.matchAll(/\bti ti-([a-z0-9-]+)/g)].map(m => m[1]),
    ...[...text.matchAll(/'ti-([a-z0-9-]+)'/g)].map(m => m[1]),
  ];
}

test('the pinned webfont matches the version the page loads from the CDN', () => {
  const html = readFileSync(join(root, 'src/index.html'), 'utf8');
  const m = html.match(/@tabler\/icons-webfont@([\d.]+)\//);
  assert.ok(m, 'src/index.html links the Tabler webfont');
  assert.equal(m[1], PINNED, 'the CDN link and the devDependency must not drift');
});

test('the webfont CSS parsed into a plausible set of glyph names', () => {
  assert.ok(SHIPPED.size > 1000, `only ${SHIPPED.size} names parsed — the CSS shape changed?`);
  assert.ok(SHIPPED.has('calendar-time'));
  assert.ok(!SHIPPED.has('chart-gantt'), 'the icon that motivated this test is still absent');
});

test('every icon the app renders is one Tabler ships', () => {
  const missing = [];
  for (const path of sources(join(root, 'src')))
    for (const name of iconNames(readFileSync(path, 'utf8')))
      if (!SHIPPED.has(name)) missing.push(`${path.slice(root.length)}: ti-${name}`);
  assert.deepEqual(missing, []);
});

test('the tabs each carry an icon, so none renders as a bare label', () => {
  const html = readFileSync(join(root, 'src/index.html'), 'utf8');
  const tabs = [...html.matchAll(/<div class="htab[^"]*" data-v="([a-z]+)"[^>]*>(.*?)<\/div>/g)];
  assert.ok(tabs.length >= 6, `found ${tabs.length} tabs`);
  const icons = tabs.map(([, view, body]) => {
    const icon = body.match(/\bti ti-([a-z0-9-]+)/);
    assert.ok(icon, `the ${view} tab has no icon`);
    return icon[1];
  });
  assert.equal(new Set(icons).size, icons.length, 'two tabs share an icon');
});
