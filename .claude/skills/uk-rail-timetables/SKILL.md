---
name: uk-rail-timetables
description: "Use this skill for British train times — a departure from a GB station, the connecting legs either side of a Eurostar, a sleeper or an airport link, or auditing a UK rail time already written into an itinerary. Also covers what a GB ticket costs and why that cannot be looked up automatically. French trains go to sncf-timetables and buses to bus-timetables."
---

# British train times

## Core insight

The France playbook does not transfer. There is no fiche horaire to read and
**no open GB rail feed to query** — the one entry in the MobilityData catalogue
points at the retired `transitfeeds.com`, and the timetable that *would* convert
to GTFS (the RDG "DTD" feed) is itself behind an account. Every route into GB
rail data costs one free registration, so the work is: get one token, then ask
everything through it.

The token buys **Realtime Trains** (`data.rtt.io`), which carries the advertised
timetable and the live running for mainline England, Wales and Scotland. That is
enough for everything an itinerary needs except a price.

Two things are *not* a way in, and trying them wastes a rung:

- **`traintimes.org.uk` refuses automation.** Its `robots.txt` is `Disallow: /`
  for every agent, and query paths answer `418 Unavailable` to anything that is
  not a browser — a user-agent string does not change that. It is an excellent
  site to *send the user to*; it is not a source to fetch.
- **The Huxley 2 community proxy has no Darwin key of its own.** Its `/crs/`
  station lookup answers without one, but `/departures/` returns a bare `500`.
  You supply your own token or you get nothing.

> **Verified August 2026.** RTT's old `api.rtt.io` host is deprecated (shut-down
> 30 September 2026) — the *data* host is `data.rtt.io`, which is not the same
> name as the portal you sign up on.

---

## §1 — The one-time token

Sign up at `https://api-portal.rtt.io` (free, personal, **non-commercial**;
requires an RTT unified login). Ask the user to do this once and put the token
where the tool looks:

```bash
mkdir -p ~/.config/rtt && echo '<token>' > ~/.config/rtt/token   # or $RTT_TOKEN
```

Tokens come in two grades and the portal says which you hold: a **long-life
access token** works as-is, a **refresh token** must be exchanged at
`/api/get_access_token` for one valid until its `validUntil`. `/api/info`
reports your entitlements — worth reading once, because detailed mode, estimated
times and long query windows are all entitlement-gated, and a missing field is
usually a missing entitlement rather than missing data.

Rate limits are **30/minute, 750/hour, 9,000/day**. Every response carries
`X-RateLimit-Remaining-<dimension>`; the tool prints the per-minute one.

## §2 — Station names to CRS codes

Every GB rail API speaks **CRS** — the 3-letter code on the departure screen
(`KGX`, `YRK`, `EDB`) — and none of them will take a name. Resolve it offline:

```bash
STATIONS_CACHE=<scratchpad> .claude/skills/uk-rail-timetables/tools/rail_query.py \
  --crs 'kings cross|york'
```

This reads the **same Trainline CSV `find-stop` caches**, so point
`STATIONS_CACHE` at the session scratchpad and the ~16 MB download is shared
between the two skills. The `atoc_id` column *is* the CRS code, which is why
neither skill needs a station-code list of its own — and it comes with the
coordinates, so a leg researched here needs no second trip to `find-stop`.

The trap is that **a city is not a station**. `London`, `Birmingham`, `Glasgow`
and 109 others are city-group rows whose `atoc_id` is a *number*, not a code;
the tool marks them `CITY GROUP — not a station` and refuses to plan from one,
listing the real stations instead. This matters more in GB than anywhere else,
because which London terminus a journey uses is a routing decision, not a
formatting one — Kings Cross, Euston and Paddington serve different halves of
the country.

## §3 — Asking for times

```bash
rail_query.py KGX YRK 2026-09-15 --from 08:00 --to 11:00
rail_query.py 'kings cross' york 2026-09-15,2026-09-19
rail_query.py EDB KGX 2026-09-15..2026-09-18
```

Origin and destination take a CRS code or a name; dates take a comma-separated
list and `from..to` ranges, as in `bus-timetables`. **Ask for every date in one
invocation** — it is one API call per date against a 30/minute budget, and a
Saturday and a Sunday alongside the travel date are free information about how
much slack the plan has.

The window defaults to 07:00–12:00 and the API caps a single query at 23h59.

## §4 — The four traps this closes

1. **The working timetable is not the public timetable.** Every call carries
   both `scheduleAdvertised` (GBTT — what the passenger is told) and
   `scheduleInternal` (WTT — what the railway runs to). They differ by a minute
   or two at a stop, and at a pass the WTT time is one no display will ever
   show. The tool reports the advertised time and marks
   `[WTT time, not advertised]` when it had to fall back; a time carrying that
   flag should not go into an itinerary without a second source.
