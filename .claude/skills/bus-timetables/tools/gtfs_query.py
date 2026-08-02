#!/usr/bin/env python3
"""Answer "does this bus run on this date, and at what time" from a GTFS feed.

This is the offline half of what a journey-planner app does. It reads an
unzipped GTFS directory (shapes.txt not needed) and resolves a line + a date +
an origin/destination pair into actual departures, honouring calendar.txt
*and* calendar_dates.txt exceptions — which is the bit a timetable PDF cannot
tell you.

  curl -sL -o feed.zip <resource url>          # see SKILL.md for finding one
  unzip -q -x shapes.txt -d feed feed.zip      # shapes.txt is road geometry, skip it

  ./gtfs_query.py feed --routes 'T7|55'        # what is this line called in here
  ./gtfs_query.py feed T75 2026-09-11 45.1917,5.7145 45.0553,6.0300
  ./gtfs_query.py feed 55 2026-09-11 45.1917,5.7145 45.0455,6.3055 --km 2

Interurban feeds routinely name a stop "Gare Routière" with no commune, so
origin and destination are given as lat,lng and matched by proximity.
"""
import argparse
import csv
import datetime
import math
import os
import re
from collections import defaultdict

DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def _read(directory, name):
    path = os.path.join(directory, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8-sig') as fh:
        return list(csv.DictReader(fh))


class Feed:
    def __init__(self, directory):
        self.routes = {r['route_id']: r for r in _read(directory, 'routes.txt')}
        self.stops = {r['stop_id']: r for r in _read(directory, 'stops.txt')}
        self.trips = _read(directory, 'trips.txt')
        self.calendar = {r['service_id']: r for r in _read(directory, 'calendar.txt')}
        self.exceptions = defaultdict(dict)
        for row in _read(directory, 'calendar_dates.txt'):
            self.exceptions[row['service_id']][row['date']] = row['exception_type']
        self.stop_times = defaultdict(list)
        for row in _read(directory, 'stop_times.txt'):
            self.stop_times[row['trip_id']].append(row)
        for rows in self.stop_times.values():
            rows.sort(key=lambda r: int(r['stop_sequence']))

    def runs(self, service_id, date):
        """The whole point: a service's weekday pattern minus its exception days."""
        stamp = date.strftime('%Y%m%d')
        exception = self.exceptions.get(service_id, {}).get(stamp)
        if exception == '1':
            return True
        if exception == '2':
            return False
        cal = self.calendar.get(service_id)
        if not cal or not cal['start_date'] <= stamp <= cal['end_date']:
            return False
        return cal[DAYS[date.weekday()]] == '1'

    def near(self, point, km):
        found = set()
        for stop_id, stop in self.stops.items():
            try:
                lat, lng = float(stop['stop_lat']), float(stop['stop_lon'])
            except ValueError:
                continue
            if math.hypot((lat - point[0]) * 111, (lng - point[1]) * 79) <= km:
                found.add(stop_id)
        return found

    def departures(self, short_name, date, origin, dest, km=1.0):
        route_ids = {k for k, v in self.routes.items() if v['route_short_name'] == short_name}
        if not route_ids:
            raise SystemExit(f'no route named {short_name!r} in this feed')
        starts, ends = self.near(origin, km), self.near(dest, km)
        out = []
        for trip in self.trips:
            if trip['route_id'] not in route_ids or not self.runs(trip['service_id'], date):
                continue
            times = self.stop_times[trip['trip_id']]
            board = [i for i, t in enumerate(times) if t['stop_id'] in starts]
            alight = [i for i, t in enumerate(times) if t['stop_id'] in ends]
            if not board or not alight:
                continue
            i = min(board)
            later = [j for j in alight if j > i]
            if not later:
                continue  # the short-turn case: this trip does not reach the destination
            j = max(later)
            out.append((times[i]['departure_time'][:5], self.stops[times[i]['stop_id']]['stop_name'],
                        times[j]['arrival_time'][:5], self.stops[times[j]['stop_id']]['stop_name']))
        return sorted(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('feed', help='unzipped GTFS directory')
    ap.add_argument('line', nargs='?', help='route_short_name, e.g. T75')
    ap.add_argument('date', nargs='?', help='YYYY-MM-DD')
    ap.add_argument('origin', nargs='?', help='lat,lng')
    ap.add_argument('dest', nargs='?', help='lat,lng')
    ap.add_argument('--km', type=float, default=1.0, help='stop-match radius (default 1)')
    ap.add_argument('--routes', metavar='REGEX',
                    help='list routes whose name matches, then exit')
    args = ap.parse_args()

    feed = Feed(args.feed)
    if args.routes:
        pattern = re.compile(args.routes, re.I)
        for route in sorted(feed.routes.values(), key=lambda r: r['route_short_name']):
            if pattern.search(route['route_short_name']) or pattern.search(route['route_long_name']):
                print(f"  {route['route_short_name']:8s} {route['route_long_name']}")
        return
    if not all([args.line, args.date, args.origin, args.dest]):
        ap.error('line, date, origin and dest are all required unless --routes is given')

    point = lambda s: tuple(float(x) for x in s.split(','))
    date = datetime.date.fromisoformat(args.date)
    rows = feed.departures(args.line, date, point(args.origin), point(args.dest), args.km)
    print(f'{args.line} on {date:%a %d %b %Y}: {len(rows)} departure(s)')
    for dep, from_name, arr, to_name in rows:
        print(f'  {dep} {from_name} -> {arr} {to_name}')


if __name__ == '__main__':
    main()
