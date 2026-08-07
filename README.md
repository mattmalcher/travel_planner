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

That worked right up until the links got long. WhatsApp on Android just refuses to make a several-thousand-character link tappable, and says nothing about it - the message arrives, the link looks fine, and the other person gets nothing. So there is now one small server after all: a Cloudflare Worker that holds a blob for 30 days behind a short link. It cannot read what it holds - the plan is encrypted in your browser and the key travels in the `#` part of the link, which browsers never send to a server. I still don't want to look after anyone's holiday plans, and now I can't.

I should be clear about where that Worker sits, because "no backend" and "there is a server now" sound like a contradiction. It is deliberately peripheral. It is about a hundred lines in its own `worker/` folder, deployed separately with its own tooling, and it is not part of the page's build at all - nothing in `src/` imports it, and the built HTML file does not contain it. The app never needs it to open, edit, save, upload or download a plan. The only thing it does is make one link shorter.

So the external dependency is real, but nothing important rests on it. Files are still the durable copy: download the JSON and you have your plan, no server involved. Local storage still works offline. And the old links that carry the whole plan are still there and still first-class - if the Worker is down, out of quota, blocked, or you are offline or on a saved copy of the page, sharing quietly falls back to one of those. You get a working link either way and it doesn't ask you to care why.

This is checkable rather than a claim, and I have checked it: `SHARE_ENDPOINT= make build` produces a page with no store in it at all, and that page still loads a file, saves, edits, downloads, and shares a working link - it just makes a long one, and contacts nothing to do it. If the Worker vanished tomorrow you could delete the folder and its one unit test, rebuild, and the only difference would be that shared links get long again. That is the deal I was after - a dependency small enough that losing it is an inconvenience rather than a broken app, and one that holds ciphertext it cannot read even while it is up.


# What is this thing? (techy version)
A standalone HTML viewer for `HolidayItinerary` JSON files: itinerary, map,
schedule and budget views, plus an optional AI editor (bring your own
OpenRouter key). Load a file, or start an itinerary from scratch and build it
up by hand, then send the whole trip to someone as a link — encrypted in the
browser and stored as ciphertext behind a short link, with the key in the
link's `#` fragment so it never reaches a server, or carried whole inside the
fragment when there is no store to reach. Either way there is no account to
make, and anyone holding the link can read the whole trip. The
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

The demo recording is build output, like `dist/`: CI records it and publishes
it next to the deployed viewer, and neither is committed. Change what it shows
by editing the tour in [`scripts/demo.mjs`](scripts/demo.mjs).


## Guidance for AI Models & Developers

See [CLAUDE.md](CLAUDE.md) for the architecture map, project invariants
(single-file build output, schema-version rules, escaping rules) and testing
conventions. In short: put logic in `src/lib/` with unit tests, keep views
DOM-only, run `make lint test` before pushing, and never commit `dist/`.
