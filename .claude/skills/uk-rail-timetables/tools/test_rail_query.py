#!/usr/bin/env python3
"""Fixture tests for rail_query.py: run `./test_rail_query.py`, no token needed.

The API half cannot be exercised without a Realtime Trains token, so the
response handling is tested against fixtures instead — which is where the
traps live (advertised vs working-timetable times, passes, empty stock,
replacement buses).

Shapes come from the RTT OpenAPI spec (realtimetrains/api-specification,
components: NetworkRailLocationLineUpObject / LocationTemporalData /
ScheduleMetadata).
"""
import sys, os, importlib.util
spec = importlib.util.spec_from_file_location(
    'rq', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       'rail_query.py'))
rq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rq)

fails = []


def check(label, got, want):
    if got != want:
        fails.append(f'{label}: got {got!r}, want {want!r}')
        print(f'  FAIL {label}: got {got!r} want {want!r}')
    else:
        print(f'  ok   {label}')


def svc(display='CALL', advertised='2026-09-15T10:03:00',
        internal='2026-09-15T10:01:30', passenger=True, mode='TRAIN',
        cancelled=False, platform='1', operator='London North Eastern Railway'):
    dep = {'realtimeNoReport': False, 'isCancelled': cancelled}
    if advertised:
        dep['scheduleAdvertised'] = advertised
    if internal:
        dep['scheduleInternal'] = internal
    return {
        'temporalData': {'departure': dep, 'displayAs': display,
                         'scheduledCallType': 'CALL'},
        'locationMetadata': {'platform': {'planned': platform, 'actual': None}},
        'scheduleMetadata': {
            'identity': 'L01525', 'trainReportingIdentity': '1L40',
            'departureDate': '2026-09-15', 'modeType': mode,
            'inPassengerService': passenger,
            'operator': {'code': 'GR', 'name': operator}},
        'destination': [{'location': {'description': 'York',
                                      'shortCodes': ['YRK']}}],
    }


print('\n--- the advertised/working-timetable trap ---')
r = rq.describe(svc(), 'KGX', 'YRK')
check('uses advertised (GBTT) time, not WTT', rq.hhmm(r['depart']), '10:03')
check('no fallback flag when advertised present', r['fell_back'], False)

r = rq.describe(svc(advertised=None), 'KGX', 'YRK')
check('falls back to WTT when no advertised', rq.hhmm(r['depart']), '10:01')
check('and flags the fallback', r['fell_back'], True)

print('\n--- what is not a boardable journey ---')
check('PASS is filtered',
      rq.describe(svc(display='PASS'), 'KGX', 'YRK')['skip'] is not None, True)
check('null displayAs treated as PASS',
      rq.describe(svc(display=None), 'KGX', 'YRK')['skip'] is not None, True)
check('CANCELLED display filtered',
      rq.describe(svc(display='CANCELLED'), 'KGX', 'YRK')['skip'] is not None,
      True)
check('empty stock filtered',
      'passenger service' in
      (rq.describe(svc(passenger=False), 'KGX', 'YRK')['skip'] or ''), True)
check('cancelled departure filtered',
      rq.describe(svc(cancelled=True), 'KGX', 'YRK')['skip'], 'cancelled')
check('arrival-only call filtered',
      'no departure time' in
      (rq.describe(svc(advertised=None, internal=None), 'KGX',
                   'YRK')['skip'] or ''), True)

print('\n--- kept, but must be visible ---')
check('TERMINATES is a real call',
      rq.describe(svc(display='TERMINATES'), 'KGX', 'YRK')['skip'], None)
check('STARTS is a real call',
      rq.describe(svc(display='STARTS'), 'KGX', 'YRK')['skip'], None)
r = rq.describe(svc(mode='REPLACEMENT_BUS'), 'KGX', 'YRK')
check('replacement bus is NOT silently dropped', r['skip'], None)
check('replacement bus keeps its mode for display', r['mode'],
      'REPLACEMENT_BUS')

print('\n--- date parsing ---')
check('single date', rq.dates_from('2026-09-15'), ['2026-09-15'])
check('comma list', rq.dates_from('2026-09-15,2026-09-19'),
      ['2026-09-15', '2026-09-19'])
check('range', rq.dates_from('2026-09-15..2026-09-18'),
      ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
for bad, why in [('2026-09-18..2026-09-15', 'backwards range'),
                 ('2026-13-01', 'impossible month'),
                 ('2026-09-01..2026-12-01', 'over the date cap'),
                 ('next-tuesday', 'not ISO')]:
    try:
        rq.dates_from(bad)
        fails.append(f'{why} accepted')
        print(f'  FAIL {why} was accepted')
    except SystemExit:
        print(f'  ok   {why} rejected')

print('\n--- time formatting ---')
check('offset datetime', rq.hhmm('2026-09-15T10:03:00+01:00'), '10:03')
check('Z datetime', rq.hhmm('2026-09-15T10:03:00Z'), '10:03')
check('missing time', rq.hhmm(None), '  —  ')

print('\n--- station resolution ---')
st = [{'name': 'York', 'crs': 'YRK', 'lat': '1', 'lng': '2', 'group': False},
      {'name': 'Yorton', 'crs': 'YRT', 'lat': '1', 'lng': '2',
       'group': False},
      {'name': 'London', 'crs': '182', 'lat': '', 'lng': '', 'group': True},
      {'name': 'London Kings Cross', 'crs': 'KGX', 'lat': '1', 'lng': '2',
       'group': False},
      {'name': 'London Euston', 'crs': 'EUS', 'lat': '1', 'lng': '2',
       'group': False}]
check('exact name beats substring', [s['crs'] for s in rq.resolve('york', st)],
      ['YRK'])
check('CRS code resolves to the station',
      [s['name'] for s in rq.resolve('KGX', st)], ['London Kings Cross'])
check('lowercase CRS works', [s['crs'] for s in rq.resolve('kgx', st)], ['KGX'])
check('city group does not win an exact match',
      sorted(s['crs'] for s in rq.resolve('london', st)),
      ['182', 'EUS', 'KGX'])
check('unknown 3-letter code passes through as a code',
      rq.resolve('ZZZ', st)[0]['crs'], 'ZZZ')
# `a|b` is the documented multi-stop form. Folding strips punctuation, so it
# has to be split off first or the bar becomes a space and demands one name
# containing both — which is how this broke the first time.
check('alternation returns both stations',
      sorted(s['crs'] for s in rq.resolve('york|kings cross', st)),
      ['KGX', 'YRK'])
check('each alternative keeps its own exact match (no Yorton)',
      sorted(s['crs'] for s in rq.resolve('york|euston', st)),
      ['EUS', 'YRK'])
check('an inexact alternative still expands',
      sorted(s['crs'] for s in rq.resolve('york|london', st)),
      ['182', 'EUS', 'KGX', 'YRK'])
check('empty alternative is ignored',
      [s['crs'] for s in rq.resolve('york|', st)], ['YRK'])

print('\n' + ('FAILED: ' + '; '.join(fails) if fails else 'all checks passed'))
sys.exit(1 if fails else 0)
