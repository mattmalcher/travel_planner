#!/usr/bin/env python3
"""Answer "what time does the train leave, on THIS date" for Great Britain.

GB has no open timetable feed to read offline, so this queries the Realtime
Trains API (https://data.rtt.io) and does the two things that are easy to get
wrong by hand: it resolves a station name to the 3-letter CRS code every GB
rail API insists on, and it reports the *advertised* (public) time rather than
the working timetable time the same response also carries.

  ./rail_query.py --crs 'kings cross|york'          # name -> CRS + coordinates
  ./rail_query.py KGX YRK 2026-09-15
  ./rail_query.py 'kings cross' york 2026-09-15 --from 08:00 --to 11:00
  ./rail_query.py KGX YRK 2026-09-15,2026-09-19    # several dates, one run

--crs needs no token and no network once the station database is cached; it
reads the same Trainline CSV the find-stop skill uses, so point STATIONS_CACHE
at the session scratchpad and both skills share one download.

Everything else needs a Realtime Trains token in $RTT_TOKEN or
~/.config/rtt/token (free, personal, non-commercial: https://api-portal.rtt.io).
Rate limits are 30/minute, so ask for several dates in one invocation rather
than one run per date.

Services are filtered to those that really carry passengers and really stop at
both ends; --all shows what was filtered out and why.
"""
import argparse
import csv
import datetime
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = 'https://data.rtt.io'

STATIONS_URL = ('https://raw.githubusercontent.com/trainline-eu/stations/'
                'master/stations.csv')

# stations.csv columns, 0-based, semicolon-delimited and unquoted.
C_NAME, C_LAT, C_LNG, C_PARENT, C_COUNTRY = 1, 5, 6, 7, 9
C_SUGGESTABLE, C_ATOC = 14, 46

MAX_DATES = 14

# A location line-up entry is only a real, boardable call if it says so twice:
# the service must be in passenger service, and the stop must display as a CALL
# (or an altered STARTS/TERMINATES) rather than a PASS or a cancellation.
CALLING = {'CALL', 'STARTS', 'TERMINATES'}


def _fold(text):
    """Accent- and case-insensitive form, so `kings cross` matches
    `King's Cross` and `st pancras` matches `St. Pancras`. Punctuation goes
    too: the database writes `London St Pancras International` but a user
    types `st. pancras`."""
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def stations_path():
    cache = os.environ.get('STATIONS_CACHE') or os.path.expanduser(
        '~/.cache/trainline-stations')
    os.makedirs(cache, exist_ok=True)
    return os.path.join(cache, 'stations.csv')


def load_stations():
    """GB rows of the Trainline database that carry a CRS code.

    For a real station `atoc_id` *is* the CRS code — the same 3 letters
    Realtime Trains, Darwin and every departure screen use — which is why this
    skill needs no station-code list of its own. 2,645 GB rows carry one and
    they are unique.

    The other 112 GB rows are city groups (`London`, `Birmingham`, `Glasgow`)
    and their `atoc_id` is a *number*, not a code — which is the tell, and a
    sturdier one than looking for rows that parent another row, since not every
    city row does. A number here is not a station a train calls at, so it is
    kept only to answer "London is a city, did you mean one of these"."""
    path = stations_path()
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print(f'fetching stations.csv into {os.path.dirname(path)} '
              '(~16 MB, once)', file=sys.stderr)
        urllib.request.urlretrieve(STATIONS_URL, path)

    out = []
    with open(path, encoding='utf-8', newline='') as handle:
        for r in csv.reader(handle, delimiter=';'):
            if len(r) <= C_ATOC or r[C_COUNTRY] != 'GB' or not r[C_ATOC]:
                continue
            if r[C_SUGGESTABLE] != 't':
                continue
            out.append({'name': r[C_NAME], 'crs': r[C_ATOC].upper(),
                        'lat': r[C_LAT], 'lng': r[C_LNG],
                        'group': not re.fullmatch(r'[A-Za-z]{3}', r[C_ATOC])})
    return out


