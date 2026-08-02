#!/usr/bin/env python3
"""Answer "does this bus run on these dates, and at what time" from a GTFS feed.

This is the offline half of what a journey-planner app does. It reads a GTFS
feed (a URL, or an already-unzipped directory) and resolves a line + dates +
an origin/destination pair into actual departures, honouring calendar.txt
*and* calendar_dates.txt exceptions — which is the bit a timetable PDF cannot
tell you.

  ./gtfs_query.py <url> --routes 'T7|55'       # what is this line called in here
  ./gtfs_query.py <url> T75 2026-09-11 45.1917,5.7145 45.0553,6.0300
  ./gtfs_query.py feed T75 2026-09-11,2026-09-13 45.1917,5.7145 45.0553,6.0300
  ./gtfs_query.py feed 55 2026-09-07..2026-09-13 45.19,5.71 45.04,6.30 --km 2

A URL is downloaded once into a cache (~/.cache/gtfs-feeds, or $GTFS_CACHE) and
reused; --refresh re-fetches it. Both directions are reported by default, and
dates take a comma-separated list and `from..to` ranges — because one pass over
stop_times.txt costs the same whether it answers one question or fourteen, and
on a national feed that pass is 40 seconds.

Interurban feeds routinely name a stop "Gare Routière" with no commune, so
origin and destination are given as lat,lng and matched by proximity.
"""
import argparse
import csv
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from collections import defaultdict

DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

KM_PER_DEGREE = 111.32

MAX_DATES = 31

STALE_DAYS = 30


def _clock(value):
    """Sort key and display for a GTFS time. Two traps: the hour is not
    zero-padded in every feed (Luxembourg writes `4:30:00`, which a naive
    slice renders `4:30:` and sorts after `10:00`), and it may be 24 or more
    — the standard's way of saying a trip that left before midnight, which has
    to reach the reader as a next-day time rather than as `25:10`."""
    hour, minute = (int(x) for x in value.split(':')[:2])
    return hour * 60 + minute, f'{hour % 24:02d}:{minute:02d}' + '+1' * (hour >= 24)


def _name(route, key):
    """Both route names are optional in GTFS, and feeds really do omit one:
    Luxembourg's national feed leaves every route_long_name empty."""
    return route.get(key) or ''


def _stream(directory, name):
    """Row generator. trips.txt and stop_times.txt are far too big to hold: the
    Swiss national feed has 1.8M trips, and reading every stop_time into a dict
    peaked at 19 GB. Everything large is filtered as it streams past."""
    path = os.path.join(directory, name)
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8-sig') as fh:
        yield from csv.DictReader(fh)


def _read(directory, name):
    return list(_stream(directory, name))


# --- the feed cache -------------------------------------------------------
#
# A national feed is 200 MB zipped and the freshness of it is a research fact
# in its own right (see SKILL.md), so the cache stores when it was fetched and
# says so on every reuse rather than quietly serving an old edition.

def cache_root():
    root = os.environ.get('GTFS_CACHE')
    if root:
        return root
    base = os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache')
    return os.path.join(base, 'gtfs-feeds')


def _slug(url):
    tail = re.sub(r'[^a-z0-9]+', '-', url.rsplit('/', 2)[-1].lower()).strip('-')[:40]
    return f'{hashlib.sha256(url.encode()).hexdigest()[:12]}-{tail}' if tail \
        else hashlib.sha256(url.encode()).hexdigest()[:12]


