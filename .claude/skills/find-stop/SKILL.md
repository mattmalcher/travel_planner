---
name: find-stop
description: "Use this skill when an itinerary needs the coordinates of a place a journey starts or ends at — a train station, bus or tram stop, ferry pier or airport — or when a segment is missing lat/lng, or a stop name needs checking against a real station. Searches the local Trainline European stations database first and falls back to the OpenStreetMap Overpass API for bus stops and anything it does not cover."
---

# Finding a stop's coordinates

## Which source to use

- **Trainline** (`trainline-eu/stations`) — ~72k European **train stations**,
  plus airports and some coach stops. One cached file, no rate limit, no
  network round trip per query. Use it for anything that sounds like a
  railway station. Coverage is strongest in CH, DE, FR, SE, ES, IT, GB, AT.
- **Overpass** — everything else: bus stops, tram stops, ferry piers, minor
  halts, and any station Trainline does not have. Rate limited (see below).

Trainline holds no small bus stops at all, so a village bus stop goes straight
to Overpass. Don't spend a query proving that — and if a `bus-timetables` GTFS
feed is already downloaded for that stop's times, its coordinates are in there.

## Step 1 — search Trainline

```bash
STATIONS_CACHE=<scratchpad> .claude/skills/find-stop/tools/lookup.sh '<pattern>' [CC]
```

The pattern is an extended regex, matched case- and **accent-insensitively**,
so `san sebastian` finds `San Sebastián`. Look up several stops in one call by
alternating them: `'bayonne|hendaye|san sebastian'`. The optional second
argument is an ISO 3166-1 alpha-2 country filter (`ES`, `FR`) — worth using,
because the same name recurs across countries.

Point `STATIONS_CACHE` at the session scratchpad so the ~16 MB `stations.csv`
downloads once per session rather than once per lookup. **Never read that file
into context** — the script is the only thing that should touch it.

Reading the output:

- `CITY GROUP — not a platform` marks a *meta station*: a city centroid that
  groups the real stations, not somewhere a train stops. Never use its
  coordinates for a stop. `San Sebastián` is a city group; the station is
  `Donostia-San Sebastián`, ~700 m away.
- `in group <id>` means the row is one of several stations in that city. Rows
  sharing an id are alternatives — pick the terminus the journey actually uses
  (`Paris Gare du Nord` vs `Paris Montparnasse` matters).
- Only user-selectable stations are listed; deprecated rows are filtered out.
  `is_city` and `is_main_station` exist in the data but upstream documents them
  as unreliable, so nothing here ranks on them.

If a stop is missing, or it is a bus/tram/ferry stop, go to step 2.

## Step 2 — Overpass fallback

Overpass enforces per-IP concurrency limits and answers 429 when too many
requests are in flight, so build **one** query covering every stop Trainline
could not answer and fetch it with a **single** WebFetch — never parallel calls.
Keep `[timeout:15]` or lower so you don't hold a server slot. If one combined
query returns too much noise, split it into *sequential* requests.

Scope it with a bounding box derived from coordinates already in the itinerary
(including any you just got from Trainline), or with a union of
`area["name"="TownA"]->.a;` … `node[…](area.a);` scopes where the places are
named but far apart.

```
[out:json][timeout:15];
(
  node["highway"="bus_stop"]["name"~"TownA|TownB|TownC",i](south,west,north,east);
  node["public_transport"="platform"]["name"~"TownA|TownB|TownC",i](south,west,north,east);
);
out body;
```

URL-encode it onto `https://overpass-api.de/api/interpreter?data=<encoded-query>`.
Each element has `lat`, `lon`, and `tags` (including `name`, and sometimes
`ref` or `network`).

## Step 3 — report

For each requested stop, report the top matches (up to 3) in a table: name,
lat, lon, country or any useful tags, **and which source it came from**. Flag
the best match.

Then output the JSON snippet ready to paste into the itinerary — for example:
```json
"departs": {
  "place": "Stop Name As It Appears In Itinerary",
  "time": "HH:MM",
  "lat": 12.3456,
  "lng": 1.2345
}
```
Three translations to get right:
- OSM uses `lon` and Trainline uses `longitude`; the itinerary schema uses `lng`.
- Trainline's `name` is the *locally known* name (`Donostia-San Sebastián`).
  Keep `place` as the name the itinerary uses for the stop; the database name
  is for finding it, not necessarily for displaying it.
- The stop's name field is `place`. It was `station` before schema 3.0, and
  stale `station` keys are a recurring source of validation failures.

Everything else about writing into a document — ids, required fields, where a
researched thing belongs — is `itinerary-authoring`.

## Attribution

`stations.csv` is ODbL-licensed, derived from OpenStreetMap, SNCF OpenData,
GeoNames, Digitraffic.fi and OpenTransportData.swiss. It is a working cache in
the scratchpad — do not commit it to this repo.