def resolve(term, stations):
    """A CRS code, or a name to look one up. Exact-name matches beat substring
    ones so that `York` does not lose to `Yorton`, and a bare 3-letter word is
    treated as a code first — which is the whole point of asking for one."""
    if re.fullmatch(r'[A-Za-z]{3}', term):
        code = term.upper()
        for s in stations:
            if s['crs'] == code:
                return [s]
        return [{'name': code, 'crs': code, 'lat': '', 'lng': '',
                 'group': False}]

    # `a|b` looks up several stops at once, as in find-stop. Alternatives are
    # split *before* folding, because folding strips punctuation and would
    # otherwise turn the bar into a space and quietly demand one name
    # containing all of them.
    alts = [_fold(a) for a in term.split('|') if _fold(a)]
    if not alts:
        return []
    pattern = re.compile('|'.join(a.replace(' ', '.*') for a in alts))
    hits = [s for s in stations if pattern.search(_fold(s['name']))]
    # An exact hit wins so `york` does not lose to `Yorton` — but only a real
    # station may win that way, or `london` would resolve to the London city
    # group and quietly answer for a place no train calls at. With several
    # alternatives, each one keeps its own exact hit.
    exact = [s for s in hits if not s['group'] and _fold(s['name']) in alts]
    if not exact:
        return hits

    # An alternative that found its exact station keeps only that station; one
    # that did not keeps everything it matched. So `york|birmingham` gives York
    # without Yorton, alongside all four Birmingham stations.
    settled = [a for a in alts if any(_fold(s['name']) == a for s in exact)]

    def covered(station):
        name = _fold(station['name'])
        return any(re.search(a.replace(' ', '.*'), name) for a in settled)

    return exact + [s for s in hits if s not in exact and not covered(s)]


def one_station(term, stations, role):
    hits = resolve(term, stations)
    if not hits:
        sys.exit(f'no GB station matches {term!r} — try --crs to search')
    real = [s for s in hits if not s['group']]
    if not real:
        sys.exit(f'{term!r} matches only a city group, not a station — '
                 'search with --crs and name a station')
    if len(real) > 1:
        lines = '\n'.join(f'  {s["crs"]}  {s["name"]}'
                          for s in sorted(real, key=lambda s: s['name'])[:12])
        more = f'\n  ... and {len(real) - 12} more' if len(real) > 12 else ''
        sys.exit(f'{term!r} ({role}) matches {len(real)} stations — name one '
                 f'by its CRS code:\n{lines}{more}')
    return real[0]


def token():
    value = os.environ.get('RTT_TOKEN')
    if not value:
        path = os.path.expanduser('~/.config/rtt/token')
        if os.path.exists(path):
            with open(path) as handle:
                value = handle.read().strip()
    if not value:
        sys.exit('no Realtime Trains token: set $RTT_TOKEN or write it to '
                 '~/.config/rtt/token (free personal signup at '
                 'https://api-portal.rtt.io)')
    return value


def call(path, params, bearer):
    url = f'{API}{path}?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {bearer}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            remaining = response.headers.get('X-RateLimit-Remaining-Minute')
            if remaining is not None:
                print(f'      {remaining} requests left this minute',
                      file=sys.stderr)
            # 204 is a *successful* query that found nothing — an empty body,
            # not an error, and the one status a naive client reads as failure.
            if response.status == 204:
                return None
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            sys.exit('Realtime Trains rejected the token (401). Check '
                     '$RTT_TOKEN, and that it is a token for data.rtt.io '
                     'rather than the retired api.rtt.io.')
        if error.code == 429:
            wait = error.headers.get('Retry-After', '?')
            sys.exit(f'rate limited (429) — retry in {wait}s. Ask for several '
                     'dates in one run rather than one run per date.')
        if error.code == 400:
            sys.exit(f'Realtime Trains rejected the query (400): {url}')
        raise


def timing(entry):
    """The advertised (public) time, and whether we had to fall back.

    `scheduleAdvertised` is the GBTT time — what a passenger is told and what
    belongs in an itinerary. `scheduleInternal` is the working timetable time,
    which for a passenger stop can differ by a minute or two and at a pass is
    a time no display will ever show. Falling back to it is flagged rather
    than silent."""
    if not entry:
        return None, False
    public = entry.get('scheduleAdvertised')
    if public:
        return public, False
    return entry.get('scheduleInternal'), True


def hhmm(stamp):
    if not stamp:
        return '  —  '
    try:
        return datetime.datetime.fromisoformat(stamp).strftime('%H:%M')
    except ValueError:
        return stamp[11:16] or stamp


def describe(service, origin_crs, dest_crs):
    """Flatten one line-up entry, or explain why it is not a usable journey."""
    meta = service.get('scheduleMetadata') or {}
    temporal = service.get('temporalData') or {}
    depart, fell_back = timing(temporal.get('departure'))
    display = temporal.get('displayAs')
    mode = meta.get('modeType') or 'TRAIN'

    row = {
        'depart': depart,
        'fell_back': fell_back,
        'platform': ((service.get('locationMetadata') or {}).get('platform')
                     or {}).get('planned') or '',
        'operator': ((meta.get('operator') or {}).get('name') or ''),
        'identity': meta.get('identity') or '',
        'headcode': meta.get('trainReportingIdentity') or '',
        'mode': mode,
        'dest': ', '.join(
            (d.get('location') or {}).get('description') or ''
            for d in service.get('destination') or []) or dest_crs,
        'cancelled': bool((temporal.get('departure') or {}).get('isCancelled')),
        'display': display,
    }

    if not meta.get('inPassengerService', True):
        row['skip'] = 'not in passenger service (empty stock)'
    elif display not in CALLING:
        row['skip'] = f'does not call here (displayAs={display or "PASS"})'
    elif row['cancelled']:
        row['skip'] = 'cancelled'
    elif not depart:
        row['skip'] = 'no departure time (arrival-only call)'
    else:
        row['skip'] = None
    return row