def fetch_feed(url, refresh=False):
    """Return a local directory for a feed URL, downloading it at most once."""
    slot = os.path.join(cache_root(), _slug(url))
    directory, meta_path = os.path.join(slot, 'feed'), os.path.join(slot, 'meta.json')
    if os.path.exists(meta_path) and not refresh:
        meta = json.load(open(meta_path))
        age = (datetime.date.today() - datetime.date.fromisoformat(meta['fetched'])).days
        note = f'cached {meta["fetched"]}'
        if age >= STALE_DAYS:
            note += f' — {age} days old; --refresh, or check the operator\'s updated date'
        print(f'feed: {directory} ({note})', file=sys.stderr)
        if meta.get('final_url') != url:
            print(f'      redirected to {meta["final_url"]}', file=sys.stderr)
        return directory

    os.makedirs(slot, exist_ok=True)
    archive = os.path.join(slot, 'feed.zip')
    print(f'fetching {url}', file=sys.stderr)
    with urllib.request.urlopen(url) as response:
        # The Swiss permalink redirects to a dated filename, and that date is
        # the edition — worth keeping, it is the feed's own freshness signal.
        final_url = response.geturl()
        with open(archive, 'wb') as fh:
            while chunk := response.read(1 << 20):
                fh.write(chunk)
        last_modified = response.headers.get('Last-Modified')
    # Extracting over the old edition would leave any file the new one dropped
    # sitting there to be read — a stale calendar_dates.txt is exactly the kind
    # of confident wrong answer this tool exists to avoid.
    shutil.rmtree(directory, ignore_errors=True)
    with zipfile.ZipFile(archive) as zf:
        # shapes.txt is road geometry and is routinely 80–95% of the archive.
        names = [n for n in zf.namelist() if os.path.basename(n) != 'shapes.txt']
        zf.extractall(directory, members=names)
    size = os.path.getsize(archive)
    os.remove(archive)  # 200 MB of it, and the extracted feed is what gets read
    json.dump({'url': url, 'final_url': final_url, 'last_modified': last_modified,
               'fetched': datetime.date.today().isoformat(), 'zip_bytes': size},
              open(meta_path, 'w'), indent=1)
    if final_url != url:
        print(f'      redirected to {final_url}', file=sys.stderr)
    return directory


def resolve_feed(target, refresh=False):
    if re.match(r'https?://', target):
        return fetch_feed(target, refresh)
    if refresh:
        raise SystemExit('--refresh only applies when the feed is given as a URL')
    return target


# --- dates ----------------------------------------------------------------

def parse_dates(text):
    """A comma-separated list, where any element may be an inclusive range."""
    out = []
    for part in text.split(','):
        if '..' in part:
            first, last = (datetime.date.fromisoformat(x) for x in part.split('..', 1))
            if last < first:
                raise SystemExit(f'{part}: range ends before it starts')
            out.extend(first + datetime.timedelta(days=n)
                       for n in range((last - first).days + 1))
        else:
            out.append(datetime.date.fromisoformat(part))
    dates = sorted(set(out))
    if len(dates) > MAX_DATES:
        raise SystemExit(f'{len(dates)} dates asked for, {MAX_DATES} is the limit — '
                         'query the day-types you actually travel, not the season')
    return dates


