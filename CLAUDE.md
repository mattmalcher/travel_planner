# CLAUDE.md

Holiday itinerary viewer: a standalone HTML app for `HolidayItinerary` JSON
files with itinerary, map, schedule, lists, phrases and budget views plus an
optional OpenRouter-backed AI editor. (Tab labels are the user's words since
issue #71; the code keeps the internal view names — `list` for Itinerary,
`gantt` for Schedule.) **Source is modular (`src/`); the deliverable is
a single self-contained HTML file built into `dist/` — never edit or commit
build output.**

## Commands

```bash
make install     # npm install
make build       # src/ → dist/holiday_itinerary_viewer.html (esbuild, scripts/build.mjs)
make lint        # ESLint over src/, scripts/, tests/
make validate    # schema-check + lint an itinerary file (FILE=data/*.json)
make itin ARGS="digest data/trip.json"   # the desktop itinerary CLI
make test-unit   # node --test tests/unit/*.test.js  (milliseconds — run these while iterating)
make test-e2e    # build + Playwright against dist/  (slower smoke layer)
make test        # unit then e2e
make host        # build + serve dist/ on http://localhost:8345
make demo        # build + record demo/demo.gif, the README animation (needs ffmpeg)
```

CI (`.github/workflows/ci.yml`) runs lint + build + unit + e2e on every PR.
Deploy workflows build in CI and publish `dist/` — the artifact is not in git.
The demo recording (`.github/workflows/demo.yml`, `scripts/demo.mjs`) is the
same deal: CI drives the built page through a scripted tour, ffmpeg makes a
GIF, and it is published to the gh-pages root as `demo.gif` for the README —
never committed, since every run re-encodes to different bytes.

## Architecture map

