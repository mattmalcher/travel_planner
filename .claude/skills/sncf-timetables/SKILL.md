---
name: sncf-timetables
description: "Use this skill for French train times — a TER, Intercités or TGV departure, a week-at-a-glance view of a line, or auditing a rail time already written into an itinerary. Buses and coaches go to bus-timetables instead."
---

# Finding French Train Timetables (SNCF)

## Core insight

SNCF Connect is a **booking engine**, not a timetable viewer: it wants a date and
shows only matching journeys. For a line's full schedule use the **fiche horaire
PDF** — the poster displayed at stations, free to download, every train, every
stop, all day-types (weekday / Saturday / Sunday / holiday) on one or two pages.

For a *derived* time — one you interpolated, remembered or computed rather than
read off a page — go to the GTFS feed in §4 instead. That is the check that
catches a departure past the end of service.

> **URLs verified July 2026.** SNCF reorganises these sites periodically; if one
> 404s, fall back to a web search rather than guessing path variants.

---

## §1 — Fiche horaire PDFs (best for full timetables)

The national TER hub always works:
`ter.sncf.com/<region>/se-deplacer/fiches-horaires`. The slug is the
administrative region's full name, hyphenated and unaccented
(`auvergne-rhone-alpes`, `bourgogne-franche-comte`) — with one that will not come
out of a template: **PACA is `sud-provence-alpes-cote-d-azur`**. Île-de-France is
not in the TER system at all; Transilien/RER fiches are at
`transilien.com/fr/les-fiches-horaires`.

Some regions mirror the fiches on their own transport-authority site (Zou! in
PACA, liO in Occitanie, Fluo in Grand Est), each on its own domain — don't
construct those URLs, use the hub.

**`ter.sncf.com` returns 403 to non-browser clients**, so locate the PDF by web
search rather than by fetching the portal: `site:ter-fiches-horaires.sncf.fr
<line>` or `fiche horaire <origin> <destination> filetype:pdf`. The PDF host
itself serves files normally once you have the direct link.

Then: check the **validity dates** printed at the top — editions change roughly
mid-December and early July — and read the **destination column and footnotes**,
which is where short-turn, seasonal, Friday-only and school-holiday variants
live. A train that calls at intermediate stations may terminate short of where
the traveller is going.

The PDF also carries both directions, train numbers, connection notes, and
planned engineering works with their substitution buses (those buses are a
`bus-timetables` job).

## §2 — Station departure boards (next departures, no date needed)

- **TER:** `ter.sncf.com/<region>/se-deplacer/prochains-departs/<station-slug-UIC>`
- **All SNCF:** `garesetconnexions.sncf/en/stations-services/<station>/timetables`

The slug is usually the name lowercased with hyphens; the 8-digit UIC code also
works. A web search for `"SNCF prochains departs" <station name>` resolves
ambiguity fast.

## §3 — "No trains" on SNCF Connect

SNCF Connect opens booking roughly 3–5 months ahead, TER later than TGV, and
after the December timetable change new-season data loads gradually. **Trains
exist that the booking system has not published yet** — this is a booking-horizon
issue, not a cancellation. The fiche horaire covers the full validity window from
day one; if it shows trains and SNCF Connect does not, the user books nearer the
date or at the station.

Aggregator "X trains per day" counts (Omio, Rome2Rio, Trainline) disagree with
each other and with SNCF because they differ on whether short-turn and seasonal
services count. Treat them as ballpark; the fiche is the definitive count.

## §4 — The mainline GTFS feed: auditing a connection

For TGV, Intercités and TER as data, the data.gouv.fr dataset **"Réseau SNCF TGV,
Intercités et TER"** (resource `9ae758ec-cd7a-40cd-a890-bb3963224942`,
republished roughly daily) is read in seconds by `gtfs_query.py` from the
`bus-timetables` skill — a ~400k-row `stop_times.txt`, not a national monster:

```bash
.claude/skills/bus-timetables/tools/gtfs_query.py <resource-url> --routes 'Grenoble'
.claude/skills/bus-timetables/tools/gtfs_query.py <resource-url> 621A 2026-09-11 48.844888,2.37352 45.191493,5.714584
```

Two things specific to this feed:

- **`trips.txt` has no `trip_short_name` — the train number is in
  `trip_headsign`** (e.g. `6920`). That is how a service number gets into a
  segment without a booking engine, and it matches what a booking engine or a
  fiche gives for the same train.
- **There is no `calendar.txt`** — the feed is `calendar_dates.txt`-only, so
  "does it run on this date" is a single `exception_type=1` lookup.

**Audit any mainline time you did not read off a page.** The failure this catches
is not a few minutes out: an evening Paris → Grenoble leg written as 20:13 →
23:13, when the last departure of the day is 18:14 — over an hour past the end of
service, breaking everything downstream. Two habits: **scan every route** for the
origin/destination stop pair before concluding a journey does not exist, and
**check a connecting hub** (Paris → Lyon → Grenoble) before calling it
impossible, noting the last hub departure since that is the real cutoff.

Unlike some regional coach feeds this one is current rather than stale. It
contains **no Eurostar**, so cross-Channel legs go to `browser-research`.

---

Hand times to `itinerary-authoring` to write them into a document; that skill
also owns provenance and the validate/bump handoff.
