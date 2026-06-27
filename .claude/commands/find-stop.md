Find the coordinates of a bus stop (or other public transport stop) using the OpenStreetMap Overpass API, and report what to put in the itinerary JSON.

## Arguments
`$ARGUMENTS` — one or more stop names to look up, comma-separated, each optionally followed by `near <place>`.

Examples:
- `/find-stop Village Central Square`
- `/find-stop Town Hall near Somewhere`
- `/find-stop Train Station Bus Stop near TownA, Market Square near TownB`

## Rate limiting

The Overpass API enforces per-IP concurrency limits and will return HTTP 429 if too many requests are in flight simultaneously. To avoid this:

- **Always issue a single query** that covers all requested stops, using a union of bounding boxes or named areas. Never fire parallel WebFetch calls to Overpass.
- If a single combined query returns too many irrelevant results, split into sequential requests with a brief pause between them (fetch, process result, then fetch next).
- Keep `[timeout:15]` or lower to avoid holding a server slot too long.

## Steps

1. Parse `$ARGUMENTS` to extract each stop name and its optional `near <place>` qualifier.

2. Build **one** Overpass QL query covering all stops. Use a union of named-area scopes where places are given, or a single bounding box that encompasses all locations when they are geographically close. Derive an appropriate bounding box from the coordinates already present in the itinerary data.

   Example — multiple stops in one query using named-area unions:
   ```
   [out:json][timeout:20];
   (
     area["name"="TownA"]->.a;
     area["name"="TownB"]->.b;
     node["highway"="bus_stop"](area.a);
     node["public_transport"="platform"](area.a);
     node["highway"="bus_stop"](area.b);
     node["public_transport"="platform"](area.b);
   );
   out body;
   ```

   Example — single bounding box with name filter (substitute real bbox and name terms):
   ```
   [out:json][timeout:15];
   (
     node["highway"="bus_stop"]["name"~"TownA|TownB|TownC",i](south,west,north,east);
     node["public_transport"="platform"]["name"~"TownA|TownB|TownC",i](south,west,north,east);
   );
   out body;
   ```

3. URL-encode the query and fetch it with a **single** WebFetch call:
   `https://overpass-api.de/api/interpreter?data=<encoded-query>`

4. Parse the JSON response. Each element has `lat`, `lon`, and `tags` (including `name`, and sometimes `ref` or `network`).

5. For each requested stop, report the top matches (up to 3) in a table: name, lat, lon, any useful tags. Flag the best match.

6. Output the JSON snippet ready to paste into the itinerary — for example:
   ```json
   "departs": {
     "station": "Stop Name As It Appears In Itinerary",
     "time": "HH:MM",
     "lat": 12.3456,
     "lng": 1.2345
   }
   ```
   Note: OSM uses `lon`; the itinerary schema uses `lng` — translate accordingly.
