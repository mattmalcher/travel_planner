# Holiday Itinerary Viewer - Development & Test Harness

**[Open the viewer](https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html)**

This workspace contains the static HTML viewer for `HolidayItinerary` JSON files (`holiday_itinerary_viewer.html`), accompanied by a local development server and a Playwright-based End-to-End (E2E) integration test suite.

## Getting Started

### Prerequisites

- Node.js (v20+ recommended)
- npm

### Installation

Install the required node dependencies (Playwright and local static server):

```bash
make install
```

Make sure Playwright's local browser binaries are installed:

```bash
npx playwright install chromium
```

---

## Usage

A `Makefile` is provided to simplify hosting and running tests.

| Command | Description |
|---|---|
| `make host` | Starts a local static file server at `http://localhost:8345` |
| `make test` | Runs the full Playwright E2E integration test suite (headless) |
| `make test-ui` | Opens Playwright's interactive UI test runner |

---

## Directory Structure

```text
.
├── holiday_itinerary_schema.json  # JSON schema defining the HolidayItinerary schema
├── holiday_itinerary_viewer.html  # Page markup & external CDN includes (entry point)
├── viewer.css                     # Application styles
├── viewer.js                      # Application logic (rendering, budget, map, gantt, edit)
├── playwright.config.js           # Playwright test configuration & web server setup
├── Makefile                       # Developer-friendly shortcut targets
├── package.json                   # Project metadata and script definition
└── tests/
    └── viewer.spec.js             # End-to-End integration tests
```

The viewer is split across three sibling files served statically by GitHub Pages:
`holiday_itinerary_viewer.html` holds the markup and references `viewer.css` and
`viewer.js`. The JS is a classic (non-module) script, so its functions remain in
global scope for the inline event handlers in the markup.

---

## Guidance for AI Models & Developers

When making changes to the itinerary viewer:
1. Styles live in `viewer.css`, logic in `viewer.js`, and markup in `holiday_itinerary_viewer.html`. Keep each concern in its own file. `viewer.js` stays a classic (non-module) script so its functions remain globally available to the inline handlers in the markup.
2. Ensure you run the E2E test suite to verify your changes did not introduce regressions:
   ```bash
   make test
   ```
3. If new features are added, update or extend the tests in `tests/viewer.spec.js` to cover them.
