#!/usr/bin/env python3
"""Ask Transitous (a keyless, Europe-wide GTFS journey planner) for a journey,
and print it small enough to read.

  ./plan.py "London St Pancras" "Grenoble" 2026-09-25T08:00
  ./plan.py 51.5308,-0.1238 45.1916,5.7145 2026-09-25T08:00 -n 5
  ./plan.py --arrive-by "Paris Gare de Lyon" "Nice Ville" 2026-09-25T18:00
  ./plan.py --board "London Kings Cross" 2026-09-25T07:00
  ./plan.py --geocode "Wörgl"

Places are either lat,lng or a name, which is geocoded through the same API
(first STOP match wins; --geocode shows what it would pick). Times are local
to the origin. A raw response is 150-500 KB of JSON; this prints only the
legs, with the train number, operator and platform where the feed has them,
because that is what an itinerary segment needs. --json dumps the raw reply
to a file instead, for the rare case where more is wanted.

Replies are cached under ~/.cache/transitous for a day and calls are spaced a
second apart, because the API is run by volunteers who ask consumers to be
light on routing. Attribution: https://transitous.org/sources/
"""
import argparse
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

API = 'https://api.transitous.org/api/v1'

# Transitous is a volunteer service (https://transitous.org/sources/). Its
# usage policy asks every request to identify the application, its version and
# a way of contact, and to be light on the routing endpoint. Hence the
# User-Agent, the day-long local cache and the pause between calls below.
UA = 'travel-planner-skills/1.0 (+https://github.com/mattmalcher/travel_planner)'
CACHE_HOURS = 24
PAUSE_SECONDS = 1.0
_last_call = 0.0


def cache_dir():
    base = os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache')
    path = os.path.join(base, 'transitous')
    os.makedirs(path, exist_ok=True)
    return path


def get(path, **params):
    """One request, cached for a day: re-running the same question in the same
    or a later session must not cost the volunteers a second routing."""
    global _last_call
    query = urllib.parse.urlencode(sorted((k, v) for k, v in params.items() if v is not None))
    url = f'{API}/{path}?{query}'
    slot = os.path.join(cache_dir(), hashlib.sha256(url.encode()).hexdigest()[:24] + '.json')
    if os.path.exists(slot) and time.time() - os.path.getmtime(slot) < CACHE_HOURS * 3600:
        with open(slot) as fh:
            return json.load(fh)
    wait = PAUSE_SECONDS - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as response:
        data = json.load(response)
    _last_call = time.time()
    with open(slot, 'w') as fh:
        json.dump(data, fh)
    return data


def geocode(text):
    """Stops first, places second — a station name should resolve to the
    platform group, not the pub named after it."""
    hits = get('geocode', text=text)
    stops = [h for h in hits if h.get('type') == 'STOP']
    return stops + [h for h in hits if h.get('type') != 'STOP']


def resolve(text, want_stop=False):
    """A name becomes coordinates, not a stop id: the geocoder ranks
    'Edinburgh Waverley' as the Waverley Bridge bus stop, and planning from
    that stop's id would never find a train, whereas planning from its
    coordinates walks 200 m to the station. Only a departure board needs the
    stop itself."""
    if ',' in text and text.replace(',', '').replace('.', '').replace('-', '').isdigit():
        return text, None
    hits = geocode(text)
    if not hits:
        raise SystemExit(f'{text!r}: nothing found — try lat,lng, or --geocode to see candidates')
    hit = hits[0]
    print(f'{text!r} -> {hit["name"]} ({hit.get("type")}, {hit["lat"]:.5f},{hit["lon"]:.5f})',
          file=sys.stderr)
    return (hit['id'] if want_stop else f'{hit["lat"]},{hit["lon"]}'), hit


def local(iso, tz):
    """The API speaks UTC; a traveller reads platform clocks."""
    stamp = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    if tz:
        stamp = stamp.astimezone(ZoneInfo(tz))
    return stamp


def to_utc(text, tz):
    naive = datetime.datetime.fromisoformat(text)
    if naive.tzinfo is None:
        naive = naive.replace(tzinfo=ZoneInfo(tz) if tz else datetime.timezone.utc)
    return naive.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def origin_tz(hit, fallback='Europe/London'):
    return (hit or {}).get('tz') or fallback


