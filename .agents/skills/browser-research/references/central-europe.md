# DB / ÖBB / SBB: which source to trust, and how to drive it

Read this before a browser session on a German, Austrian or Swiss leg
(behaviour verified September 2026). Get the structure from `journey-planner`
first; come here for the operator-grade confirmation.

## What works

- **`sbb.ch` is the single best source for the whole region.** It covers
  Germany and Austria as well as Switzerland, shows per-leg detail including
  rail-replacement buses and line closures, and prints supersaver fares.
  - Its search form **ignores station names passed as URL parameters**
    (`?von=X&nach=Y` fills the boxes but the search returns nothing). Type
    each field and pick a suggestion from the autocomplete. Date and time
    fields accept typed values (`23.09.2026`, `13:00`) followed by Escape.
  - Use the swap-direction button when chaining searches along a route.
- **bahn.de is reachable only through a deep link** driven from a real Chrome
  tab: `https://int.bahn.de/en/buchung/fahrplan/suche#` plus `so`/`zo`
  (display names), `soid`/`zoid` (full `A=1@O=…` ids), `hd` (ISO datetime),
  `kl=2`, `r=13:16:KLASSENLOS:<pax>`, `s=true` for fastest only. The GET
  location lookup `int.bahn.de/web/api/reiseloesung/orte?suchbegriff=<name>&typ=ALL&limit=4`
  returns the ids from the page context. Results include "from €" prices.

## What does not

- **bahn.de returns `OPS_BLOCKED` to every API call from a datacenter IP**;
  User-Agent and Referer do not help. The POST connection search is blocked
  even from the user's own browser — the bot check is on the endpoint.
- **bahn.de deep links 404 (error 751) on station names containing
  parentheses** (`Frankfurt(M) Flughafen Fernbf`), and **rate-limit after
  roughly six searches**, after which everything 751s. Budget the searches;
  use sbb.ch for those stations.
- **`transport.opendata.ch` lies about international legs.** It reported the
  Zürich → Paris Lyria as split at Mulhouse with a 2-hour wait when SBB showed
  it direct, and returned nothing for Salzburg → Zürich. Fine for Swiss
  station ids; never for a cross-border journey.
- **`v6.db.transport.rest` and its mirrors** answer 503. Do not build on them.

## Feeds you can read offline instead

Germany `https://download.gtfs.de/germany/free/latest.zip` (unofficial
aggregate, 280 MB), Switzerland via the opentransportdata permalink, Austria
`static.oebb.at/open-data/soll-fahrplan-gtfs/GTFS_OP_<year>_obb.zip` (the
2025 file was still the one served in September 2026; check data.oebb.at for
the current name) — all in `bus-timetables` §1a and read by `gtfs_query.py`.
