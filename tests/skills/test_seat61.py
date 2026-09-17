import unittest

from _load import load

s61 = load('journey-planner', 'seat61.py')

PAGE = ('<html><head><title>x</title><style>h2{}</style><script>var a="<h2>no</h2>";</script></head>'
        '<body><p>intro &amp; more</p>'
        '<h2 class="c">London to Lyon &amp; Grenoble</h2><p>Option 1, via <b>Lille</b>.</p>'
        '<h3>Empty heading</h3>'
        '<h2>Ferries</h2><p>Caf\xe9 aboard.</p></body></html>').encode('cp1252')


class Sections(unittest.TestCase):
    def test_split_on_headings_with_tags_and_entities_stripped(self):
        got = s61.sections(PAGE)
        self.assertEqual([h for h, _ in got], ['(top)', 'London to Lyon & Grenoble', 'Ferries'])
        self.assertEqual(got[1][1], 'Option 1, via Lille .')
        self.assertEqual(got[0][1], 'x intro & more')

    def test_scripts_do_not_leak_headings_and_cp1252_decodes(self):
        got = s61.sections(PAGE)
        self.assertEqual(got[2][1], 'Café aboard.')


class Urls(unittest.TestCase):
    def test_country_path_and_full_url(self):
        self.assertEqual(s61.page_url('france'), 'https://www.seat61.com/France.htm')
        self.assertEqual(s61.page_url('sleepers.htm'), 'https://www.seat61.com/sleepers.htm')
        self.assertEqual(s61.page_url('trains-and-routes/x.htm'), 'https://www.seat61.com/trains-and-routes/x.htm')
        self.assertEqual(s61.page_url('https://www.seat61.com/Spain.htm'), 'https://www.seat61.com/Spain.htm')


if __name__ == '__main__':
    unittest.main()
