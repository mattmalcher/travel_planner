# Holiday Itinerary Viewer

**[Open the viewer](https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html)**

![A short recording of the viewer: an example Paris weekend opening from a
share link, then the Itinerary, Map, Schedule, Lists, Phrases and Budget
tabs](https://mattmalcher.github.io/travel_planner/demo.gif)

# What is this thing?

A tool for planning holidays, and viewing that plan when you are there.

# Why does it exist?

I find planning holidays really stressful, but I like having a plan. I also like procrastinating by making things to avoid holiday planning.

I started using AI tools to try and make plans for me, but its hard to get the details you want and do incremental changes. You also often end up with really generic recommendataions.
Also, there are things its very hard for it to do (like book accomodation) that are kind of crucial, and need to be in the plan, but it doesnt control them.

I also find it hard to visualise dates and times, so I wanted a viewer you could show the plan in and see where you have gaps or overlaps. I am a big fan of the (clashfinder)[https://clashfinder.com/], and thought something like a holiday version of that could be good.

To enable that I started with a standard format ([holiday_itinerary_schema.json](schema/holiday_itinerary_schema.json)) which can be read by AI tools, and at a pinch, a person. Having a standard format makes it easier to go back and forth, and it means you can design a viewer for that format.

# Why does it work this way?

It was important to me that this thing worked both on a desktop (big holiday research task time), but also on a phone (when you are out and about on your holiday). Inevitably things go wrong, or you learn about some new thing when you arrive somewhere, so it needs to be easy to update the plan on mobile. (The AI features are targeted at something like "remove event $BLAH, and put it on Tuesday, and make me a list of alternative $BLAH things I could do today")

Working offline is important too, its pointless having some fancy AI itinary thing, which you are then unable to load if you head out on a walk up a mountain, or on patchy signal on a train. I have tried to go PWA (Progressive Web App) and make this thing work in airplane mode. I have also tried to make sure that AI isnt the only way to modify the plan, so you arent stuffed when you cant access one.

Maintaining a server and keeping it up to date and secure to enable your holiday planning feels like a bad idea. I also like the idea (however unlikely) that other people might use this thing. I dont want to have to look after their holiday plan details! So this thing is just a web page hosted on Github - no backend, stuff gets stored in browser local storage.

Having no server to store state makes some things a bit harder. Another key feature for me is the ability to share the plans and work on them with someone else in a versioned way. The workaround is share links which contain the entire plan. That way people can use this, and all someone has to do to view someone else's plan is click on a link. This is also a neat workaround for any issues people might have with local storage getting cleared out - they can just click their link again.

Share links turned out to solve a second problem too. The in-app AI editor is
deliberately small — it sees a one-line summary of each segment, not the whole
file, because that is what fits on a phone. The heavier tooling (`make
validate`, the station database, the authoring rules in
[`.claude/skills/`](.claude/skills)) needs a checkout and a shell, which used to
mean a laptop. It doesn't any more: a **Claude Code cloud session** — the Code
tab in the Claude app, or [claude.ai/code](https://claude.ai/code) — clones this
repo into a container with all of it available. Share a trip from the viewer,
paste the link into a session, and it comes back as a link you tap to import:

```bash
npm run itin -- link --decode '<share link>' --out data/trip.json
# ... edit, make validate FILE=data/trip.json, npm run itin -- bump ...
npm run itin -- link --encode data/trip.json
```

Real trips still never leave `data/`, which is gitignored. See
[`.claude/skills/itinerary-authoring/SKILL.md`](.claude/skills/itinerary-authoring/SKILL.md)
§1b for the full loop and what it can't do (the browser-driven research needs
your own machine).


# What is this thing? (techy version)
A standalone HTML viewer for `HolidayItinerary` JSON files: itinerary, map,
schedule and budget views, plus an optional AI editor (bring your own
OpenRouter key). Load a file, or start an itinerary from scratch and build it
up by hand, then send the whole trip to someone as a link — the itinerary
travels inside the link's `#` fragment, so there is nothing to host and no
account to make (and anyone holding the link can read the whole trip). The
app is developed as modular source in `src/` and built into a
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
| `make demo` | Build, then record `demo/demo.gif` — the README animation (needs `ffmpeg`) |
| `make validate FILE=…` | Schema-check and lint an itinerary file (defaults to `data/*.json`) |
| `make itin ARGS="…"` | The itinerary CLI: `digest`, `ids`, `bump`, `link`, `schema-brief` |

`make itin ARGS="--help"` lists what the CLI does. It is the same tool the
authoring skill drives, and `link` is what moves a trip between the viewer and
a session with no `data/` — see the note on cloud sessions above.

The demo recording is build output, like `dist/`: CI records it and publishes
it next to the deployed viewer, and neither is committed. Change what it shows
by editing the tour in [`scripts/demo.mjs`](scripts/demo.mjs).


## Guidance for AI Models & Developers

See [CLAUDE.md](CLAUDE.md) for the architecture map, project invariants
(single-file build output, schema-version rules, escaping rules) and testing
conventions. In short: put logic in `src/lib/` with unit tests, keep views
DOM-only, run `make lint test` before pushing, and never commit `dist/`.
