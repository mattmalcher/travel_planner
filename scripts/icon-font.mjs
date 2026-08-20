// The icon font, subset to the glyphs this app actually renders.
//
// The page used to load Tabler's webfont from jsdelivr: 829 kB of woff2 plus
// 250 kB of CSS, for the ~70 glyphs `src/` names. Everything else about it was
// wrong too — the icons were the only reason a saved file:// page or a cold
// offline load looked broken, and an icon set on a third-party host is a
// third-party host on the origin that holds the OpenRouter key.
//
// So the build subsets the font instead: harfbuzz keeps the codepoints `src/`
// uses and drops the rest, and the result (~15 kB) goes into the page as a
// data: URI. Same font, same codepoints, same `.ti .ti-x` markup and the same
// `:before` rule as Tabler's own CSS — nothing at a call site changes, and the
// rendering is glyph-for-glyph what it was.
//
// The names are read out of `src/` the same way tests/unit/icons.test.js reads
// them, so the two cannot disagree about what is in use. A name Tabler does not
// ship has no codepoint to subset and now fails the **build**: it used to
// render as silent nothing, which is how the Schedule tab shipped a blank
// `ti-chart-gantt`.
import subsetFont from 'subset-font';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules/@tabler/icons-webfont/dist');

/** Every file under a directory, so a new view is covered without touching
    this. Same walk as icons.test.js. */
function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}

/** The icon names a source file references, in either of the two forms the
    codebase uses: `class="ti ti-x"` in markup, and a bare 'ti-x' string
    returned by the per-kind icon helpers (views/badges.js, lists.js,
    phrases.js). Kept identical to icons.test.js's copy — if these two ever
    disagree, the test passes a name the build did not subset, and the icon
    renders as nothing. */
export function iconNames(text) {
  return [
    ...[...text.matchAll(/\bti ti-([a-z0-9-]+)/g)].map(m => m[1]),
    ...[...text.matchAll(/'ti-([a-z0-9-]+)'/g)].map(m => m[1]),
  ];
}

/** Every icon name rendered anywhere in src/, sorted so a build is
    reproducible. */
export function usedIcons(dir = join(root, 'src')) {
  const names = new Set();
  for (const path of sources(dir))
    for (const name of iconNames(readFileSync(path, 'utf8'))) names.add(name);
  return [...names].sort();
}

/** Tabler's own name → codepoint map, parsed from the CSS it publishes. This
    is the authority on which glyph a name means, so the subset and the rules
    below can never point at different codepoints. */
export function codepoints() {
  const css = readFileSync(join(pkgDir, 'tabler-icons.min.css'), 'utf8');
  const map = new Map([...css.matchAll(/\.ti-([a-z0-9-]+):before\{content:"\\([0-9a-f]+)"\}/g)]
    .map(m => [m[1], m[2]]));
  if (map.size < 1000) throw new Error(`only ${map.size} icon names parsed — the Tabler CSS shape changed?`);
  return map;
}

/**
 * The CSS to inline: an @font-face carrying the subset as a data: URI, the
 * base `.ti` rule copied from Tabler's CSS, and one `:before` rule per icon in
 * use.
 *
 * `font-display:block` rather than the default `swap`: the face is a data URI,
 * so there is no fetch to wait on, and blocking avoids a frame of fallback
 * glyphs where an icon should be.
 */
export async function iconFontCss() {
  const map = codepoints();
  const used = usedIcons();
  const missing = used.filter(n => !map.has(n));
  if (missing.length)
    throw new Error(`icons not in Tabler ${version()}: ${missing.map(n => `ti-${n}`).join(', ')}`);

  const text = used.map(n => String.fromCodePoint(parseInt(map.get(n), 16))).join('');
  const subset = await subsetFont(readFileSync(join(pkgDir, 'fonts/tabler-icons.woff2')), text,
    { targetFormat: 'woff2' });

  const face = `@font-face{font-family:"tabler-icons";font-style:normal;font-weight:400;`
    + `font-display:block;src:url(data:font/woff2;base64,${subset.toString('base64')}) format("woff2")}`;
  const base = '.ti{font-family:"tabler-icons"!important;speak:none;font-style:normal;font-weight:normal;'
    + 'font-variant:normal;text-transform:none;line-height:1;-webkit-font-smoothing:antialiased;'
    + '-moz-osx-font-smoothing:grayscale}';
  const rules = used.map(n => `.ti-${n}:before{content:"\\${map.get(n)}"}`).join('');

  return { css: face + base + rules, used, bytes: subset.length };
}

/** The version of the icon set the subset came from, for the build log. */
export function version() {
  return JSON.parse(readFileSync(join(root, 'node_modules/@tabler/icons-webfont/package.json'), 'utf8')).version;
}
