// WCAG 1.4.3 AA contrast for the palette tokens (issue #91).
//
// Same idea as sri.test.js: the numbers are recomputed from the real source
// rather than asserted from a table someone wrote once, so the check cannot go
// stale. The tokens are parsed out of `src/styles.css` — the light `:root`
// block and the `prefers-color-scheme:dark` block that redefines them — and
// every foreground is measured against the backgrounds it is actually rendered
// on. A palette tweak that drops a pair under 4.5:1 fails here rather than
// shipping.
//
// Why 4.5:1 for all of it: AA's large-text discount (3:1) starts at 18.66px
// bold or 24px, and the text wearing these tokens is 10–14px — badges, notes,
// booking references, tick labels. There is no caption exception to lean on.
//
// This is arithmetic on hex pairs, so it only knows the combinations listed
// below. A foreground drawn over a background nobody thought to pair here is
// exactly what the rendered-page axe sweep is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/**
 * The custom properties declared in one `:root{…}` block.
 * @param {string} block
 * @returns {Record<string,string>}
 */
function tokensIn(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/(--color-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    out[name] = value.toLowerCase();
  }
  return out;
}

/** The light palette: the first `:root{` block in the file. */
function lightTokens() {
  const i = css.indexOf(':root{');
  assert.notEqual(i, -1, 'no :root block in styles.css');
  return tokensIn(css.slice(i, css.indexOf('}', i)));
}

/** The dark palette: light, with the dark media query's redefinitions applied. */
function darkTokens() {
  const i = css.indexOf('@media (prefers-color-scheme:dark)');
  assert.notEqual(i, -1, 'no dark-mode media query in styles.css');
  const j = css.indexOf(':root{', i);
  assert.notEqual(j, -1, 'the dark media query redefines no :root tokens');
  // The dark :root spans several lines and holds comments, so read to the end
  // of the media query rather than to the first `}`.
  return { ...lightTokens(), ...tokensIn(css.slice(j, css.indexOf('\n}', j))) };
}

/** sRGB channel → linear light, per WCAG's relative-luminance definition. */
function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` colour. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1–21. */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Foreground token → the background tokens it is rendered on, with where.
// Both themes use the same pairings: the rules are written against tokens, so
// what changes between light and dark is only the values.
const PAIRS = [
  // Body text and the modal/chat surfaces it sits on. .hcmsg.user puts primary
  // text on the info tint.
  ['--color-text-primary', ['page', 'primary', 'secondary', 'info']],
  // Tab labels, .hli-local, chip labels, the add-row label, .hli-progress
  // (which is on the secondary fill).
  ['--color-text-secondary', ['page', 'primary', 'secondary']],
  // Not decoration — this one carries content: segment notes, booking
  // references, completed list items, the "No items yet" empty states, the
  // Schedule tick labels and the library's revision metadata.
  ['--color-text-tertiary', ['page', 'primary', 'secondary']],
  // .hbadge.paid / .included / .free.
  ['--color-text-success', ['success']],
  // .hbadge.pending / .partial, .hli-chip.broken, .hph-todo-count, .hpv-warn,
  // #hstorewarn and renderWarnings' banner.
  ['--color-text-warning', ['warning']],
  // .hbadge.rejected and .hpv-err on the danger tint; .hjump-chip.hday-today
  // and the delete hovers on a plain card.
  ['--color-text-danger', ['danger', 'page', 'primary']],
  // .hbadge.considering / .suggested on the info tint; also the focus ring and
  // link colour on the page and cards.
  ['--color-text-info', ['info', 'page', 'primary']]
];

for (const [theme, tokens] of [['light', lightTokens()], ['dark', darkTokens()]]) {
  test(`${theme} palette text tokens clear AA 4.5:1`, () => {
    for (const [fg, backgrounds] of PAIRS) {
      const colour = tokens[fg];
      assert.ok(colour, `${theme}: ${fg} is not defined`);
      for (const bg of backgrounds) {
        const name = `--color-background-${bg}`;
        const behind = tokens[name];
        assert.ok(behind, `${theme}: ${name} is not defined`);
        const r = ratio(colour, behind);
        assert.ok(
          r >= 4.5,
          `${theme}: ${fg} ${colour} on ${name} ${behind} is ${r.toFixed(2)}:1, under AA 4.5:1`
        );
      }
    }
  });

  test(`${theme} palette keeps a readable primary/secondary/tertiary hierarchy`, () => {
    // All three now clear AA, which squeezes them together — the point of the
    // three tokens is that they are visibly different, so check the ordering
    // still holds rather than letting a future fix collapse them by accident.
    const on = tokens['--color-background-primary'];
    const steps = ['primary', 'secondary', 'tertiary']
      .map((k) => ({ k, r: ratio(tokens[`--color-text-${k}`], on) }));
    for (let i = 1; i < steps.length; i++) {
      assert.ok(
        steps[i - 1].r > steps[i].r,
        `${theme}: text-${steps[i - 1].k} (${steps[i - 1].r.toFixed(2)}:1) should stand out more `
        + `than text-${steps[i].k} (${steps[i].r.toFixed(2)}:1)`
      );
    }
  });
}

test('the dark block really is being parsed', () => {
  // Without this the dark suite above could be silently re-checking the light
  // palette: darkTokens() starts from the light one and overlays the media
  // query, so a parse that matched nothing would still pass every assertion.
  const light = lightTokens();
  const dark = darkTokens();
  const changed = Object.keys(light).filter((k) => light[k] !== dark[k]);
  assert.ok(
    changed.length >= 10,
    `the dark media query should redefine the palette, got ${changed.length} overrides`
  );
  assert.ok(luminance(dark['--color-background-page']) < luminance(light['--color-background-page']));
});

test('the contrast maths agrees with WCAG\'s worked extremes', () => {
  assert.equal(ratio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(ratio('#ffffff', '#ffffff').toFixed(2), '1.00');
  // A published reference pair: #767676 is the lightest grey that passes AA on
  // white, and #777777 is the first that does not.
  assert.ok(ratio('#767676', '#ffffff') >= 4.5);
  assert.ok(ratio('#777777', '#ffffff') < 4.5);
});
