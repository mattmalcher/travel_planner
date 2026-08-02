# Eurostar: fares, times, and which page to trust

Read this before writing any cross-Channel segment. Eurostar sells London →
France through tickets including the onward TGV, so one search answers "what
does this weekend cost by train".

## The timetable pages are NOT walled — only the fare search is

A plain `WebFetch` of
`/us-en/travel-info/timetable/<originId>/<destId>/<slug>/<slug>` returns the
whole day's departures with train numbers (London St Pancras `7015400`, Paris
Gare du Nord `8727100`). That answers "which departures exist and what connects"
without touching the browser at all, so try it *before* asking the user to start
Chrome. It renders one day at a time and defaults to today, so say which date the
grid you read was for.

**But do not write segment times from it.** Its minutes disagree with the booking
engine by up to ten — the same ES service read 13:31→16:49 on the timetable page
and 13:31→16:59 in the search, and the search is what you are actually buying.
Use the timetable page to decide *which* departures to investigate; take the
times themselves from the journey-details modal. Correcting a file's times from
the timetable page introduced two errors that the original had right.

## The fare search

The results page is a deep link —
`/search/uk-en?adult=2&origin=<id>&destination=<id>&outbound=YYYY-MM-DD` — so
after one form submission every further date is a `navigate` + `get_page_text`,
several to a `browser_batch`. Station ids are opaque (Grenoble `8774700`); read a
new one out of the URL after searching that station once.

Two traps:

- **The return leg is not in the deep link.** The site wants an outbound selected
  first, so price each direction as a one-way and say the total is two one-ways.
- **The per-leg breakdown is behind the "N change" button, in a modal** —
  service numbers, individual leg times, the cross-Paris transfer window. Get it
  before writing segments; a through time alone cannot tell you whether the
  connection is 1 hr 15 or 2 hr 16.

## A connection you computed is not a connection you can book

Eurostar will not sell a cross-Paris through booking below its own minimum
connection time (~1 hr 15 Gare du Nord → Gare de Lyon), regardless of how fast
the RER actually is. A 55-minute transfer that looks fine on a map simply is not
on sale — and the through booking is what makes the operator responsible for
rebooking you if the first leg is late, usually worth more than the half hour it
costs. Check what the search really offers before writing a self-transfer with
less slack than the operator's own minimum.

The mainline SNCF GTFS feed (see `sncf-timetables`) contains **no Eurostar**, so
these pages are the only source for the cross-Channel legs.
