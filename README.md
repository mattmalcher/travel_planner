# Holiday Itinerary Viewer - Development & Test Harness

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
├── holiday_itinerary_viewer.html  # The standalone interactive HTML application
├── playwright.config.js           # Playwright test configuration & web server setup
├── Makefile                       # Developer-friendly shortcut targets
├── package.json                   # Project metadata and script definition
└── tests/
    └── viewer.spec.js             # End-to-End integration tests
```

---

## Guidance for AI Models & Developers

When making changes to the itinerary viewer (`holiday_itinerary_viewer.html`):
1. Keep the HTML standalone (inline CSS and JS) unless refactoring is requested.
2. Ensure you run the E2E test suite to verify your changes did not introduce regressions:
   ```bash
   make test
   ```
3. If new features are added, update or extend the tests in `tests/viewer.spec.js` to cover them.