def describe(leg, tz):
    start, end = local(leg['startTime'], tz), local(leg['endTime'], tz)
    mode = leg.get('mode', '')
    if mode == 'WALK':
        mins = round((end - start).total_seconds() / 60)
        return f'    walk {mins} min' if mins > 2 else None
    line = leg.get('routeShortName') or leg.get('routeLongName') or mode.lower()
    trip = leg.get('tripShortName') or ''
    if trip and trip not in line:
        line = f'{line} {trip}'
    agency = leg.get('agencyName') or ''
    head = leg.get('headsign') or ''
    src, dst = leg.get('from', {}), leg.get('to', {})
    plat = lambda p: f' pl.{p["scheduledTrack"]}' if p.get('scheduledTrack') else ''
    line_out = (f'    {start:%H:%M}{plat(src)} {src.get("name")} -> '
                f'{end:%H:%M}{plat(dst)} {dst.get("name")}  '
                f'{line}  [{agency}]' + (f' to {head}' if head else ''))
    stops = leg.get('intermediateStops')
    if stops is not None:
        line_out += f'  ({len(stops)} intermediate stops)'
    return line_out


def show(itin, tz, index):
    start, end = local(itin['startTime'], tz), local(itin['endTime'], tz)
    day = '' if start.date() == end.date() else f' (+{(end.date() - start.date()).days}d)'
    print(f'{index}. {start:%a %d %b %H:%M} -> {end:%H:%M}{day}, '
          f'{itin["duration"] // 60} min, {itin["transfers"]} change(s)')
    for leg in itin.get('legs', []):
        text = describe(leg, tz)
        if text:
            print(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('args', nargs='+', metavar='FROM TO TIME',
                    help='places as a name or lat,lng; time as YYYY-MM-DDTHH:MM, local to the origin')
    ap.add_argument('-n', type=int, default=4, help='itineraries to ask for (default 4)')
    ap.add_argument('--arrive-by', action='store_true', help='treat the time as latest arrival')
    ap.add_argument('--max-transfers', type=int)
    ap.add_argument('--direct', action='store_true', help='shorthand for --max-transfers 0')
    ap.add_argument('--board', action='store_true',
                    help='departure board: one place and a time, no destination')
    ap.add_argument('--geocode', action='store_true', help='show what a name resolves to')
    ap.add_argument('--json', metavar='FILE', help='also save the raw reply here')
    args = ap.parse_args()
    # Positionals are places followed by a time, except for --geocode.
    args.places, args.time = (args.args, None) if args.geocode else (args.args[:-1], args.args[-1])

    if args.geocode:
        for text in args.places:
            for hit in geocode(text)[:8]:
                print(f'{hit.get("type", ""):6s} {hit["name"]:40s} {hit["lat"]:.5f},{hit["lon"]:.5f}'
                      f'  {hit.get("id", "")}')
        return

    if args.board:
        if len(args.places) != 1 or not args.time:
            ap.error('--board takes one place and a time')
        place, hit = resolve(args.places[0], want_stop=True)
        if not hit or hit.get('type') != 'STOP':
            ap.error('--board needs a stop name; use --geocode to find one')
        tz = origin_tz(hit)
        data = get('stoptimes', stopId=place, n=args.n * 5, time=to_utc(args.time, tz))
        if args.json:
            json.dump(data, open(args.json, 'w'))
        for row in data.get('stopTimes', []):
            when = local(row['place'].get('departure') or row['place'].get('arrival'), tz)
            plat = row['place'].get('scheduledTrack') or ''
            line = row.get('routeShortName') or row.get('tripShortName') or row.get('mode', '')
            trip = row.get('tripShortName') or ''
            if trip and trip not in line:
                line = f'{line} {trip}'
            print(f'{when:%H:%M} pl.{plat:3s} {line:16s} {row.get("headsign", ""):30s} '
                  f'[{row.get("agencyName", "")}]')
        return

    if len(args.places) != 2 or not args.time:
        ap.error('need: FROM TO TIME (or --board / --geocode)')
    src, src_hit = resolve(args.places[0])
    dst, _ = resolve(args.places[1])
    tz = origin_tz(src_hit)
    # maxTransfers=0 returns nothing at all (checked 2026-09-17), so a direct
    # search asks for one and keeps the through trains itself.
    limit = 1 if args.direct else args.max_transfers
    data = get('plan', fromPlace=src, toPlace=dst, time=to_utc(args.time, tz),
               arriveBy='true' if args.arrive_by else None,
               numItineraries=args.n, maxTransfers=limit)
    if args.direct:
        data['itineraries'] = [i for i in data.get('itineraries', []) if i['transfers'] == 0]
    if args.json:
        json.dump(data, open(args.json, 'w'))
        print(f'raw reply saved to {args.json}', file=sys.stderr)
    itineraries = data.get('itineraries', [])
    if not itineraries:
        print('no itineraries — see SKILL.md: a gap in Transitous is common for regional '
              'buses and some cross-border trains, and is not proof the journey does not exist')
        return
    for i, itin in enumerate(itineraries, 1):
        show(itin, tz, i)
    print(f'\nsource: transitous.org, read {datetime.date.today()}; times are local to the origin. '
          'Confirm any leg you write into a document against the operator.')


if __name__ == '__main__':
    main()