2. **A train in the results is not a train that stops.** `filterTo` returns
   services *subsequently calling* at the destination, but the origin entry
   still has to say `displayAs: CALL` — `PASS` means it goes through without
   stopping, and `CANCELLED`/`DIVERTED` mean it no longer serves the place at
   all. This is the GB form of the short-turn error `bus-timetables` chases.
3. **Not everything on the rails carries passengers.** Network Rail data
   includes empty stock moves and light engines; `inPassengerService: false`
   is the filter, and without it an itinerary can be built around a train
   nobody may board. Run with `--all` to see what was dropped and why.
4. **"Trains" that are buses.** `modeType` can be `REPLACEMENT_BUS` — GB does
   engineering work on Sundays and bank holidays as a matter of routine, so a
   weekend leg that looks normal may be a coach taking twice as long. The tool
   never drops these silently; it flags them `** REPLACEMENT_BUS **`. Treat one
   as a reason to re-check the whole day, not just that leg.

A fifth, smaller one: **`204 No Content` is a successful query that found
nothing**, not an error. The tool reports it as "no service found in this
window" — which is a real answer, and usually means the window is wrong rather
than that the line does not exist.

## §5 — Fares: there is no free answer

**No free API quotes a bookable GB fare, and none can sell a ticket.** This is
a licensing fact, not a gap to route around:

- The **DTD fares feed** (RDG, open licence, via the Rail Data Marketplace) is
  the fares *matrix* — which tickets exist, their price, class and restrictions.
  It is a flat-file dump updated three times a year, needs real work to load
  (`dtd2mysql`), and still gives no live availability. Worth it only for a
  project about fares, never for one trip's leg.
- **BR Fares** offers fares APIs, but registration is required (via RDM or
  directly) and the data carries a "Powered by National Rail Enquiries"
  attribution requirement.
- **Selling** a ticket needs an accredited retailer relationship (Trainline
  Partner Solutions or equivalent) — a sales process and RDG accreditation,
  measured in months.

So for an itinerary: quote a fare **with its source and the date you saw it**,
or record none. Advance fares are quota-controlled and change daily, so a price
copied without a date is worse than no price. Getting one means a retailer's own
page, which is a `browser-research` job. Two things worth telling the user
rather than looking up: split-ticketing routinely beats the through fare on GB
long distance, and Advance tickets are release-dated — typically about 12 weeks
out, so "no cheap fares yet" is usually a booking-horizon answer, not a real
one. (Regulated fares are frozen until March 2027.)

## §6 — Live departure boards, on the day

RTT already carries live running, so reach for Darwin only when you want the
official board a station screen shows. It is a **second, separate** registration
at the Rail Data Marketplace (`raildata.org.uk`) — the old National Rail Data
Portal and the self-service OpenLDBWS signup both closed in early 2026, so
legacy tokens still work but cannot be issued any more. Subscribe to "Live
Departure Board Web Service (LDBWS) – Public", then:

```bash
curl -H "x-apikey: $RDM_KEY" \
  'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepBoardWithDetails/KGX'
```

The header is `x-apikey`, not a bearer token, and a missing one produces an
Apigee `FailedToResolveAPIKey` fault rather than a plain 401. Free to 5 million
requests per 4-week railway period; the XML push feeds are free at any volume.

## §7 — What none of this answers

- **Disruption and engineering work beyond the timetable.** The advertised
  timetable already has planned works folded in (that is where the replacement
  buses come from), but strikes, late-notice closures and same-week amendments
  are not reliably in it. For a date more than a few weeks out, say that the
  plan is provisional rather than implying a checked answer.
- **Whether a ticket is valid on a given train.** Routeing and restrictions
  live in the DTD routeing guide, not here.
- **Northern Ireland.** RTT covers England, Wales and Scotland; NI Railways is
  a different system.
- **Eurostar.** Not in GB rail data at all — `browser-research` owns it, and has
  a `references/eurostar.md` for the depth.
- **Seat reservations, bike spaces, sleeper berths.** Operator pages only.

---

## Reporting

Give departures as a table for the dates asked, naming the **operator and the
advertised time**, and flag any row the tool marked WTT-derived or
`REPLACEMENT_BUS`. Say plainly which questions the data could not answer — a
fare, a late-notice change — rather than leaving them silently absent.

Hand times to `itinerary-authoring` to write them into a document; that skill
owns ids, provenance and the validate/bump handoff. Coordinates for a stop came
back with the CRS lookup, so no separate `find-stop` call is needed.
