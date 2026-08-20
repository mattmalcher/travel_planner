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

I also find it hard to visualise dates and times, so I wanted a viewer you could show the plan in and see where you have gaps or overlaps. I am a big fan of the [clashfinder](https://clashfinder.com/), and thought something like a holiday version of that could be good.

To enable that I started with a standard format ([holiday_itinerary_schema.json](schema/holiday_itinerary_schema.json)) which can be read by AI tools, and at a pinch, a person. Having a standard format makes it easier to go back and forth, and it means you can design a viewer for that format.

# Why does it work this way?

It was important to me that this thing worked both on a desktop (big holiday research task time), but also on a phone (when you are out and about on your holiday). Inevitably things go wrong, or you learn about some new thing when you arrive somewhere, so it needs to be easy to update the plan on mobile. (The AI features are targeted at something like "remove event $BLAH, and put it on Tuesday, and make me a list of alternative $BLAH things I could do today")

Working offline is important too, its pointless having some fancy AI itinary thing, which you are then unable to load if you head out on a walk up a mountain, or on patchy signal on a train. I have tried to go PWA (Progressive Web App) and make this thing work in airplane mode. I have also tried to make sure that AI isnt the only way to modify the plan, so you arent stuffed when you cant access one.

Maintaining a server and keeping it up to date and secure to enable your holiday planning feels like a bad idea. I also like the idea (however unlikely) that other people might use this thing. I dont want to have to look after their holiday plan details! So this thing is just a web page hosted on Github - no backend, stuff gets stored in browser local storage.

Having no server to store state makes some things a bit harder. Another key feature for me is the ability to share the plans and work on them with someone else in a versioned way. The workaround is share links which contain the entire plan. That way people can use this, and all someone has to do to view someone else's plan is click on a link. This is also a neat workaround for any issues people might have with local storage getting cleared out - they can just click their link again.

Unfortunately messaging apps don't always like long links. So there is now a Cloudflare Worker that holds a blob for 30 days behind a short link. It can't read what it holds - the plan is encrypted in your browser and the key travels in the `#` part of the link, which browsers never send to a server.  If it is down, out of quota, not configured, or you are offline, sharing quietly falls back to the old link with the whole plan in it. 

A link that freezes the plan the moment you send it is only half of what I wanted, though. Plans change, and re-sending a link every time is exactly the sort of admin that makes people stop bothering. So the stored blob can now be *replaced*: **Share live** gives you a link that stays current, and ticking **Let them edit** gives the other person a link that lets them change the plan too. Still no backend holding your holiday, still ciphertext the operator can't read - the same trick as before, only the slot is writable, and who may write to it comes out of the link rather than out of an account.

It is deliberately janky, and I think that is the right trade. You tap **Update shared copy** to send your changes; it is not live and it does not sync in the background. That is partly because writes to the free tier are a shared budget across everyone using the page, and partly because a thing that quietly syncs is a thing that quietly overwrites. What you get instead is a little status pill that says how many changes you haven't shared yet, and a nudge rather than a surprise. Changes coming the *other* way do arrive on their own, but they only land silently when they can't tread on anything you were in the middle of; otherwise they wait until you say so.

The plan in your browser stays the real one throughout. If two of you edit from the same starting point the app says so and asks, exactly as it already did for a file or a link - nobody's version gets thrown away. And if a shared link expires (30 days after the last update) that pauses the link, not the trip: one more update brings the same link back to life for everyone you sent it to.


# What is this thing? (techy version)
A standalone HTML viewer for `HolidayItinerary` JSON files: itinerary, map,
schedule and budget views, plus an optional AI editor (bring your own
OpenRouter key). Load a file, or start an itinerary from scratch and build it
up by hand, then send the whole trip to someone as a link — encrypted in the
browser and stored as ciphertext behind a short link, with the key in the
link's `#` fragment so it never reaches a server, or carried whole inside the
fragment when there is no store to reach. A link can be a frozen copy, or a
**live** one that keeps up with your updates; a live one comes in two grades,
view and edit, and the link *is* the permission — forwarding an edit link
hands over editing. Either way there is no account to make, and anyone holding
a link can read the whole trip. The
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