def query_day(origin, dest, day, start, end, bearer):
    params = {
        'code': origin['crs'],
        'filterTo': dest['crs'],
        'timeFrom': f'{day}T{start}:00',
        'timeTo': f'{day}T{end}:00',
    }
    payload = call('/gb-nr/location', params, bearer)
    if payload is None:
        return []
    return [describe(s, origin['crs'], dest['crs'])
            for s in payload.get('services') or []]


def dates_from(spec):
    """A comma-separated list and `from..to` ranges, the same shapes
    gtfs_query.py takes — one invocation per question, not per date."""
    def day(text):
        try:
            return datetime.date.fromisoformat(text)
        except ValueError:
            sys.exit(f'{text!r} is not a date — this takes YYYY-MM-DD, not '
                     'words like "tomorrow", because a timetable answer has '
                     'to name the day it is about')

    out = []
    for part in spec.split(','):
        if '..' in part:
            first, last = (day(p) for p in part.split('..', 1))
            if last < first:
                sys.exit(f'{part}: range ends before it starts')
            while first <= last:
                out.append(first.isoformat())
                first += datetime.timedelta(days=1)
        else:
            out.append(day(part).isoformat())
    if len(out) > MAX_DATES:
        sys.exit(f'{len(out)} dates is over the {MAX_DATES} limit — that is '
                 'one API call each, against a 30/minute budget')
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('origin', nargs='?', help='CRS code or station name')
    ap.add_argument('dest', nargs='?', help='CRS code or station name')
    ap.add_argument('date', nargs='?',
                    help='YYYY-MM-DD, comma-separated, or from..to')
    ap.add_argument('--from', dest='start', default='07:00',
                    help='window start, HH:MM (default 07:00)')
    ap.add_argument('--to', dest='end', default='12:00',
                    help='window end, HH:MM (default 12:00)')
    ap.add_argument('--crs', metavar='REGEX',
                    help='resolve station names to CRS codes and exit')
    ap.add_argument('--all', action='store_true',
                    help='also show services filtered out, and why')
    args = ap.parse_args()

    stations = load_stations()

    if args.crs:
        hits = resolve(args.crs, stations)
        if not hits:
            sys.exit('no match — this database holds GB stations with a CRS '
                     'code only; for bus stops and piers use find-stop')
        for s in sorted(hits, key=lambda s: (s['group'], s['name'])):
            if s['group']:
                print(f'{"---":4} {s["name"]:<44} '
                      f'{"":>10} {"":>11}  CITY GROUP — not a station')
            else:
                print(f'{s["crs"]:4} {s["name"]:<44} {s["lat"]:>10} '
                      f'{s["lng"]:>11}')
        print(f'\n{len(hits)} match(es).', file=sys.stderr)
        return

    if not (args.origin and args.dest and args.date):
        ap.error('origin, dest and date are required (or use --crs)')

    origin = one_station(args.origin, stations, 'origin')
    dest = one_station(args.dest, stations, 'destination')
    days = dates_from(args.date)
    bearer = token()

    print(f'{origin["name"]} ({origin["crs"]}) -> {dest["name"]} '
          f'({dest["crs"]}), {args.start}-{args.end}', file=sys.stderr)

    for day in days:
        rows = query_day(origin, dest, day, args.start, args.end, bearer)
        shown = [r for r in rows if not r['skip']]
        weekday = datetime.date.fromisoformat(day).strftime('%a')
        print(f'\n{day} ({weekday})  {len(shown)} departure(s) '
              f'{origin["crs"]} -> {dest["crs"]}')
        if not rows:
            print('  none — no service found in this window')
        for r in shown:
            flag = ' [WTT time, not advertised]' if r['fell_back'] else ''
            mode = '' if r['mode'] == 'TRAIN' else f'  ** {r["mode"]} **'
            plat = f'plat {r["platform"]}' if r['platform'] else ''
            print(f'  {hhmm(r["depart"])}  {r["operator"][:28]:<28} '
                  f'{r["headcode"]:<5} {plat:<8} -> {r["dest"][:30]}'
                  f'{mode}{flag}')
        if args.all:
            for r in rows:
                if r['skip']:
                    print(f'  {hhmm(r["depart"])}  skipped: {r["skip"]}')

    print('\nTimes are the advertised (public) timetable from Realtime Trains. '
          'Check a fare and book separately — no free API quotes GB fares.',
          file=sys.stderr)


if __name__ == '__main__':
    main()
