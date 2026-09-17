import datetime
import unittest

from _load import load

plan = load('journey-planner', 'plan.py')


class Times(unittest.TestCase):
    def test_utc_to_local(self):
        got = plan.local('2026-09-25T08:01:00Z', 'Europe/London')
        self.assertEqual((got.hour, got.minute), (9, 1))
        self.assertEqual(plan.local('2026-09-25T08:01:00Z', 'Europe/Paris').hour, 10)

    def test_local_to_utc_round_trip(self):
        self.assertEqual(plan.to_utc('2026-09-25T09:01', 'Europe/London'), '2026-09-25T08:01:00Z')
        self.assertEqual(plan.to_utc('2026-01-25T09:01', 'Europe/London'), '2026-01-25T09:01:00Z')


class Legs(unittest.TestCase):
    def leg(self, **over):
        base = {'mode': 'HIGHSPEED_RAIL', 'startTime': '2026-09-25T18:01:00Z',
                'endTime': '2026-09-25T20:30:00Z', 'routeShortName': 'EST',
                'tripShortName': '9055', 'agencyName': 'Eurostar', 'headsign': 'St-Pancras',
                'from': {'name': 'Paris-Nord', 'scheduledTrack': '3'},
                'to': {'name': 'St-Pancras-International'}, 'intermediateStops': []}
        base.update(over)
        return base

    def test_train_leg_line(self):
        line = plan.describe(self.leg(), 'Europe/Paris')
        self.assertIn('20:01 pl.3 Paris-Nord -> 22:30 St-Pancras-International', line)
        self.assertIn('EST 9055  [Eurostar] to St-Pancras', line)
        self.assertIn('(0 intermediate stops)', line)

    def test_trip_number_not_repeated_when_in_route_name(self):
        line = plan.describe(self.leg(routeShortName='TGV INOUI 6920', tripShortName='6920'), 'Europe/Paris')
        self.assertIn('TGV INOUI 6920  [', line)
        self.assertNotIn('6920 6920', line)

    def test_short_walks_are_dropped_and_long_ones_kept(self):
        walk = self.leg(mode='WALK', endTime='2026-09-25T18:02:00Z')
        self.assertIsNone(plan.describe(walk, 'Europe/Paris'))
        walk['endTime'] = '2026-09-25T18:12:00Z'
        self.assertEqual(plan.describe(walk, 'Europe/Paris'), '    walk 11 min')


class Places(unittest.TestCase):
    def test_coordinates_pass_through_without_a_lookup(self):
        self.assertEqual(plan.resolve('45.1916,5.7145'), ('45.1916,5.7145', None))
        self.assertEqual(plan.resolve('-3.19,55.95')[0], '-3.19,55.95')

    def test_origin_timezone_defaults_to_london(self):
        self.assertEqual(plan.origin_tz(None), 'Europe/London')
        self.assertEqual(plan.origin_tz({'tz': 'Europe/Paris'}), 'Europe/Paris')


if __name__ == '__main__':
    unittest.main()
