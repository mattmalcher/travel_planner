#!/usr/bin/env python3
"""Read one section of a seat61.com page without pulling the whole page in.

  ./seat61.py France                       # headings on the country page
  ./seat61.py France --find 'Grenoble'     # the section(s) mentioning it
  ./seat61.py trains-and-routes/paris-to-nice-by-train.htm --find 'sleeper'
  ./seat61.py https://www.seat61.com/sleepers.htm --find 'Nightjet' --context 1500

A country page is 200-850 KB, so the page is fetched once, cached for a week
under ~/.cache/seat61, and only the headings or the matching stretches are
printed. seat61 pages are Windows-1252, not UTF-8.
"""
import argparse
import hashlib
import html
import os
import re
import sys
import time
import urllib.request

SITE = 'https://www.seat61.com/'
UA = 'travel-planner-skills/1.0 (+https://github.com/mattmalcher/travel_planner)'


def fetch(url):
    base = os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache')
    slot = os.path.join(base, 'seat61', hashlib.sha256(url.encode()).hexdigest()[:24] + '.html')
    os.makedirs(os.path.dirname(slot), exist_ok=True)
    if os.path.exists(slot) and time.time() - os.path.getmtime(slot) < 7 * 86400:
        return open(slot, 'rb').read()
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read()
    open(slot, 'wb').write(raw)
    return raw


def sections(raw):
    """(heading, text) pairs, in page order."""
    page = raw.decode('cp1252', 'replace')
    page = re.sub(r'<(script|style).*?</\1>', ' ', page, flags=re.S | re.I)
    parts = re.split(r'<h([1-4])[^>]*>(.*?)</h\1>', page, flags=re.S | re.I)
    out = [('(top)', parts[0])]
    for i in range(1, len(parts), 3):
        out.append((parts[i + 1], parts[i + 2]))
    clean = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
    return [(clean(h), clean(t)) for h, t in out if clean(t)]


def page_url(page):
    """A full URL as given; a path under the site; or a country name, which
    seat61 spells capitalised with a .htm suffix (France.htm, Spain.htm)."""
    if page.startswith('http'):
        return page
    return SITE + (page if page.endswith('.htm') else page.capitalize() + '.htm')


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('page', help='a full URL, a path like trains-and-routes/x.htm, or a country name')
    ap.add_argument('--find', metavar='REGEX', help='print sections mentioning this (case-insensitive)')
    ap.add_argument('--context', type=int, default=700, help='characters around each match (default 700)')
    args = ap.parse_args()

    page = page_url(args.page)
    raw = fetch(page)
    secs = sections(raw)
    if not args.find:
        print(f'{page}: {len(secs)} sections, {sum(len(t) for _, t in secs)//1000} KB of text')
        for heading, text in secs:
            print(f'  {heading[:70]:70s} {len(text)//1000:3d} KB')
        print('\nUse --find REGEX to read the part you need.')
        return
    pattern = re.compile(args.find, re.I)
    hits = 0
    for heading, text in secs:
        if pattern.search(heading):
            # A heading match is the section you wanted: print it whole (capped).
            hits += 1
            print(f'## {heading}\n{text[:4000]}{"…" if len(text) > 4000 else ""}\n')
            continue
        for m in pattern.finditer(text):
            hits += 1
            lo, hi = max(0, m.start() - args.context), min(len(text), m.end() + args.context)
            print(f'## {heading}\n…{text[lo:hi]}…\n')
            if hits >= 8:
                print(f'(stopping after 8 matches; narrow --find)')
                return
    if not hits:
        print(f'no match for {args.find!r}; try the headings list, or web-search site:seat61.com')
    print(f'source: {page}, read {time.strftime("%Y-%m-%d")}')


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
