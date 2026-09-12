#!/usr/bin/env bash
# Search the Trainline European stations database for a train station.
#
#   lookup.sh <pattern> [country-code]
#
# <pattern> is an extended regex matched case- and accent-insensitively against
# the station name, so `san sebastian` finds `San Sebastián` and `zurich|basel`
# finds both. [country-code] is an optional ISO 3166-1 alpha-2 filter (ES, FR…).
#
# The ~16 MB stations.csv is cached and reused. Set STATIONS_CACHE to the
# session scratchpad so the download happens once per session:
#
#   STATIONS_CACHE=<scratchpad> lookup.sh bayonne
#
# Data: https://github.com/trainline-eu/stations (ODbL). Never commit the cache.
set -euo pipefail

pattern=${1:-}
country=${2:-}
if [ -z "$pattern" ]; then
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi

cache=${STATIONS_CACHE:-${TMPDIR:-/tmp}/trainline-stations}
mkdir -p "$cache"
csv=$cache/stations.csv
ascii=$cache/stations.ascii.csv
url=https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv

if [ ! -s "$csv" ]; then
  echo "fetching stations.csv into $cache (~16 MB, once per session)…" >&2
  curl -sSf -o "$csv" "$url"
fi
# Accent-stripped mirror, matched by line number against the real file so the
# output keeps the original spelling.
if [ ! -s "$ascii" ] || [ "$csv" -nt "$ascii" ]; then
  iconv -f utf-8 -t ascii//TRANSLIT < "$csv" > "$ascii"
fi

# Columns (semicolon-delimited, unquoted): 2 name, 6 latitude, 7 longitude,
# 8 parent_station_id, 10 country, 15 is_suggestable. is_city and
# is_main_station are documented upstream as unreliable — not used here.
awk -F';' -v pat="$(printf '%s' "$pattern" | tr '[:upper:]' '[:lower:]')" \
          -v want="$country" '
  FNR == 1 { pass++; next }
  # pass 1: accent-stripped names, keyed by line so the real spelling survives.
  pass == 1 { norm[FNR] = tolower($2); next }
  # pass 2: every id used as a parent is a meta station — a city group, not a
  # platform — and that can only be known after seeing the whole file.
  pass == 2 { if ($8 != "") isparent[$8] = 1; next }
  norm[FNR] ~ pat && $15 == "t" && (want == "" || $10 == want) {
    id[++n] = $1; nm[n] = $2; la[n] = $6; lo[n] = $7; co[n] = $10; pa[n] = $8
  }
  END {
    if (!n) {
      print "no match — try Overpass (bus/tram/ferry stops are not in this data)"
      exit
    }
    for (i = 1; i <= n; i++)
      printf "%-42s %10.6f %11.6f  %-3s %s\n", nm[i], la[i], lo[i], co[i], \
        (id[i] in isparent && pa[i] == "" ? "CITY GROUP — not a platform" \
                                          : (pa[i] == "" ? "" : "in group " pa[i]))
    printf "\n%d match(es).\n", n
  }
' "$ascii" "$csv" "$csv"
