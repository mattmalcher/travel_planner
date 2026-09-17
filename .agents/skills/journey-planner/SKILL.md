---
name: journey-planner
description: "Use this skill first for any rail, coach, sleeper or multi-country journey question anywhere in Europe including Great Britain — 'how do I get from London to X without flying', which trains connect, the last departure of the day, a station departure board, or a first check of a leg already written into an itinerary. Keyless Transitous API, one small script, no browser. French trains still verify through sncf-timetables, buses through bus-timetables."
---

# Planning a journey across Europe, from the desk

## Core insight

Almost every journey question that used to cost a browser session — Real Time
Trains, National Rail, SNCF Connect, bahn.de, sbb.ch — is answerable in one
keyless HTTP call to **Transitous** (`api.transitous.org`), a community
journey planner built on the operators' own open GTFS feeds. It knows GB rail
down to the headcode and platform, Eurostar, SNCF, NS, SNCB, DB, ÖBB, SBB,
Trenitalia, Renfe long-distance, Nightjet, European Sleeper, FlixBus and
BlaBlaCar Bus. The raw reply is 150–500 KB of JSON, which is why the script
exists: it prints the legs, train numbers, operators and platforms, and
nothing else.

Two rules that follow:

1. **Ask Transitous before opening a browser.** One call here replaces a
   browser session on Real Time Trains, National Rail or SNCF Connect.
2. **Transitous raises a question; the operator answers it.** It is an
   aggregator of feeds with the provenance stripped off. It does not know
   booking minimum-connection times, through-ticketing, fares, or every
   regional bus. Any leg written into a document is confirmed against the
   operator's own source first (§4).

## §0 — for a route you have not planned before: seat61 first

The Man in Seat 61 (`seat61.com`) is the curated answer to "how do I get to
X by train": the sensible route, which changes are bookable as one ticket,
where to cross Paris, which sleepers and ferries exist, what it roughly
costs, and where to buy. A planner cannot know any of that. It is not a
timetable — it gives typical times and examples — so read it for the shape
and the booking method, then take the dates from §1 and the confirmation
from §4. It fetches without a browser.

```bash
T=.agents/skills/journey-planner/scripts/seat61.py
$T France                                   # headings on the country page
$T France --find 'London to Lyon'           # the section for the route
$T Spain --find 'ferry'                     # Portsmouth–Santander/Bilbao
$T sleepers.htm --find 'Nightjet|European Sleeper'
$T train-and-ferry-to-dublin.htm --find 'SailRail'
```

A country page is up to 850 KB, so the script fetches it once (cached a
week), and prints the headings or the matching sections only — never fetch a
seat61 page whole into the conversation. Country pages are `/<Country>.htm`;
route pages live under `/trains-and-routes/`, `/international-trains/` and
`/stations/`; when a guessed path 404s, web-search `site:seat61.com <place>`
rather than trying variants. Cite it as `seat61.com, read <date>`.

## §1 — the script

```bash
S=.agents/skills/journey-planner/scripts/plan.py
$S "London St Pancras" "Lyon Part Dieu" 2026-09-25T08:00      # depart after
$S --arrive-by "Lyon Part Dieu" "London St Pancras" 2026-09-28T22:00 # last way home
$S --direct "London Kings Cross" "Edinburgh Waverley" 2026-09-25T08:00
$S --board "London Kings Cross" 2026-09-25T08:00 -n 4          # departure board
$S --geocode "Innsbruck"                                       # what a name resolves to
$S 43.7166,7.2515 44.0985,7.1897 2026-09-27T07:00 --json raw.json
```

- Places are a name or `lat,lng`. A name is geocoded and then **planned from
  its coordinates**, so a station name that resolves to the bus stop outside
  still finds the trains. Prefer coordinates from the itinerary when you have
  them; use `--geocode` when a name is ambiguous (a bare town name often
  matches a street or a bus stop of that name in several countries).
- Times are local to the origin; the script converts to and from the API's
  UTC. `-n` is the number of itineraries (default 4). Ask for a Saturday and
  a Sunday when the trip touches a weekend — a second call costs nothing.
