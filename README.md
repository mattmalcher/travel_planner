# Holiday Itinerary Viewer

**[Open the viewer](https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html)**

A standalone HTML viewer for `HolidayItinerary` JSON files: timeline, budget,
map and gantt views, plus an optional AI editor (bring your own OpenRouter
key). The app is developed as modular source in `src/` and built into a
single self-contained `dist/holiday_itinerary_viewer.html` — the built file
is produced by CI for deployment and is not committed.

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
├── scripts/build.mjs       # esbuild single-file bundler
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