```
src/
  index.html        skeleton markup; build replaces the two <!-- build:* --> placeholders
  styles.css        all CSS (inlined & minified by the build)
  main.js           entry point: window.* handler exports, DOM wiring, boot
  state.js          THE shared mutable state object; schema version constant
  store.js          localStorage binding for the trip library (issue #80):
                    persist() — the single write path — plus boot, import
                    decisions, revision recording and restore
  share.js          share links, browser half (issue #81): building one from
                    the open trip (share sheet / clipboard) and opening one
                    that arrives in the fragment — boot() routes it through
                    loadUpload(), and a link arriving at an open page reloads
  render.js         updateHeader / renderAll / refreshAfterChange (post-edit re-render)
  app.js            load/reset, tab switching, edit modal (form ⇄ JSON), version guard
  form-spec.js      edit-modal field descriptors — the __H_FORM_SPEC__ placeholder
                    is filled at build time by specFromSchema() (issue #65)
  validate.js       ajv setup: ajv and the schema are BOTH compiled into the
                    bundle, so upload/share-link validation works offline and
                    on a saved file:// page. main.js calls setupValidation()
                    before boot(), so there is no validator to race.
  sw.js             offline service worker (issue #45): precache + stale-while-
                    revalidate shell, cache-first CDNs; bundled to dist/sw.js
  sw-register.js    guarded SW registration + "Offline ready" badge (no-ops on
                    file://, PR previews, or when sw.js is absent)
  lib/              pure functions, no DOM — unit tested in tests/unit/
    cost.js         costInfo + budgetSummary (all cost interpretation lives here)
    sort.js         segDate/segTime/sortSegments (shared list+map ordering)
    dates.js        formatting, toMs/msToIso, and ALL default times (issue #13)
    digest.js       one-line-per-segment digest for the AI prompt (issue #31)
    doctrine.js     THE authoring rules, as scoped data: the in-app assistant
                    renders scope app|both into its prompt, the desktop skill
                    renders scope desktop|both into its SKILL.md. One source,
                    guarded by tests/unit/doctrine.test.js
    library.js      the trip library: document identity (trip_id/rev), the
                    index, revision history, import decisions, quota policy —
                    the store is a parameter, so all of it is unit-testable
    codec.js        deflate-raw + base64url for stored revisions and share links
    sharelink.js    share-link encoding (issue #81): the `#d1=` fragment scheme,
                    decode guards and where the payload sits in a URL
    lists.js        list progress/partition, dangling segment_id detection
                    (issue #40), document-wide id sets for manual adds (#72)
    phrases.js      phrasebook counts + document-wide id sets (issue #75)
    ids.js          random-suffix id assignment shared by AI tools and the UI (issue #41)
    drafts.js       starting points for hand-added things: segment drafts per
                    type, the from-scratch trip, the blank document (issue #76)
    edit-form.js    edit-modal form model: LAYOUT (paths + labels) resolved
                    against the schema into field descriptors (issue #65)
    sw-cache.js     request classification for the service worker (issue #45)
    gantt-layout.js time→pixel scales, compact points, coverage gaps
    escape.js       esc() html escaping
  views/            DOM rendering only; maths belongs in lib/
    badges.js list.js budget.js map.js gantt.js lists.js edit-form.js
    phrases.js      the phrasebook tab (issue #75) — reference, not a
                    checklist: no tick-off, no Schedule, no cost
    library.js      the trip switcher and the opening screen's saved-trips
                    list — one row renderer, revision history under each
    jump-nav.js     the sticky jump strip shared by the itinerary's day chips,
                    the Lists view's list chips and the Phrases view's group
                    chips (issues #21, #69, #75)
  ai/               OpenRouter assistant (browser-only, key in localStorage)
    client.js tools.js prompt.js chat.js preview.js settings.js
schema/holiday_itinerary_schema.json   the source of truth for the data shape
scripts/itin.mjs    the desktop CLI: validate / digest / schema-brief / ids /
                    doctrine / bump. Reuses src/lib/ for all interpretation and
                    owns only argv, file I/O and formatting; ajv stays here
                    rather than in lib/ so the bundle can never gain a second copy
.claude/skills/itinerary-authoring/   the desktop editing skill (doctrine block
                    generated — never hand-edit it, run `itin doctrine --write`)
.claude/skills/browser-research/      driving the user's real Chrome (via the
                    claude-in-chrome extension) for pages that refuse a fetch —
                    last rung of the ladder, hands off to find-stop/authoring
examples/           anonymised fixture itineraries (fictional people/refs only)
data/               gitignored real trips; hand-versioned _0.N snapshots of one
                    trip_id, round-tripped through the app's download/upload
tests/unit/         node --test, import directly from src/lib/
tests/e2e/          Playwright, runs against the BUILT dist/ artifact
```

## Invariants

- **Single-file output**: the built page must stay fully self-contained
  (external CDN links for Leaflet and the icon webfont only). Anything new in `src/`
  must be inlined by `scripts/build.mjs`. The offline sidecars the build
  also emits (`sw.js`, `manifest.webmanifest`, icons — issue #45) are
  deploy conveniences, never dependencies: the page must keep working when
  they are absent (saved file://, PR previews).
- **Schema version**: `state.js`'s `__H_SCHEMA_VERSION__` placeholder is
  injected from `schema.version` at build time — never hardcode it. Bump the
  schema's MAJOR version on any breaking change to the stored itinerary
  shape (localStorage is shared across deployments on the same origin).
- **A share link is untrusted input, and lands like an uploaded file**
  (issue #81): the document goes in the URL *fragment* (`#d1=`, deflate-raw +
  base64url — never the query, which reaches server logs), and an incoming one
  is routed through `loadUpload()` so it meets the same schema-version and ajv
  guards a file does, then `loadImport()` for how it resolves against the
  library. The scheme marker is versioned so a later encoding can arrive
  without breaking links already sent, decoding a damaged link must *say so*
  rather than yield an empty trip, and the fragment is cleared once loaded so
  a refresh can't re-import a stale snapshot over later edits.
- **The library owns document identity**: `trip_id`, `rev`, `updated_at` and
  `updated_by` are the app's bookkeeping, settled by `persist()` in `store.js`
  — never written by a view, a form or the AI (they are kept out of the AI's
  schema brief on purpose). `rev` bumps only when the content really changed,
  and restoring an old revision *appends* it as the next rev rather than
  rewinding the counter; a rewound rev would collide with one the other person
  already has and break fork detection. `state.HD` stays the one loaded
  document and the same object across a save (`copyIdentity`) — views hold
  references to it. Working copies are precious and history is expendable: on
  `QuotaExceededError`, revisions are pruned and the save retried.
- **Escape everything** interpolated into HTML that comes from an itinerary
  file or an AI reply — use `esc()` from `lib/escape.js` (issue #9). For any
  URL going into an `href`/`src`, gate it through `safeUrl()` first so only
  absolute `http(s)` links survive.
- **Edit-modal form fields are schema-derived**: add or reorder fields by
  editing `LAYOUT` in `lib/edit-form.js` (paths + labels only) — input type,
  enum options, required markers and bounds come from the schema, and a path
  the schema doesn't have fails the build. Never hand-write descriptors into
  `form-spec.js`. The JSON tab stays the escape hatch for everything the form
  doesn't cover, so both directions must round-trip without dropping fields.
  The same modal edits the trip, segments, lists and list items (issue #72),
  phrase groups and phrases (issue #75), and *adds* them too (issue #76:
  `new-trip`, `new-segment`, `new-list`, `new-phrase-group`) — a new editable
  thing is a `LAYOUT` entry plus a target branch in
  `openModal`/`saveEdit`/`deleteEdit`/`validateEdit`, not a second modal.
- **Adding is never behind edit mode**: the pencils and inline deletes are
  (`.hedit-btn`), but the itinerary's add row, the Lists/Phrases quick-adds and
  "New list"/"New group" are always on — an empty itinerary would otherwise
  hide the only way to start it. Drafts come from `lib/drafts.js` and
  deliberately leave every *required* field blank so validation, not an
  invented placeholder, tells the user what is missing.
- **The three kinds of thing a document holds** are distinct on purpose:
  `segments` are plans (they have a date and a cost, so they reach the
  itinerary, schedule, budget and map), `lists` are intentions you tick off or
  promote into a segment, and `phrases` are reference material you never tick
  off at all. Anything that gains a date or a cost becomes a segment; nothing
  in `lists` or `phrases` is ever counted into the budget.
- **Validation is not optional, and not on the network**: ajv and the schema
  are bundled (see `src/validate.js`), so an uploaded file and an incoming
  share link meet the same guard whatever the network is doing. The validators
  compile on *first use*, not at boot — ajv's codegen cost ~1.5s of
  main-thread time on a low-end phone, on every load, for work most loads
  never need. Keep it that way: compiling eagerly is a real regression for
  slow devices, and buys nothing (compilation is synchronous and local, so
  the first caller still gets a validator with no network and no await). Callers keep
  their `{ok: true}` fallback, but it now only covers a schema ajv cannot
  compile — a build error. The one deliberate way past the guard is the
  user-facing **"Load anyway"** button, which is why escaping (below) has to
  hold on its own: everything reaching HTML is still untrusted.
- **Every external subresource carries an SRI hash**: the page loads Leaflet
  and the Tabler webfont from jsdelivr's `/npm/` paths, which serve the
  published tarball file byte-for-byte — so `tests/unit/sri.test.js` can
  recompute each `integrity` hash from the pinned devDependency and fail when
  a URL and its hash drift apart. A new CDN asset needs a pinned version, an
  `integrity` + `crossorigin="anonymous"` pair, and a matching devDependency;
  a host with no npm package behind it cannot be checked and should not be
  added. `crossorigin` is not decoration — without it the response is opaque
  and the browser cannot check the hash at all.
- **Icon names must exist in the Tabler webfont**: an unknown `ti-*` class
  renders as nothing at all, silently (the Schedule tab shipped a blank
  `ti-chart-gantt` this way). `tests/unit/icons.test.js` checks every name in
  `src/` against the pinned `@tabler/icons-webfont` devDependency, which must
  stay at the version `src/index.html` loads from the CDN.
- **The authoring doctrine has one source, `lib/doctrine.js`**: the rules that
  say what a well-formed *plan* looks like (as opposed to well-formed JSON) are
  scoped data, not prose in a prompt. `src/ai/prompt.js` renders the `app` view;
  `.claude/skills/itinerary-authoring/SKILL.md` carries the `desktop` view inside
  generated markers, synced by `npm run itin -- doctrine --write`. Add a rule by
  adding an entry with the right `scope` — never by editing the prompt string or
  the SKILL.md block, both of which `tests/unit/doctrine.test.js` will catch.
  The split matters: the digest disclosure, read-before-edit and
  prefer-a-patch rules are mobile context-window mitigations and are *wrong* on
  the desktop, where the whole file is in hand.
- **A desktop-edited file must have its `rev` bumped before it goes back**
  (`npm run itin -- bump`). `classifyImport` reads same `trip_id` + same `rev` +
  different content as a **fork**, and `src/app.js` offers "Keep both" *first*
  for a fork — which mints a new `trip_id`. An unbumped hand edit is exactly that
  signature, so re-uploading one sits a tap away from splitting the trip in two.
  A higher `rev` classifies as `newer` (Replace first) and `library.js` takes the
  incoming document as-is. This is the one identity field anything outside
  `persist()` may write, and only a file handed back as a finished revision —
  never a view, a form or the AI.
- **Errors about a segment come from its own subschema, never the `oneOf`**: both
  `src/validate.js` and `scripts/itin.mjs` pick the one definition a segment's
  `type` names. Under the `oneOf` ajv reports every branch, so a half-filled
  event demands transport's `mode` and `departs` — 14 misleading errors instead
  of one true one (issue #76).
- **Every colour comes from a token, and dark mode is one media query**
  (issue #95): the palette is the `:root` custom properties at the top of
  `styles.css` and the `prefers-color-scheme: dark` block that redefines them
  — there is no toggle, nothing stored, and no JS, so a saved `file://` copy
  follows the OS like the hosted page does. Never write a literal colour into
  a rule, an inline `style=` or a template string; that is what leaves a white
  card on a dark page, and `tests/e2e/theme.spec.js` sweeps the rendered page
  for one. `color-scheme` on `:root` is doing real work — the buttons,
  textareas, date/time pickers and scrollbars are all unstyled natives, and it
  is the only thing that re-themes them. Leaflet's popups and controls come
  from the CDN stylesheet in fixed light colours, so they are restated against
  the tokens; its tiles go through `--map-tile-filter`, an inversion applied
  to `.leaflet-tile` alone so the pins and route line above it keep their real
  colours. The chart-ish colours that are not themed — gantt block fills, map
  pins — are deliberate: they carry meaning, sit under white text, and read on
  either background.
- **The tab strip is an ARIA tablist, and one tab stop** (issue #90): the tabs
  are `<button role="tab">`s, the panels `role="tabpanel"`, and `switchView()`
  in `app.js` is the single place `aria-selected` and the roving `tabindex`
  are settled — same fact as the `on` class, so a view switched from anywhere
  (a list chip, `revealSegment`, `closeTrip`) leaves exactly one tab in the tab
  order. `tabKey()` handles Left/Right/Home/End with automatic activation and
  leaves focus on the strip; a tab that moved focus into its panel would make
  the next arrow press dead. Five of the six views were pointer-only before
  this, so a new view means a tab, a panel and their `aria-controls` /
  `aria-labelledby` pair — `tests/e2e/a11y.spec.js` checks all six.
- **There is exactly one focus-outline rule** (`styles.css`, issue #90), and
  nothing else in the file may write `outline`. It is `:where(…):focus-visible`
  at near-zero specificity so per-control rules keep winning on everything
  else; a control that sets `outline:none` to style its own focus is how five
  inputs ended up signalling focus with a .5px border alone, under the 3:1
  WCAG 2.4.11 asks. Style focus *in addition* to the ring, never instead of it.
- **The text tokens are the AA contrast contract** (issue #91): every
  `--color-text-*` in `styles.css` clears WCAG 1.4.3's 4.5:1 against every
  `--color-background-*` it is rendered on, in *both* themes, and
  `tests/unit/contrast.test.js` recomputes those ratios from the two `:root`
  blocks — a new pairing needs a line in its `PAIRS` table. There is no
  large-text discount available here (the exception starts at 18.66px bold /
  24px; this text is 10–14px), and no scoping a token change to one view. The
  three greys are deliberately a hierarchy, not three names for the same value:
  once all of them clear AA they crowd together, so the test also asserts
  primary stands out more than secondary more than tertiary.
- **Interactive controls are at least 24×24 CSS px** (WCAG 2.5.8, issue #91).
  Chips and icon buttons get there with `min-height`/`min-width` plus
  `box-sizing:border-box` — a native `<button>` at `font-size:11px` renders
  about 16px and reads as fine until you measure it. Two shared classes exist
  so the sizing is not re-typed per call site: `.hpencil` for the trip /
  segment / list / phrase-group pencils, and `.htool` for the header toolbar
  and the dialog buttons that match it. Note both set a `display`, which
  outranks the single-class `.hedit-btn{display:none}` — a new class in that
  family must restate the hidden default at its own specificity or the control
  is visible outside edit mode. The 24px-apart spacing exception does not
  apply: these sit in `gap:8px` rows. `tests/e2e/a11y.spec.js` measures every
  control in every view on the rendered page.
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
- E2E specs stub the network (OpenRouter) with `page.route` — keep them
  hermetic. They do NOT stub ajv: it is compiled into the page, so a test
  that needs a document refused makes one the schema really rejects (a
  missing required field) rather than flagging a stub. Playwright's webServer serves `dist/`, so run the build
  (npm scripts for e2e do this automatically) before `playwright test`.
- `@playwright/test` is pinned to match preinstalled browsers in the
  remote/CI environments; CI runs `npx playwright install --with-deps chromium`.
- **If `npx playwright install` seems to hang, it is hanging in *extract*, not
  download** — so don't go looking at the network or a proxy. Run it under
  `DEBUG=pw:install` to see which: the zip fetches in seconds and passes
  `unzip -t`, then the bundled extractor writes a single entry into
  `~/.cache/ms-playwright/<browser>-<rev>/chrome-linux/` and sits idle
  indefinitely. That one-file directory is the tell, and it is easy to misread
  as a half-finished download. Recover by extracting the archive yourself —
  system `unzip` does the same 104 MiB in under two seconds — then `chmod +x`
  the binary (`chrome` / `headless_shell`) and
  `touch <browser>-<rev>/INSTALLATION_COMPLETE`, which is the marker Playwright
  actually checks. Kill any wedged install first and remove
  `~/.cache/ms-playwright/__dirlock`: a second attempt blocks on that lock and
  prints nothing, which looks like a second hang. Fix the install rather than
  pointing the suite at a system Chrome via `channel` — the specs should keep
  running on the same browser build CI uses.

## Follow-ups deliberately not done here

- `tsc --checkJs` + JSDoc types and schema-generated types
  (`json-schema-to-typescript`) — adopt per-module as files are touched.
