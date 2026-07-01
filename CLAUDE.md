# CLAUDE.md

Holiday itinerary viewer: a standalone HTML app for `HolidayItinerary` JSON
files with timeline, budget, map and gantt views plus an optional
OpenRouter-backed AI editor. **Source is modular (`src/`); the deliverable is
a single self-contained HTML file built into `dist/` — never edit or commit
build output.**

## Commands

```bash
make install     # npm install
make build       # src/ → dist/holiday_itinerary_viewer.html (esbuild, scripts/build.mjs)
make lint        # ESLint over src/, scripts/, tests/
make test-unit   # node --test tests/unit/*.test.js  (milliseconds — run these while iterating)
make test-e2e    # build + Playwright against dist/  (slower smoke layer)
make test        # unit then e2e
make host        # build + serve dist/ on http://localhost:8345
```

CI (`.github/workflows/ci.yml`) runs lint + build + unit + e2e on every PR.
Deploy workflows build in CI and publish `dist/` — the artifact is not in git.

## Architecture map

```
src/
  index.html        skeleton markup; build replaces the three <!-- build:* --> placeholders
  styles.css        all CSS (inlined & minified by the build)
  main.js           entry point: window.* handler exports, DOM wiring, boot
  state.js          THE shared mutable state object + persist(); schema version constant
  render.js         updateHeader / renderAll / refreshAfterChange (post-edit re-render)
  app.js            load/reset, tab switching, JSON edit modal, saved-data version guard
  validate.js       ajv setup (NOT bundled — injected as a separate module script;
                    loads ajv from esm.sh at runtime, degrades gracefully offline)
  lib/              pure functions, no DOM — unit tested in tests/unit/
    cost.js         costInfo + budgetSummary (all cost interpretation lives here)
    sort.js         segDate/segTime/sortSegments (shared list+map ordering)
    dates.js        formatting, toMs/msToIso, and ALL default times (issue #13)
    gantt-layout.js time→pixel scales, compact points, coverage gaps
    escape.js       esc() html escaping
  views/            DOM rendering only; maths belongs in lib/
    badges.js list.js budget.js map.js gantt.js
  ai/               OpenRouter assistant (browser-only, key in localStorage)
    client.js tools.js prompt.js chat.js preview.js settings.js
schema/holiday_itinerary_schema.json   the source of truth for the data shape
examples/           anonymised fixture itineraries (fictional people/refs only)
tests/unit/         node --test, import directly from src/lib/
tests/e2e/          Playwright, runs against the BUILT dist/ artifact
```

## Invariants

- **Single-file output**: the built page must stay fully self-contained
  (external CDN links for Leaflet/icons/ajv only). Anything new in `src/`
  must be inlined by `scripts/build.mjs`.
- **Schema version**: `state.js`'s `__H_SCHEMA_VERSION__` placeholder is
  injected from `schema.version` at build time — never hardcode it. Bump the
  schema's MAJOR version on any breaking change to the stored itinerary
  shape (localStorage is shared across deployments on the same origin).
- **Escape everything** interpolated into HTML that comes from an itinerary
  file or an AI reply — use `esc()` from `lib/escape.js` (issue #9). For any
  URL going into an `href`/`src`, gate it through `safeUrl()` first so only
  absolute `http(s)` links survive.
- **Default times live in `lib/dates.js`** — do not add inline `|| '14:00'`
  style fallbacks in views.
- **Inline onclick handlers** in markup call `window.h*` globals; if you add
  one, export the handler and register it in the `Object.assign(window, …)`
  block in `main.js`.
- **lib/ stays pure**: no DOM, no `state` import, no `window`. If a view
  needs new logic, put the calculation in `lib/` with a unit test.
- **Examples/tests use fictional data only** (the Jetsons pattern): no real
  names, addresses, booking references or coordinates of private lodgings.

## Testing conventions

- Unit tests (`tests/unit/*.test.js`): `node:test` + `assert/strict`,
  import straight from `src/lib/*.js`. Add one when you touch a lib module.
- E2E specs stub the network (esm.sh, OpenRouter) with `page.route` — keep
  them hermetic. Playwright's webServer serves `dist/`, so run the build
  (npm scripts for e2e do this automatically) before `playwright test`.
- `@playwright/test` is pinned to match preinstalled browsers in the
  remote/CI environments; CI runs `npx playwright install --with-deps chromium`.

## Follow-ups deliberately not done here

- `tsc --checkJs` + JSDoc types and schema-generated types
  (`json-schema-to-typescript`) — adopt per-module as files are touched.
- `lib/lint.js` referential-integrity checks (issue #17).
