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
                    loadUpload(), and a link arriving at an open page reloads.
                    Also the hosted/fragment fallback ladder (issue #116)
  share-store.js    the share store client (issues #116, #124): POST/GET
                    ciphertext for a frozen snapshot, PUT/DELETE for a room
                    (with the write token and the swap-semantics response), the
                    read retry across KV's consistency window, and the
                    expired-share error the boot warning keys off
  room.js           live sharing, the browser half (issue #124): minting a room,
                    the manual push, the automatic pull, the conflict decisions
                    and the share sheet's actions. share.js still owns the
                    fragment and the boot decision; this owns what a *mutable*
                    share does once one arrives
  share-config.js   SHARE_ENDPOINT — the __H_SHARE_ENDPOINT__ placeholder,
                    filled at build time; empty means long links only
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
    sharelink.js    share-link encoding (issue #81): the `#d1=`/`#u1=` fragment
                    schemes, the `#s1=<id>.<key>` hosted one (issue #116), the
                    `#w1=<K>` / `#v1=<id>.<key>` room pair (issue #124),
                    decode guards and where the payload sits in a URL
    room-keys.js    one master key → id, content key and write token, all by
                    HKDF with distinct info strings (issue #124); plus the
                    base64url SHA-256 the Worker computes identically
    room.js         the room record (`hShare:<trip_id>`, the fourth key space),
                    what "unpushed" means, and the rule deciding whether an
                    automatically pulled document lands, is parked, or is
                    dropped. Store is a parameter, like library.js
    share-crypto.js AES-GCM-256 over a hosted share (issue #116): compress,
                    encrypt, `iv‖ciphertext` out and a fresh key per share
    lists.js        list progress/partition, dangling segment_id detection
                    (issue #40), document-wide id sets for manual adds (#72)
    phrases.js      phrasebook counts + document-wide id sets (issue #75)
    collection.js   the shape lists.js and phrases.js share — an array of
                    groups each holding items, its id collectors and the
                    array guard. Concepts stay separate; the shape does not
    lint.js         referential-integrity checks the schema cannot express
                    (issue #17) — also the source of segLabel, so the CLI's
                    schema errors and lint's warnings name a segment alike
    merge-patch.js  JSON Merge Patch, for the AI's patch_* tools
    now.js          "is the trip underway" / current-day helpers (issue #35)
    schema-brief.js condenseSchema — the schema summary in the AI prompt
    seg-defs.js     segment type → subschema definition; imported by BOTH
                    validators so an error comes from the segment's own
                    branch and never the oneOf (issue #76)
    chat-history.js the AI transcript kept in localStorage (issue #99): the caps
                    it is trimmed to, the trip it is scoped to, and the rule
                    that it is dropped rather than crowding out a trip save
    ai-status.js    the assistant's busy line: which step of the tool loop is
                    running and what the model did on the one before (issue #99)
    ids.js          random-suffix id assignment shared by AI tools and the UI (issue #41)
    drafts.js       starting points for hand-added things: segment drafts per
                    type, the from-scratch trip, the blank document (issue #76)
    edit-form.js    edit-modal form model: LAYOUT (paths + labels) resolved
                    against the schema into field descriptors (issue #65)
    sw-cache.js     request classification for the service worker (issue #45)
    gantt-layout.js time→pixel scales, compact points, coverage gaps
    escape.js       esc() html escaping
    linkify.js      urls inside free prose → anchors (issue #109); escapes the
                    surrounding text itself, so it replaces esc() at that sink
  views/            DOM rendering only; maths belongs in lib/
    badges.js list.js budget.js map.js gantt.js lists.js edit-form.js
    phrases.js      the phrasebook tab (issue #75) — reference, not a
                    checklist: no tick-off, no Schedule, no cost
    library.js      the trip switcher and the opening screen's saved-trips
                    list — one row renderer, revision history under each
    room.js         live sharing's two surfaces (issue #124): the header status
                    pill and the share sheet's body. Separate from src/room.js
                    so app.js and store.js can repaint the pill without pulling
                    in the push/pull machinery, which imports app.js back
    jump-nav.js     the sticky jump strip shared by the itinerary's day chips,
                    the Lists view's list chips and the Phrases view's group
                    chips (issues #21, #69, #75). Owns the chip and strip
                    markup too — jumpChip/jumpStrip — not just the scrolling
    focus.js        keepFocus/focusTo across a wholesale re-render, and
                    announce() into the one #hlive region (issue #93)
  ai/               OpenRouter assistant (browser-only, key in localStorage)
    client.js tools.js prompt.js chat.js preview.js settings.js
worker/             the share store (issues #116, #124) — a Cloudflare Worker
                    over one KV namespace, deployed with wrangler, entirely
                    separate from the page's build. Holds ciphertext for 30
                    days, immutable behind a minted id or replaceable behind a
                    derived one; see
                    worker/README.md for the deploy, the `ratelimits` binding
                    (a WAF rule is not available — workers.dev has no zone)
                    and the one dashboard setting (usage alert) it needs
schema/holiday_itinerary_schema.json   the source of truth for the data shape
scripts/itin.mjs    the desktop CLI: validate / digest / schema-brief / ids /
                    doctrine / bump. Reuses src/lib/ for all interpretation and
                    owns only argv, file I/O and formatting; ajv stays here
                    rather than in lib/ so the bundle can never gain a second copy
.claude/skills/     the desktop research + editing ladder, roughly in the order
                    a trip needs them:
  itinerary-authoring/  writing into a HolidayItinerary file — ids, rev, what
                    the schema cannot enforce (doctrine block generated — never
                    hand-edit it, run `itin doctrine --write`)
  find-stop/        a stop's coordinates: Trainline's station database first,
                    Overpass for bus stops and anything it misses
  sncf-timetables/  French *train* times — fiche horaire PDFs rather than
                    SNCF Connect's date picker
  bus-timetables/   French *bus* times, from the operator's GTFS feed: the one
                    source that answers "does this line run on THIS date"
                    (tools/gtfs_query.py); seasonality, weekend and short-turn
                    traps, and the four things GTFS cannot tell you
  browser-research/ driving the user's real Chrome (via the claude-in-chrome
                    extension) for pages that refuse a fetch — last rung of the
                    ladder, hands off to find-stop/authoring; one host is deep
                    enough to sit in references/eurostar.md rather than inline
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
- **A hosted share link stores ciphertext and nothing else** (issue #116): the
  default link is now `#s1=<id>.<key>` — the document is encrypted in the page
  with a fresh AES-GCM-256 key, only the ciphertext is POSTed to the Worker in
  `worker/`, and *both* the id and the key ride in the fragment, so the store
  learns an id and the page host learns nothing. Never move either half into
  the query or a header, and never send the key anywhere: the operator being
  unable to read a trip is the property that makes hosting one acceptable at
  all. Why it exists: a link that carries the document grows with the document,
  and WhatsApp on Android silently declines to linkify a few-thousand-character
  URL — the recipient gets nothing and no error. A hosted link is ~120
  characters for any trip.
  The fragment schemes are **not** a legacy path and must keep working in both
  directions: they are the only share there is on `file://`, offline, in a
  build with `SHARE_ENDPOINT=` empty, or when the free tier's 1,000 writes/day
  are spent. Falling back to one is silent and automatic — a store failure is
  not the sharer's problem to read about, and `hostedLink()` returns null
  rather than throwing precisely so no failure can end in a dead end. Only two
  things are ever said out loud: the 30-day TTL, at share time (a link that
  stops working must say so when it is *sent*), and an expired share on the way
  in, which gets its own warning because "ask for a fresh link" is a different
  instruction from "this link is damaged". KV is eventually consistent, so a
  read retries over ~2s before it is allowed to call anything expired.
- **A room is the same blob made replaceable, and the key *is* the room**
  (issue #124). One master key `K` never leaves the page; `id`, the content key
  and the write token are all HKDF(K, …) with distinct info strings, so the
  store learns an opaque id and a hash of a hash and still cannot read
  anything. Two link grades fall out: `#w1=<K>` writes, `#v1=<id>.<key>` only
  reads — and a viewer cannot re-derive the token, because the derivation only
  runs forwards. There is no per-person identity: **the link is the
  permission**, forwarding an edit link hands over editing, and the only
  revocation is Reset sharing, which retires the room and mints another.
  Because the id is derived, `PUT /:id` **creates as well as replaces** and a
  room cannot die, only nap: expiry costs a link's *uptime*, never a trip, and
  the next push heals it at the same id — which is why none of the "your old
  link stopped working" machinery exists. The corollary is that **Stop sharing
  must forget `K` locally as well as deleting the blob**, or the next push
  resurrects the room somebody just asked to end.
- **Push is manual; pull is automatic** (issue #124), and the asymmetry is the
  simplification — no debounce, no `pagehide` flush, no in-flight
  serialisation. `persist()` runs on every mutation, so pushing on it would be
  a network write per ticked checkbox, and the free tier's 1,000 writes/day is
  **one Cloudflare account's quota shared by everyone using the deployed
  page**; reads are ten times that, so freshness rides on them instead (a
  ≥60s poll, gated on the tab being visible *and* a room existing). Staleness
  nobody can see is the cost, so the status pill carries it — "3 changes not
  shared", which is `rev > rev_pushed` and costs nothing to compute because
  `persist()` has just settled `rev`. If quota pressure ever shows up the lever
  is a minimum interval between pushes, not automation. An automatically pulled
  document may land **silently only when it lands clean** (nothing unpushed
  locally, and `classifyImport` says `newer`); anything else is *parked* and
  the pill says so, because a resolve banner thrown over a half-finished edit
  is worse than the staleness it replaced — and `older`/`duplicate` are dropped
  without a word, since a mutable slot read through an eventually consistent
  store can regress.
- **The compare-and-set is best-effort, and the rev chain is the guarantee**
  (issue #124). KV has no atomic primitive: the Worker's `If-Match` is
  read-then-put over an eventually consistent store, so two racing pushes can
  both pass it and the read itself can be ~60s stale. The 409 is therefore an
  optimisation — it catches most conflicts at the friendly moment, seconds
  after the user tapped Update — and PUT's **swap semantics** (the blob it
  replaced comes back in the response) catch most of the rest. Build on the
  weaker invariant: *a missed 409 degrades a push-time conflict into a
  pull-time fork; it never silently discards anyone's trip.* Do not add
  cleverness on KV to close the window — the honest upgrade is a Durable
  Object, deliberately out of scope. Inside a room the banner's answers take
  room-specific meanings: **Keep mine** is not "push my rev 8 over their rev 8"
  (the other side would fork, permanently) but my content renumbered above
  theirs and sent, and **Keep both** forks *my* copy out of the share and lets
  the shared trip become theirs — forking theirs instead would leave the shared
  trip diverged and re-park the same conflict on every pull. Either answer must
  record the etag it was shown, or resolving is itself detected as a clobber.
- **The room is never the source of truth**: the localStorage library is, and
  the room is transport. `file://`, offline, an empty `SHARE_ENDPOINT` and a
  spent quota all keep working — sync just doesn't happen, and "Send a copy"
  still produces a link. The room record (`hShare:<trip_id>`, lib/room.js) is a
  **fourth key space** and deliberately not a field on the index row, which
  `entryFor()` rebuilds from the document on every save; keying by `trip_id`
  also settles fork inheritance for free. It is quota-classed with the working
  copy rather than history, and it is **never** in the downloaded JSON — a file
  gets mailed around casually, and a key inside one would silently promote
  every recipient to writer.
- **There is one warning banner, and one way to raise it**: the upload guard,
  the import decision, the saved-data version guard, a failed share link and a
  room's conflict (issue #124) all write the single `#hverwarn` element through
  `showUploadWarning(icon, title, body, buttons)` in `app.js`, and put it away
  through `hideWarning()`. It sits *above both screens* in `index.html` rather
  than inside `#hupl`: a room's conflict arrives while a trip is open, and
  parked inside the opening screen the banner was `display:none` exactly when
  it had something to say. Do not
  reach for `getElementById('hverwarn')` — it used to appear 11 times, and the
  line that hides it 9 times, which is how a banner gets left on screen after
  the decision it was asking about is settled. A banner that parks a decision
  puts it in a `state.pending*` slot and every button that answers it goes
  through `resolveWarning(slot, fn)`, so clearing the slot and hiding the
  banner cannot come apart. `title`/`body` are HTML: anything from a document
  or an error goes through `esc()` first.
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
  absolute `http(s)` links survive. **Free prose is the one exception**, and it
  is still an escaping sink: segment notes and warnings, list item notes and
  phrase notes render through `linkify()` (issue #109), which escapes every
  non-URL run itself and puts each link through `safeUrl()` — so it *replaces*
  `esc()` at that call site and must never be wrapped in one. Only prose goes
  through it: a value in an attribute, a `<code>` ref or anything that must stay
  literal keeps using `esc()`. It links an explicit `http(s)://` only — a bare
  `example.com` stays text, because guessing a scheme turns ordinary prose into
  links.
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
- **The AI's tools come in entity families, and the family is the unit**:
  segments, lists and phrase groups each need a read-before-edit guard, a
  wrong-id error, id assignment and a schema check. Each of those four is
  written *once* in `ai/tools.js` (`guardRead`, `noSuchId`, `assignIds`,
  `schemaError`) and named per family beneath. They were three copies apiece
  before, which is how the phrase-group messages ended up phrased differently
  from the list ones. A fourth family is four one-liners plus its branch of
  `applyTool` — not four more copies.
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
  of one true one (issue #76). The map itself is `lib/seg-defs.js`, imported by
  both: it used to be typed out in each, and a type added to one and not the
  other falls back to the `oneOf` silently. ajv still stays out of `lib/` —
  only the map is shared, so the bundle can never gain a second copy of ajv.
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
- **The three modals share `.hmodal` / `.hmodal-inner`**: the edit, settings
  and trip-switcher backdrops and cards were byte-identical CSS bar `z-index`
  and `max-width`, so only those differ per modal now. Their header and footer
  rows are deliberately *not* shared — each pads them differently, and forcing
  them together would change rendering. A new modal is the two classes plus an
  id rule for its width and stacking order.
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
- **Meaning lives in the markup, not in the size and colour** (issue #92): the
  views carry a real heading outline — each screen's own `<h1>` (the opening
  screen's is `sr-only`, the open trip's is `#htname`, and only one is ever
  displayed), `<h2>` per day / list / group, `<h3>` per segment — and any
  sequence that is a list is a `<ul class="hplain-list">` of `<li>`s, which is
  what buys "list, 8 items… item 3 of 8". None of it may change the rendering:
  headings carry `margin:0` and the same inline font rules the `div`s had, and
  `.hplain-list` sets no `display` because the `<li>` is already a `.hseg` card
  or a `.hli` flex row. An `aria-hidden` icon that carried a *relationship* —
  the transport arrow, the phone, the warning triangle — needs the word back as
  `sr-only` text; an icon-only control needs an `aria-label` naming *which*
  thing it acts on ("Edit Eurostar", "Open seg-a1b2 in itinerary"), which makes
  the label another untrusted sink that goes through `esc()`. State signalled
  by a class alone is invisible to assistive tech, so `updateActiveChip` sets
  `aria-current` in the same line as `.on`. `tests/e2e/a11y.spec.js` asserts
  names through `getByRole`, the same computation a screen reader runs.
- **There is exactly one focus-outline rule** (`styles.css`, issue #90), and
  nothing else in the file may write `outline`. It is `:where(…):focus-visible`
  at near-zero specificity so per-control rules keep winning on everything
  else; a control that sets `outline:none` to style its own focus is how five
  inputs ended up signalling focus with a .5px border alone, under the 3:1
  WCAG 2.4.11 asks. Style focus *in addition* to the ring, never instead of it.
- **A re-render may not drop focus, and a mutation says what it did**
  (issue #93): the Lists, Phrases and Itinerary views redraw wholesale with
  `box.innerHTML = …`, which destroys the control the user was on — focus falls
  back to `<body>` and the next Tab restarts at the top of the document (3.2.2).
  Every control worth returning to therefore carries a `data-focus="role:key"`,
  and mutations go through `keepFocus()` in `views/focus.js` rather than calling
  the renderer directly. The key is the control's position in the *document*,
  which is not its position on screen: the Lists view sinks done items below the
  open ones (`displayOrder` in `lib/lists.js`), so the checkbox that was pressed
  has moved by the time it is restored, and that is the case that was broken.
  It is deliberately *not* an identity — a mutation that shifts the indices
  themselves leaves the key on whatever moved up into the slot, which is
  survivable only because the mutation that does that (a delete) destroys the
  focused control anyway and hands focus somewhere explicit. A view that gains a
  mutation which re-indexes rows without removing the focused one needs a real
  identity key (a WeakMap from the item object to a minted key), not another
  fallback. `keepFocus`'s extra arguments are where focus should land when the
  mutation deliberately moves it — a delete hands over to the Undo button, which
  is also the only recovery from it. `openModal`/`closeEdit` do the same across
  the modal, which is why `saveEdit`/`deleteEdit` re-render *before* closing.
  The counterpart is `announce()` and the single `#hlive` `role="status"` region
  (4.1.3): it lives in `src/index.html` because a region created and written in
  the same frame does not announce reliably, it is polite because none of this
  should interrupt, `aria-atomic` is spelled out so the whole sentence is read
  rather than the text node that changed, and a message identical to the one
  already there gets an invisible suffix — an unchanged region announces
  nothing. The sentences themselves are built in `lib/lists.js` and
  `lib/phrases.js`, not in the views, so the spoken count and the visible
  progress badge are one `listProgress`/`phraseCount` call and cannot drift.
  `tests/e2e/focus.spec.js` drives all of it from the keyboard, the case that
  was broken.
  Restoring focus around the redraw is not the same as not redrawing: the
  wholesale rewrite still throws away scroll position and any half-typed text in
  *another* section's quick-add box, and those two are the accepted cost of
  keeping the redraw here. Either of them turning up as a complaint, or the
  helper starting to accrete special cases, is the signal to stop rebuilding
  wholesale and mutate the affected row in place instead. That follow-up is
  scoped to **Lists and Phrases only**: the itinerary's pencils and the modal go
  through `refreshAfterChange()` → `renderAll()` (`src/render.js`), and that
  redraw is correct — a modal save can change a segment's date and move it
  across day headings, the Schedule, the map and the budget — so those two
  surfaces depend on `keepFocus` whatever happens to the other two.
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
- **The AI transcript is saved; a turn's working state is not** (issue #99):
  `state.chat` is written to one localStorage slot, scoped to the open trip's
  `trip_id` so a conversation comes back with the document it was about and
  stays hidden under another. `state.draft`, `state.ops` and the read guards
  are deliberately left out — a preview restored after a reload would offer to
  apply changes computed against a document that has since moved on. History is
  expendable and the trips are not, so a write that does not fit drops it
  rather than crowding out a save (same policy as revisions in `lib/library.js`).
  Restoring means an old transcript is replayed to the model on the next turn,
  exactly as it would have been before the reload.
- **Default times live in `lib/dates.js`** — do not add inline `|| '14:00'`
  style fallbacks in views. So does every date *format* and the ms arithmetic
  around a day's bounds: a view writing `toLocaleDateString` or
  `new Date(iso + 'T23:59:59')` inline is how the Schedule ended up with a
  fourth date format and its own copy of `msToIso`. Add a named helper there
  (`fmtDayMonth`, `fmtStamp`, `endOfDayMs`) rather than a format in a view.
- **Inline onclick handlers** in markup call `window.h*` globals; if you add
  one, export the handler and register it in the `Object.assign(window, …)`
  block in `main.js`.
- **lib/ stays pure**: no DOM, no `state` import, no `window`. If a view
  needs new logic, put the calculation in `lib/` with a unit test.
- **Examples/tests use fictional data only** (the Jetsons pattern): no real
  names, addresses, booking references or coordinates of private lodgings.
- **A skill's frontmatter description is always in context; its body is not.**
  So the description carries the *triggers* — when to reach for this rather than
  its neighbour — and nothing else; a "Covers: x, y, z" table of contents is
  body content parked in the always-on slot. In the body, keep what could not be
  rederived on the spot (the traps, the real failures, the tool invocations) and
  cut what restates it: a decision tree above the sections it indexes, a closing
  checklist repeating the body, a lookup table whose entries are guessable. A
  rule that belongs to another skill is *linked*, in one line, not restated —
  the handoff paragraphs had drifted into five phrasings of the same thing. A
  per-host or per-region deep-dive that is read once a trip goes in a
  `references/` file beside the SKILL.md (`browser-research/references/`).
  Authoring rules are the exception to all of this: they live in
  `lib/doctrine.js` and are generated into the skill, never written by hand.

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
