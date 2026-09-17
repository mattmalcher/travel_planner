import datetime
import os
import tempfile
import unittest

from _load import load

g = load('bus-timetables', 'gtfs_query.py')

# A two-trip line: trip A runs the full route on weekdays, trip B is a
# weekday short turn that stops at 'mid', and a Sunday exception adds trip A
# on one Sunday and removes it on one Friday.
FEED = {
    'routes.txt': 'route_id,route_short_name,route_long_name\nr1,T75,Town - Village\nr2,,Only long name\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n'
                 'a,Gare Routière,45.1900,5.7100\nm,Mid,45.1000,5.9000\nz,Bourg,45.0550,6.0300\n'
                 'bad,No coords,,\n',
    'trips.txt': 'route_id,service_id,trip_id\nr1,wk,A\nr1,wk,B\nr2,wk,C\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
                      'A,8:00:00,8:00:00,a,1\nA,09:00:00,09:00:00,m,2\nA,10:05:00,10:05:00,z,3\n'
                      'B,12:00:00,12:00:00,a,1\nB,13:00:00,13:00:00,m,2\n'
                      'C,25:10:00,25:10:00,z,1\nC,26:00:00,26:00:00,a,2\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
                    'wk,1,1,1,1,1,0,0,20260901,20261231\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nwk,20260913,1\nwk,20260911,2\n',
}


class Clock(unittest.TestCase):
    def test_unpadded_hour_sorts_and_prints_correctly(self):
        self.assertEqual(g._clock('4:30:00'), (270, '04:30'))
        self.assertLess(g._clock('4:30:00')[0], g._clock('10:00:00')[0])

    def test_after_midnight_is_next_day(self):
        self.assertEqual(g._clock('25:10:00'), (1510, '01:10+1'))


class Dates(unittest.TestCase):
    def test_list_and_range_are_merged_and_sorted(self):
        got = g.parse_dates('2026-09-13,2026-09-11..2026-09-12,2026-09-11')
        self.assertEqual([d.isoformat() for d in got], ['2026-09-11', '2026-09-12', '2026-09-13'])

    def test_range_cap(self):
        with self.assertRaises(SystemExit):
            g.parse_dates('2026-09-01..2026-10-15')

    def test_backwards_range(self):
        with self.assertRaises(SystemExit):
            g.parse_dates('2026-09-12..2026-09-11')


class Canonical(unittest.TestCase):
    def test_data_gouv_spellings_share_a_slot(self):
        api = 'https://www.data.gouv.fr/api/1/datasets/r/9ae758ec'
        for spelling in ('https://www.data.gouv.fr/fr/datasets/r/9ae758ec',
                         'https://www.data.gouv.fr/en/datasets/r/9ae758ec', api):
            self.assertEqual(g.canonical(spelling), api)
            self.assertEqual(g._slug(g.canonical(spelling)), g._slug(api))

    def test_other_hosts_untouched(self):
        url = 'https://gtfs.ovapi.nl/nl/gtfs-nl.zip'
        self.assertEqual(g.canonical(url), url)


class FeedQueries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        for name, body in FEED.items():
            with open(os.path.join(cls.tmp.name, name), 'w') as fh:
                fh.write(body)
        cls.feed = g.Feed(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_calendar_and_exceptions(self):
        runs = lambda d: self.feed.runs('wk', datetime.date.fromisoformat(d))
        self.assertTrue(runs('2026-09-10'))    # Thursday
        self.assertFalse(runs('2026-09-11'))   # Friday removed by exception
        self.assertTrue(runs('2026-09-13'))    # Sunday added by exception
        self.assertFalse(runs('2026-09-12'))   # ordinary Saturday
        self.assertFalse(runs('2027-01-04'))   # past end_date

    def test_near_skips_stops_without_coordinates(self):
        self.assertEqual(self.feed.near((45.19, 5.71), 1), {'a'})

    def test_short_turn_is_not_reported(self):
        rows, ways = self.feed.departures('T75', [datetime.date(2026, 9, 10)],
                                          (45.19, 5.71), (45.055, 6.03))
        outward = rows[(datetime.date(2026, 9, 10), 'outward')]
        self.assertEqual([r[1] for r in outward], ['08:00'])   # trip B stops short
        self.assertEqual(outward[0][2], 'Gare Routière')
        self.assertEqual(ways, ['outward', 'return'])
        self.assertEqual(rows[(datetime.date(2026, 9, 10), 'return')], [])

    def test_route_matched_on_long_name_when_short_is_blank(self):
        rows, _ = self.feed.departures('Only long name', [datetime.date(2026, 9, 10)],
                                       (45.055, 6.03), (45.19, 5.71), one_way=True)
        self.assertEqual(rows[(datetime.date(2026, 9, 10), 'outward')][0][1], '01:10+1')

    def test_unknown_route(self):
        with self.assertRaises(SystemExit):
            self.feed.departures('nope', [datetime.date(2026, 9, 10)], (0, 0), (0, 0))


if __name__ == '__main__':
    unittest.main()
