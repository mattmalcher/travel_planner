# Travel Planner repository guide

This repository builds a holiday-itinerary viewer: a modular browser app for
`HolidayItinerary` JSON files with itinerary, map, schedule, lists, phrases,
budget, sharing, and an optional OpenRouter-backed editor.

The source lives in `src/`. The main deliverable is the generated, self-contained
`dist/holiday_itinerary_viewer.html`. Never edit or commit `dist/`; build and
deployment workflows generate it.

## Work autonomously

For requested code changes, inspect the relevant source, implement the change,
and run checks proportional to it. Ask only when a missing choice would
materially change the result or an external/destructive action needs approval.
Preserve unrelated work in a dirty tree.

Prefer `rg` and `rg --files` for discovery. Use `apply_patch` for manual edits.
Keep user updates concise and lead the final response with the outcome.

## Commands

```bash
make install     # npm install
make build       # src/ -> dist/holiday_itinerary_viewer.html
make lint        # ESLint over src/, scripts/, and tests/
make validate FILE=data/trip.json
make itin ARGS="digest data/trip.json"
make test-unit   # fast node:test suite; use while iterating
make test-e2e    # build + Playwright smoke layer
make test        # unit then e2e
make host        # build + serve dist/ at http://localhost:8345
```

CI runs lint, build, unit, and e2e checks. Use the narrowest meaningful check
during development, then broaden when the change crosses layers or affects the
built artifact.

## Architecture

- `src/index.html`: skeleton; the build replaces its `<!-- build:* -->` slots.
- `src/main.js`: entry point, DOM wiring, boot, and `window.*` handlers.
- `src/state.js`: shared mutable state and the schema-version placeholder.
- `src/store.js`: trip-library persistence; `persist()` is the single write path.
- `src/app.js`: load/reset, tab switching, edit modal, version guards.
- `src/render.js`: shared rerender entry points.
- `src/share.js`, `src/share-store.js`, `src/room.js`: encrypted snapshots and
  live sharing.
- `src/lib/`: pure, DOM-free logic imported directly by unit tests.
- `src/views/`: DOM rendering; move reusable calculations to `src/lib/`.
- `src/ai/`: browser-only OpenRouter assistant.
- `schema/holiday_itinerary_schema.json`: source of truth for itinerary shape.
- `scripts/itin.mjs`: desktop itinerary CLI, including doctrine generation.
- `worker/`: separate Cloudflare Worker for encrypted share storage.
- `tests/unit/`: `node:test` + `assert/strict`.
- `tests/e2e/`: Playwright against the built artifact.

Read [docs/architecture.md](docs/architecture.md) when a task needs the detailed
module map, sharing protocols, UI conventions, or historical edge cases. Do not
load that large reference for a small, isolated change.

## Core invariants

- The generated viewer remains self-contained. New source assets must be inlined
  by `scripts/build.mjs`. Service worker, manifest, and icon outputs are optional
  deployment sidecars; the HTML must still work without them and on `file://`.
- Never hardcode the schema version. The build injects it from the schema. Bump
  the schema's major version for a breaking stored-document change.
- Treat share links like untrusted uploads. Fragment payloads must still flow
  through schema/version validation and library import decisions.
- Hosted shares store ciphertext only. Keys and document data stay in the URL
  fragment, never queries, headers, logs, or the Worker. Preserve all existing
  fragment formats and offline/long-link fallbacks.
- Live-room updates use the established encrypted swap protocol. Preserve
  conflict and unpushed-change handling; never silently overwrite local work.
- All localStorage writes go through `store.js` persistence and its quota policy.
- `src/lib/` stays pure: no DOM, `window`, or shared-state imports.
- Date formatting, date arithmetic, and default times belong in
  `src/lib/dates.js`.
- Inline event handlers require a corresponding exported `window.h*` handler
  registered in `main.js`.
- Tests and examples use fictional data only. Do not commit real traveller
  names, addresses, booking references, private coordinates, API keys, or
  downloaded personal data.

## Repository skills

Task-specific skills use the open Agent Skills format under `.agents/skills/`:

- `itinerary-authoring`: edit, extend, validate, or research into itinerary JSON.
- `journey-planner`: European rail, coach and sleeper journeys including Great
  Britain, via the keyless Transitous API; the first call for any route question.
- `find-stop`: resolve station, stop, hut, trailhead and hotel coordinates.
- `sncf-timetables`: research or audit French train times.
- `bus-timetables`: query GTFS for bus, coach, tram, and shuttle service dates,
  with a table of open national and operator feeds across Europe and GB.
- `browser-research`: use browser automation only when ordinary web research is
  blocked or a user-authorized signed-in session is required; carries a call
  budget and per-host notes for Eurostar and DB/ÖBB/SBB.

Agents that support repository skills can select one from its frontmatter
description or invoke it explicitly using their normal skill syntax. Skills are
canonical in `.agents/skills`; `.claude/skills` is a compatibility symlink for
clients that use Claude Code's repository layout.

The itinerary-authoring doctrine is generated from `src/lib/doctrine.js`. Update
rules there and run `npm run itin -- doctrine --write`; never hand-edit the
generated marker block in the skill.

## Testing conventions

- Add or update a unit test when changing a `src/lib/` contract.
- Keep e2e network behavior hermetic with `page.route` where appropriate.
- E2e runs against `dist/`, and the npm script builds it first.
- Validate itinerary fixtures with `make validate FILE=<path>`.
- Do not commit build output, Playwright reports, test results, caches, or scratch
  downloads.
