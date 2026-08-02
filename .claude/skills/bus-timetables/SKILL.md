---
name: bus-timetables
description: "Use this skill when an itinerary needs bus or coach times — a regional/interurban coach, a village stop, a ski or valley shuttle — or when a bus time already in a file needs auditing. Reads the operator's own GTFS feed (transport.data.gouv.fr in France, mobilitydatabase.org elsewhere) to answer 'does this line run on THIS date, and at what time', which a timetable PDF and a journey planner both struggle with. Covers finding the feed, querying it offline, the seasonality / weekend / short-turn traps, and the four questions GTFS cannot answer."
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

**Use this for buses, coaches, trams and shuttles.** For French *trains* use
`sncf-timetables` — SNCF's fiches horaires are well organised and the rail feeds
are enormous. For a stop's coordinates use `find-stop`. For writing what you
find into a document use `itinerary-authoring`.

---

## Step 1 — find the feed

France publishes every operator's GTFS at the national access point,
`transport.data.gouv.fr`. The dataset list is one JSON file; filter it locally
rather than browsing the site:

```bash
curl -sL https://transport.data.gouv.fr/api/datasets -o /tmp/tdg.json
python3 - <<'EOF'
import json, re
kw = re.compile(r'isere|vercors|zou', re.I)          # network, département or region
for ds in json.load(open('/tmp/tdg.json')):
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

An operator with **no feed on the access point** is a real outcome, not a search
failure — some AOMs publish nothing. That is the point to fall back to the
operator's own planner or PDF, and to record the gap. Outside France, the
equivalent index is `mobilitydatabase.org`.

## Step 2 — download it

```bash
curl -sL -o feed.zip "<resource url>"
unzip -q -x shapes.txt -d feed feed.zip
```

**Always exclude `shapes.txt`** — it is road geometry and is routinely 80–95% of
the archive (110 MB of a 120 MB feed in one real case). Nothing here needs it.

Sanity-check what you got before trusting a single time:

```bash
cat feed/feed_info.txt      # publisher and the feed's own validity window
cut -d, -f1,2 feed/agency.txt   # which operators are actually in here
```

## Step 3 — query it

```bash
.claude/skills/bus-timetables/tools/gtfs_query.py feed --routes 'T7|55'
.claude/skills/bus-timetables/tools/gtfs_query.py feed T75 2026-09-11 45.1917,5.7145 45.0553,6.0300
```

`--routes` takes a regex over the short and long names and is how you find what
a line is called in this feed. The main form takes a line, an ISO date, and
origin/destination as `lat,lng`, and prints the departures that really run.

Origin and destination are **coordinates, not names**, because interurban feeds
name stops locally with no commune: a feed will contain a dozen stops called
`Gare Routière` and one called `Halte Routière`. Stops are matched within
`--km` (default 1); widen it to 2 for a scattered village or a coach stop that
sits outside the centre, and check the stop names in the output are the ones you
meant.

Ask the *actual travel dates*, and ask both directions. Asking a Saturday and a
Sunday separately is worth doing even when you only travel one of them — the
difference tells you how much slack the plan has.

---

## The four traps this closes

1. **Seasonality.** A line that exists all year is not a line that *runs* all
   year. Ski shuttles, summer valley services and school lines are invisible on
   the operator's line page and obvious in the feed: query a July date and a
   September date and compare the trip counts.
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
anything the feed could not answer rather than leaving it silently absent. Then
hand off to `itinerary-authoring` for writing the segment, and `find-stop` if
the stop still needs coordinates.
