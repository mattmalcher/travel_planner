---
name: bus-timetables
description: "Use this skill when an itinerary needs bus, coach, tram or shuttle times — a regional coach, a village stop, a ski or valley service — or when a bus time already in a file needs auditing. Reads the operator's own GTFS feed to answer 'does this line run on THIS date, and at what time', which a timetable PDF and a journey planner both struggle with. French *trains* go to sncf-timetables instead."
---

# Bus and coach times, from the feed

## Core insight

A timetable PDF (a *fiche horaire* in France) is a **picture** of a timetable:
day-type columns with a centred `S` / `SDF` label over a run of them, footnotes
for seasonal variants, and a validity window you have to notice. Reading one by
hand is how invented and misread times get into an itinerary.

A **GTFS feed is the timetable itself**. Every trip carries a service calendar
plus an explicit list of exception dates, so the question that actually matters
— *does this bus run on Friday 11 September, and what time does it leave* — is a
lookup, not an interpretation. Journey-planner apps (Transit, Moovit, Citymapper)
are GTFS consumers; going to the feed directly gets the same data one step
earlier, works offline, answers a whole week at once, and lets you see how fresh
the data is, which the app hides.

For French *trains* use `sncf-timetables` — SNCF's fiches horaires are well
organised, and it owns the mainline feed. For the *shape* of a journey
(which lines, which changes, roughly when) ask `journey-planner` first: it
reads most of the feeds below through one API call, and this skill is where
you come to confirm a specific line on a specific date, or when it draws a
blank — French departmental buses, in particular, are often missing there.

---

## Step 1 — find the feed

**Try the national access point first, the global catalogue second.** Every EU
state has an access point, but they differ in kind, and that changes the work:
some hand you one feed for the whole country, some make you find the right
operator among hundreds, and some are behind a registration wall.

### 1a — countries with one official national feed

The easiest case, and worth checking before assuming a France-shaped hunt.
Download the URL and skip to Step 2:

URLs verified September 2026; zipped size in brackets so you know what a
download costs. Rail-only feeds are marked — they answer train questions, not
buses.

| Country | Feed |
| --- | --- |
| Switzerland | `https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink` (207 MB) |
| Netherlands | `https://gtfs.ovapi.nl/nl/gtfs-nl.zip` (246 MB) |
| Norway (Entur) | `https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs.zip` |
| Ireland (TFI) | `https://www.transportforireland.ie/transitData/Data/GTFS_All.zip` (185 MB) |
| Denmark | `https://www.rejseplanen.info/labs/GTFS.zip` (53 MB) |
| Germany | `https://download.gtfs.de/germany/free/latest.zip` (284 MB) — an **unofficial** aggregate; the official Mobilithek needs an account |
| Great Britain, bus/coach/tram/ferry | `https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/<region>/` with region `all`, `london`, `south_east`, `south_west`, `east_midlands`, `west_midlands`, `east_anglia`, `yorkshire`, `north_east`, `north_west`, `wales`, `scotland` — no login. Rail is not in it; `journey-planner` covers GB rail. `bustimes.org/api/services/?search=<line or operator>` is a quick way to find which region and operator a rural line belongs to |
| Belgium, rail (SNCB) | `https://sncb-opendata.hafas.de/gtfs/static/c21ac6758dd25af84cca5b707f3cb3de` (26 MB, official, refreshed daily) |
| Belgium, Wallonia bus (TEC) | `https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip` (79 MB); De Lijn and STIB need a key |
| Austria, rail (ÖBB) | `https://static.oebb.at/open-data/soll-fahrplan-gtfs/GTFS_OP_2025_obb.zip` (59 MB, includes Nightjet); the `_2026_` name did not exist yet in September 2026 — check `data.oebb.at` |
| Spain, rail long-distance (Renfe AVE/LD/MD) | `https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip` (0.8 MB); Cercanías is a separate dataset on `data.renfe.com/dataset/horarios-viaje-cercanias` |
| Portugal, rail (CP) | `https://publico.cp.pt/gtfs/gtfs.zip` (0.3 MB) |
| Czechia, Prague region (PID) | `https://data.pid.cz/PID_GTFS.zip` (49 MB) |
| Europe, coach (FlixBus) | `https://gtfs.gis.flix.tech/gtfs_generic_eu.zip` (30 MB) |
| Europe, European Sleeper | `https://jbb.ghsq.de/gtfs/eu-es.gtfs.zip` (community-maintained) |

The Swiss permalink redirects to a dated filename
(`gtfs_fp2026_20260729.zip`) — that date is the freshness signal, the
equivalent of the `updated` field below, so note it from the redirect. Bump the
year in the dataset slug for a later edition.

### 1b — France, and other per-operator access points

France publishes every operator's GTFS at `transport.data.gouv.fr`. The dataset
list is one JSON file; filter it locally rather than browsing the site:

```bash
# 2.5 MB; keep it next to the feed cache so it is fetched once a day, not once a query
tdg=${GTFS_CACHE:-~/.cache/gtfs-feeds}/tdg.json
[ -n "$(find "$tdg" -mtime -1 2>/dev/null)" ] || curl -sL https://transport.data.gouv.fr/api/datasets -o "$tdg"
python3 - "$tdg" <<'EOF'
import json, re, sys
kw = re.compile(r'isere|vercors|zou', re.I)          # network, département or region
for ds in json.load(open(sys.argv[1])):
    if ds['type'] == 'public-transit' and kw.search(ds['title']):
        print(ds['title'], '|', ds['page_url'])
        for r in ds['resources']:
            if r['format'] == 'GTFS':
                print('   ', r['updated'][:10], r['url'])
EOF
```

Reading the results:

- Feeds come in three shapes: a **single network** ("Réseau interurbain -
  Isère (38)"), a **regional aggregate** ("Agrégat des réseaux urbains et
  interurbains d'Auvergne-Rhône-Alpes"), and **seasonal one-offs** ("Navettes
  saisonnières"). Prefer the single network — the aggregate is ~10× larger and,
  crucially, is **not a superset**: check the operator you want is really in its
  `agency.txt` before relying on it.
- **The `updated` date on the resource is the first thing to look at.** A feed
  published before a known timetable change does not contain that change.
- Note the *département* number: interurban networks are organised by
  département, not by city.

Luxembourg works the same way, with the same API shape:
`https://data.public.lu/api/1/datasets/?q=gtfs`.

An operator with **no feed on the access point** is a real outcome, not a search
failure — some AOMs publish nothing. That is the point to fall back to the
operator's own planner or PDF, and to record the gap.

### 1c — anywhere else: the MobilityData catalogue

For a country not above, one CSV indexes the world's feeds and filters exactly
like the France JSON:

```bash
curl -sL https://share.mobilitydata.org/catalogs-csv -o /tmp/mdb.csv
python3 - <<'EOF'
import csv
for r in csv.DictReader(open('/tmp/mdb.csv', encoding='utf-8')):
    if r['location.country_code'] == 'ES' and 'granada' in r['provider'].lower():
        print(r['provider'], '|', r['is_official'], '|', r['urls.direct_download'])
EOF
```

Treat it as a **discovery aid, never an authority**, for two reasons:

- **It rots.** In a 50-entry European sample about 40% of `direct_download`
  URLs were dead — including every `transitfeeds.com` link (that service is
  retired) and all three French ones, which is why 1a and 1b come first.
- **There is no `updated` column**, so the freshness check this skill turns on
  is simply unavailable. Get the date from the operator's own page, or from the
  downloaded feed's `feed_info.txt` and `calendar.txt` window.

Note also `urls.authentication_type`: a non-empty value means the feed needs an
API key, and this is worth reading *before* the download rather than after —
Granada's entry is `is_official`, looks like a plain file URL, and answers
`401 Api Key was not provided`. The `api.mobilitydatabase.org` v1 API likewise
needs a token and returns empty without one; the CSV does not.

**Registration-walled or absent, as of September 2026**: Spain's access point
(`nap.transportes.gob.es`) for anything beyond Renfe, Sweden (Samtrafiken,
key), Hungary (MÁV answers 401), Finland (`finap.fi`), Belgium's
`transportdata.be` and Germany's official Mobilithek all want an account.
**Italy has no national feed** — Trenitalia publishes none; `journey-planner`
carries a community conversion, and regional buses are per-region. When a
country is walled, `journey-planner` may still answer, because the Transitous
maintainers hold the keys.

## Step 2 — download it

**Hand the URL straight to `gtfs_query.py`** — it downloads once, drops
`shapes.txt`, and caches the feed under `~/.cache/gtfs-feeds`
(`$GTFS_CACHE` to move it), so later queries and later sessions reuse it.
**Check the cache before downloading**: `ls ~/.cache/gtfs-feeds` and the
`meta.json` in each slot say which feeds are already here and when they were
fetched. data.gouv URLs are canonicalised so one resource has one slot
whichever spelling of the link you found.

```bash
.agents/skills/bus-timetables/scripts/gtfs_query.py "<resource url>" --routes 'T7|55'
```

Every run prints which directory it used and **when it was fetched**, on stderr;
past 30 days it says so. That date is not bookkeeping — a cached feed is a
frozen edition, and this skill's whole failure mode is a stale feed answering
confidently. Re-fetch with `--refresh` whenever the operator has published since
(the old extraction is deleted first, so nothing survives into the new edition).

`shapes.txt` is dropped because it is road geometry and routinely 80–95% of the
archive (110 MB of a 120 MB feed in one real case). Nothing here needs it. The
tool takes an already-extracted directory just as happily, if you have one.

A national feed is a different size of thing — Switzerland's is 207 MB zipped,
2.5 GB of `stop_times.txt`, 1.8M trips. `gtfs_query.py` streams the large files
rather than loading them, so this costs ~200 MB of RAM, but expect about
40 seconds per *invocation* against a département feed's instant — which is why
Step 3 asks everything at once.

Sanity-check what you got before trusting a single time (the path is the one
printed on stderr):

```bash
cat feed/feed_info.txt      # publisher and the feed's own validity window
cut -d, -f1,2 feed/agency.txt   # which operators are actually in here
```

## Step 3 — query it

```bash
.agents/skills/bus-timetables/scripts/gtfs_query.py feed --routes 'T7|55'
.agents/skills/bus-timetables/scripts/gtfs_query.py feed T75 2026-09-11 45.1917,5.7145 45.0553,6.0300
.agents/skills/bus-timetables/scripts/gtfs_query.py feed T75 2026-09-11..2026-09-13 45.1917,5.7145 45.0553,6.0300
```

`--routes` takes a regex over the short and long names and is how you find what
a line is called in this feed. The main form takes a line, dates, and
origin/destination as `lat,lng`, and prints the departures that really run.

**Ask everything in one invocation.** The date accepts a comma-separated list
and `from..to` ranges (31 days max), and **both directions are reported by
default** (`--one-way` to suppress the return). This is not a convenience: the
cost is one pass over `stop_times.txt`, so a whole week in both directions costs
the same 40 seconds on a national feed that a single Tuesday does — asking
fourteen questions separately costs ten minutes for the same answers.
A line is matched on **either** name, because feeds really do leave one blank:
every `route_long_name` is empty in both the Swiss and Luxembourg feeds, which
makes `--routes` search only the numbers there.

Origin and destination are **coordinates, not names**, because interurban feeds
name stops locally with no commune: a feed will contain a dozen stops called
`Gare Routière` and one called `Halte Routière`. Stops are matched within
`--km` (default 1); widen it to 2 for a scattered village or a coach stop that
sits outside the centre, and check the stop names in the output are the ones you
meant.

In a **national** feed the coordinates are doing even more work, because the
line number is only unique locally: 34 different routes are called `1` in the
Swiss feed. The origin/destination pair is the whole disambiguation, so check
the stop names in the output before believing the times. Note too that national
feeds tend to use GTFS's *extended* route types — bus is `700`, not `3` — if
you go reading `routes.txt` by hand.

Ask the *actual travel dates*, and put a Saturday and a Sunday in the list even
when you only travel one of them — the difference tells you how much slack the
plan has, and it is free.

---

## The four traps this closes

1. **Seasonality.** A line that exists all year is not a line that *runs* all
   year. Ski shuttles, summer valley services and school lines are invisible on
   the operator's line page and obvious in the feed: pass a July date and a
   September date in one query (`2026-07-15,2026-09-15`) and compare the counts.
2. **The weekend is a different network.** Interurban lines are weekday-shaped;
   Sunday can be half the departures. Never read a weekday column and assume.
3. **Short turns.** A trip that leaves the right stop is not a trip that reaches
   your destination. `gtfs_query.py` only reports a trip when the destination
   really comes *after* the origin on that trip, which is the check most easily
   lost when reading a PDF column. This is the single most common error found in
   already-written itineraries.
4. **The expired edition.** French fiches run 1 September – 31 August, so a trip
   planned in August falls just past the one in hand. The feed usually carries
   the next period already.

## What GTFS cannot answer

- **Fares.** `fare_attributes`/`fare_rules` are optional and usually absent.
  Zonal networks price by zones crossed, and that lives only in a tariff
  leaflet. Quote a fare with a source or record none.
- **On-demand (TAD / Flexo) services.** These are often missing entirely, or
  present as a route with no trips (look for `TAD` in the route name). **A feed
  saying nothing about a line is not the feed saying the line does not run** —
  confirm on the operator's planner before concluding either way.
- **Whether a line exists at all.** A line that has moved to another operator's
  network simply is not in this feed. That is a research question.
- **Disruption.** Roadworks, closures and diversions are not in the static feed.
  Check the operator and the commune close to departure.

## Judging whether the feed is telling the truth

The feed is authoritative *when it is current*, and a stale feed does not look
stale — it looks like a confident answer. Two tells, both worth a minute:

- **A calendar that runs far past a known timetable change with no exception
  dates at all.** In one real case a coach feed published in July extended the
  summer pattern — six departures a day at weekends — straight through to
  27 December, with an empty `calendar_dates.txt`, when the operator's own
  September fiche said two a day. The fiche was right.
- **A resource `updated` date earlier than the edition you know about.**

So: cross-check the feed against the operator's current PDF for any leg the plan
actually depends on. When they disagree, the operator's own document for the
exact period wins, and the disagreement is worth writing down — it is also the
reason not to trust a journey-planner app blindly, since the app is showing you
this same feed with the provenance stripped off.

---

## Reporting

Give departures as a table with both directions and the day-types that matter,
say **which feed and which `updated` date** each figure came from, and name
anything the feed could not answer rather than leaving it silently absent.

A feed already downloaded for the times carries coordinates for every stop it
serves, so take them from it rather than sending `find-stop` after them again.
Writing any of it into a document is `itinerary-authoring`'s job.