- `--board` needs a real stop (the geocoder's first `STOP` hit); it prints
  the scheduled platform, which nothing else free does for GB.
- `--json FILE` keeps the raw reply for the rare time a field is needed that
  the summary drops (intermediate stops with times, `agencyUrl`,
  `routeUrl`). Never print it to the conversation.

The **`--arrive-by` search is the one that finds the cutoff** — the last
departure that still makes the final Eurostar or sleeper home is usually
earlier than the last train on the first leg. Run it for every "return home"
leg before writing anything downstream of it.

## §2 — what to check in the output

- **Train numbers** are in the summary (`EST 9055`, `TGV INOUI 6920`, `LNER
  GR6140`, `NJ 469`). GB numbers are headcodes (`GR6140`), not the public
  1A23-style ids; National Rail tickets do not carry either, so record the
  time and operator.
- **A transfer the planner computed is not a connection you can book.** It
  will happily walk you Lille-Europe → Lille Flandres in 7 minutes onto a
  separate OUIGO ticket, or across Paris in 4. Eurostar's own minimum for a
  through booking is about 1 h 15 across Paris; see
  `browser-research/references/eurostar.md` before writing any cross-Channel
  self-transfer.
- **Coaches appear as equals.** A FlixBus leg is often the fastest itinerary
  on paper; say so explicitly if you keep one, since comfort and luggage
  differ from rail and the traveller may not want it.
- **Sleepers span midnight**: the summary marks `(+1d)` on the arrival.
- **`no itineraries` is not "no journey".** It is the normal answer for a
  French departmental bus, for some Spanish regional operators, and during a
  feed outage.
  Fall through to `bus-timetables` or the operator.

## §3 — the map from London without flying

Everything below is reachable by the sources in this repository. Hubs first:

| Gateway | How | Then |
|---|---|---|
| **Paris Nord** | Eurostar, ~2 h 20 | all of France (`sncf-timetables`), Spain via Barcelona (TGV/AVE, or Hendaye → Donostia by Euskotren), Italy via Lyon–Turin/Milan (Trenitalia, TGV), Switzerland via TGV Lyria to Geneva/Basel/Zürich, Intercités de nuit to the Alps/Pyrenees/Nice |
| **Lille-Europe** | Eurostar, ~1 h 25 | direct TGVs south that skip Paris (Lyon, Marseille, Bordeaux, Nantes, Strasbourg) — the Paris-free option when the transfer is the worry |
| **Brussels-Midi** | Eurostar, ~2 h | ICE to Cologne/Frankfurt (then all Germany via `download.gtfs.de`), Nightjet to Vienna/Innsbruck, European Sleeper to Berlin/Prague, TGV to Strasbourg, whole Belgian network (SNCB feed) |
| **Amsterdam / Rotterdam** | Eurostar, ~4 h / 3 h 15 | Netherlands (NS feed), ICE to Berlin, IC to Copenhagen via Hamburg, Nightjet to Zürich/Innsbruck/Vienna |
| **Hook of Holland** | Harwich ferry, sold as Rail & Sail from any GB station | Rotterdam in 30 min by metro; the cheap, no-Eurostar route to NL/DE |
| **Dublin / Belfast** | Holyhead–Dublin (SailRail from any GB station), Cairnryan–Belfast | Ireland (TFI national feed), Northern Ireland |
| **Santander / Bilbao / Caen / St Malo / Roscoff** | Brittany Ferries from Portsmouth/Plymouth, overnight | Northern Spain and Brittany without crossing Paris; Renfe long-distance feed onward |
| **Edinburgh / Glasgow / Fort William / Inverness** | Caledonian Sleeper from Euston, or LNER/Avanti by day | Scotland — GB feed covers ScotRail and the Highland lines |
| **Penzance** | Night Riviera from Paddington | Cornwall |

Ferries are **not in any GTFS feed** and their sites are bot-walled. seat61
(§0) documents every crossing and the Rail & Sail / SailRail products and how
to buy them; go there before any ferry site, treat sailings like fares
(`browser-research`), record the date read, and prefer the through ticket
because it is what protects a missed connection.

For a **DB / ÖBB / SBB leg**, Transitous gives the structure; `sbb.ch` is the
operator-grade check for the whole German-speaking region, including line
closures and rail-replacement buses. Read
`browser-research/references/central-europe.md` before touching bahn.de.

## §4 — verifying before writing

| Country / operator | Confirm against | Notes |
|---|---|---|
| GB rail | Transitous `--board` (platform, alerts) or the operator's site | Real Time Trains and nationalrail.co.uk are both bot-walled to fetches; the browser is not needed for them |
| Eurostar | timetable page fetch, then the fare search in a browser | `references/eurostar.md` |
| SNCF | fiche horaire PDF, mainline GTFS | `sncf-timetables` |
| NS, SNCB, NSB/Entur, DSB, TFI, CP, Renfe AV/LD, ÖBB, PID, TEC | the national/operator GTFS feed via `gtfs_query.py` | table in `bus-timetables` §1a |
| DB, ÖBB, SBB international | sbb.ch | central-europe reference |
| Trenitalia | trenitalia.com (browser) | feed in Transitous is a community NeTEx conversion |
| Nightjet, European Sleeper | operator booking site (browser) | availability decides, not the timetable |
| Ferries, Caledonian Sleeper | operator site (browser) | sailing/berth availability |

**Always check a control date before reporting a leg as broken.** A 4-change
answer on one Saturday is engineering works; the same answer on a Wednesday
four weeks later is a timetable that no longer exists, and the advice to the
traveller is different. One extra call.

Hand the confirmed legs to `itinerary-authoring` with source and date read;
coordinates for the stops come out of the same reply, so `find-stop` is only
needed for places the planner did not touch.

## Usage policy — read this once

Transitous is run by volunteers for open-source, non-commercial use and asks
consumers to be **light on the routing endpoint**. The script already sends the
required `User-Agent` (application, version, contact), caches every reply for
a day under `~/.cache/transitous`, and spaces calls a second apart. What the
agent has to do:

- **Planning a trip is fine; enumerating the network is not.** Comparing the
  options for one journey — a morning and an evening departure, the Friday and
  the Saturday, the way out and the `--arrive-by` home, a control date — is a
  handful of calls and exactly what the service exists for. Scraping means
  building a dataset: sweeping every hour of every day, every stop pair on a
  route, or scripting a batch to answer questions nobody has asked yet. Do the
  first freely, the second never. `-n` stays small (the default 4 is enough).
- **Bulk questions go to the feed, not the API.** "Every departure this week
  on this line" is a `bus-timetables` question against the operator's GTFS —
  the same data, read locally, with no cost to anyone.
- **Attribution stays in place**: the README links
  `https://transitous.org/sources/`, and results derived from it in any
  published artefact keep that link and OpenStreetMap's.

## Coverage and freshness

The feeds behind the API are listed per country at
`github.com/public-transport/transitous/tree/main/feeds` (`gb.json`,
`fr.json` …); read one when a result looks thin to see whether the operator
is there at all. GB rail comes from a daily conversion of the industry
timetable, so it is current, but it carries no fares and no engineering-works
narrative. Cite results as `transitous.org, read <date>`; it is a working
source, not something the traveller needs in a note.
