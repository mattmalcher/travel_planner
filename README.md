# Holiday Itinerary Viewer

**[Open the viewer](https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html)**

A standalone HTML viewer for `HolidayItinerary` JSON files: itinerary, map,
schedule (gantt) and budget views, plus an optional AI editor (bring your own
OpenRouter key). Load a file, or start an itinerary from scratch and build it
up by hand, then send the whole trip to someone as a link — the itinerary
travels inside the link's `#` fragment, so there is nothing to host and no
account to make (and anyone holding the link can read the whole trip). The
app is developed as modular source in `src/` and built into a
single self-contained `dist/holiday_itinerary_viewer.html` — the built file
is produced by CI for deployment and is not committed.

## Try it: an example share link

**[Weekend in Orbit City](https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html#d1=vZNNb9swDIb_isCzUliOnbU6Nhs29JJiGbDDUASKxKaCbcmgZA9ekP8-yEiWj6bFDsNOhil-vQ_JLQT9go1a9UjBegcSpjfFTQYcItkW5BacahAkfEes0BlmHVvQ2kY2t3EY3VSPdY0UQP6Ah84M7AFj8A44fKrJ__l94hCioggS8iz_MMnKiSiAAzpzapoBB90RodPDqiXbKBpAwuf7R9hxCLhp0MVUaws2BQbcTETqY2hTm5GUC62nCBwab_Ymm7rxLZKKnkDCshp-qoF9VbYGDoTPIGExF_k0NWRUxMsmDbaKUtkttLXS6f0eDXldsTm6SCrliXYkld1JUaZmFZHt8SzoiI4tq2Hf5z5OCFlkKc50pKL1btVYB1IUJQftQ0x5VOM7F0EWt0dKezoj3tgFkNAqa4CPn9U6vZ-OZbfjJ-jyIzqltW8ab8bawA-D_-Ij1mzZKo11GrgyhjCkMoIt24QAI3us1S_FzzdDv6CukoLtVaTP5JuUpJTZqHp091285p-WYhQisoP3BRCRZ-8SQWes26RJdqeZM3HBY3rkgT26NJ7QrQ_L5Ts6gllWA_tGqmF7c4-uu5jxYh2Q-hEo-4i6urJd5ckCFEnc5fzvstdq8_xvxJ4rK_7NkRTTXFyRMbt-JO_u-0zm2Rt38uZxiVtZlP_jSJ52vwE)** —
a two-night trip to a fictional city for two of the Jetsons: a train there and
back, a hotel, one outing. Opening it loads that itinerary into the viewer,
where it saves to your browser's trip library like any other trip.

The trip it carries is `examples/orbit_city_weekend.json`; after editing that,
regenerate the link with
`node scripts/share-link.mjs examples/orbit_city_weekend.json`.

That link is the whole feature: the itinerary is deflate-compressed into the
URL's `#` fragment, so there is nothing hosted anywhere and the fragment never
reaches a server log. It is also why a share link is treated as untrusted
input — an incoming one goes through the same schema validation as an uploaded
file (see [CLAUDE.md](CLAUDE.md)).

## Getting Started

### Prerequisites

- Node.js (v20+ recommended)
- npm

### Installation

```bash
make install                      # node dependencies
npx playwright install chromium   # browser for the E2E suite
```

## Usage

| Command | Description |
|---|---|
| `make build` | Build `dist/holiday_itinerary_viewer.html` from `src/` |
| `make host` | Build, then serve the app at `http://localhost:8345` |
| `make lint` | Run ESLint |
| `make test-unit` | Fast unit tests for the pure `src/lib/` modules |
| `make test-e2e` | Build, then run the Playwright E2E suite (headless) |
| `make test` | Unit tests followed by E2E tests |
| `make test-ui` | Playwright interactive UI runner |

## Directory Structure

```text
.
├── src/                    # modular app source (built into a single file)
│   ├── index.html          #   markup skeleton with build placeholders
│   ├── styles.css          #   all CSS
│   ├── main.js             #   entry point / bootstrap
│   ├── lib/                #   pure logic (cost, sort, dates, gantt geometry…)
│   ├── views/              #   DOM rendering (list, budget, map, gantt)
│   └── ai/                 #   OpenRouter assistant
├── schema/
│   └── holiday_itinerary_schema.json   # JSON Schema for itinerary files
├── examples/               # anonymised example itineraries
├── scripts/
│   ├── build.mjs           # esbuild single-file bundler
│   └── share-link.mjs      # print the share link for an itinerary JSON file
├── tests/
│   ├── unit/               # node --test unit tests (milliseconds)
│   └── e2e/                # Playwright tests against the built artifact
├── playwright.config.js
├── Makefile
└── CLAUDE.md               # commands, architecture map and invariants
```

## Guidance for AI Models & Developers

See [CLAUDE.md](CLAUDE.md) for the architecture map, project invariants
(single-file build output, schema-version rules, escaping rules) and testing
conventions. In short: put logic in `src/lib/` with unit tests, keep views
DOM-only, run `make lint test` before pushing, and never commit `dist/`.