class Feed:
    def __init__(self, directory):
        self.directory = directory
        self.routes = {r['route_id']: r for r in _read(directory, 'routes.txt')}
        self.stops = {r['stop_id']: r for r in _read(directory, 'stops.txt')}
        self.calendar = {r['service_id']: r for r in _read(directory, 'calendar.txt')}
        self._exceptions = defaultdict(dict)
        self._primed = set()

    def prime_exceptions(self, stamps):
        """Exception rows for a set of dates, in ONE pass. calendar_dates.txt
        runs to 273 MB in the Swiss feed, so it is neither held whole nor read
        once per date — only the days asked about are kept."""
        stamps = set(stamps) - self._primed
        if not stamps:
            return
        for row in _stream(self.directory, 'calendar_dates.txt'):
            if row['date'] in stamps:
                self._exceptions[row['date']][row['service_id']] = row['exception_type']
        self._primed |= stamps

    def runs(self, service_id, date):
        """The whole point: a service's weekday pattern minus its exception days."""
        stamp = date.strftime('%Y%m%d')
        self.prime_exceptions([stamp])
        exception = self._exceptions[stamp].get(service_id)
        if exception == '1':
            return True
        if exception == '2':
            return False
        cal = self.calendar.get(service_id)
        if not cal or not cal['start_date'] <= stamp <= cal['end_date']:
            return False
        return cal[DAYS[date.weekday()]] == '1'

    def near(self, point, km):
        # A degree of longitude shrinks towards the poles, so the scale comes
        # from the point itself: 79 km/deg is right at 45°N and wrong by 40%
        # at Norway's 60°N.
        lng_scale = KM_PER_DEGREE * math.cos(math.radians(point[0]))
        found = set()
        for stop_id, stop in self.stops.items():
            try:
                lat, lng = float(stop['stop_lat']), float(stop['stop_lon'])
            except ValueError:
                continue
            if math.hypot((lat - point[0]) * KM_PER_DEGREE, (lng - point[1]) * lng_scale) <= km:
                found.add(stop_id)
        return found

    def _leg(self, times, starts, ends):
        """The boarding/alighting pair on one trip, or None. The `j > i` test is
        the short-turn check: a trip that leaves the right stop is not a trip
        that reaches the destination, and that is the error a PDF column hides."""
        board = [i for i, t in enumerate(times) if t['stop_id'] in starts]
        alight = [j for j, t in enumerate(times) if t['stop_id'] in ends]
        if not board or not alight:
            return None
        i = min(board)
        later = [j for j in alight if j > i]
        if not later:
            return None
        j = max(later)
        key, dep = _clock(times[i]['departure_time'])
        _, arr = _clock(times[j]['arrival_time'])
        return (key, dep, self.stops[times[i]['stop_id']]['stop_name'],
                arr, self.stops[times[j]['stop_id']]['stop_name'])

    def departures(self, short_name, dates, origin, dest, km=1.0, one_way=False):
        """Every asked-for date and direction from a single pass over the feed."""
        # Matched against either name: a feed that leaves route_short_name
        # empty can only be addressed by its long one.
        route_ids = {k for k, v in self.routes.items()
                     if short_name in (_name(v, 'route_short_name'), _name(v, 'route_long_name'))}
        if not route_ids:
            raise SystemExit(f'no route named {short_name!r} in this feed')
        starts, ends = self.near(origin, km), self.near(dest, km)
        legs = [('outward', starts, ends)] + ([] if one_way else [('return', ends, starts)])

        self.prime_exceptions(d.strftime('%Y%m%d') for d in dates)
        # Narrow to this line's trips that really run on a wanted day *before*
        # touching stop_times, so only a few hundred trips' worth is ever held.
        # Each surviving trip remembers which of the dates it runs on, so the
        # one stop_times pass below answers all of them at once.
        runs_on = {}
        for trip in _stream(self.directory, 'trips.txt'):
            if trip['route_id'] in route_ids:
                days = [d for d in dates if self.runs(trip['service_id'], d)]
                if days:
                    runs_on[trip['trip_id']] = days
        by_trip = defaultdict(list)
        for row in _stream(self.directory, 'stop_times.txt'):
            if row['trip_id'] in runs_on:
                by_trip[row['trip_id']].append(row)

        out = {(date, way): [] for date in dates for way, _, _ in legs}
        for trip_id, times in by_trip.items():
            times.sort(key=lambda r: int(r['stop_sequence']))
            for way, a, b in legs:
                leg = self._leg(times, a, b)
                if leg:
                    for date in runs_on[trip_id]:
                        out[(date, way)].append(leg)
        return {key: sorted(rows) for key, rows in out.items()}, [w for w, _, _ in legs]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('feed', help='GTFS zip URL, or an already-unzipped directory')
    ap.add_argument('line', nargs='?', help='route_short_name, e.g. T75')
    ap.add_argument('date', nargs='?', help='YYYY-MM-DD, comma-separated, or from..to')
    ap.add_argument('origin', nargs='?', help='lat,lng')
    ap.add_argument('dest', nargs='?', help='lat,lng')
    ap.add_argument('--km', type=float, default=1.0, help='stop-match radius (default 1)')
    ap.add_argument('--one-way', action='store_true',
                    help='outward only (the return direction is free, so this is rarely worth it)')
    ap.add_argument('--refresh', action='store_true', help='re-download a cached feed URL')
    ap.add_argument('--routes', metavar='REGEX',
                    help='list routes whose name matches, then exit')
    args = ap.parse_args()

    feed = Feed(resolve_feed(args.feed, args.refresh))
    if args.routes:
        pattern = re.compile(args.routes, re.I)
        for route in sorted(feed.routes.values(), key=lambda r: _name(r, 'route_short_name')):
            short, long = _name(route, 'route_short_name'), _name(route, 'route_long_name')
            if pattern.search(short) or pattern.search(long):
                print(f'  {short:8s} {long}')
        return
    if not all([args.line, args.date, args.origin, args.dest]):
        ap.error('line, date, origin and dest are all required unless --routes is given')

    point = lambda s: tuple(float(x) for x in s.split(','))
    dates = parse_dates(args.date)
    rows, ways = feed.departures(args.line, dates, point(args.origin), point(args.dest),
                                 args.km, args.one_way)
    for date in dates:
        print(f'{args.line} on {date:%a %d %b %Y}')
        for way in ways:
            found = rows[(date, way)]
            print(f'  {way}: {len(found)} departure(s)')
            for _, dep, from_name, arr, to_name in found:
                print(f'    {dep} {from_name} -> {arr} {to_name}')


if __name__ == '__main__':
    main()
