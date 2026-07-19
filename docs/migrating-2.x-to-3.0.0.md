# Migrating an itinerary JSON from schema 2.x to 3.0.0

One-off notes for hand-updating the couple of existing trip files. Once
they're migrated this document has done its job and can be deleted.

Work through a file top to bottom; the viewer's upload validation (or an
ajv run against `schema/holiday_itinerary_schema.json`) will confirm when
you're done.

## Costs (every segment)

- Rename `"total"` → `"amount"`.
- Delete any `"note"` inside a cost object — move the text into the
  segment's `"notes"` if it's worth keeping.
- A cost with status `paid` or `pending` must carry `amount` or
  `payments[]`; bare `"cost": {}` no longer validates.

## Transport segments

- In `departs` / `arrives`, rename `"station"` → `"place"`.
- Delete `"class"`. If the class matters, mention it in `"notes"` (or it's
  implicit in `seats[]`).
- Delete placeholder refs like `"ref": "n/a"` — `ref` is optional now.
- If the same pass reference (e.g. `"IR01"`) is repeated in several legs'
  `ref`, define it once in `trip.passes` and point each leg at it:

  ```json
  "trip": { "passes": [{ "id": "IR01", "name": "Interrail Global Pass" }] }
  ...
  { "type": "transport", "pass_id": "IR01" }
  ```

## Accommodation segments

- Delete any top-level `"date"` — `checkin.date` / `checkout.date` are the
  only dates.
- Delete `"guests"` and `"nights"` — nights is derived from the
  checkin/checkout dates.

## Event segments

- Delete `"artist"` — fold it into `"name"` (e.g. `"The Cogs at La Cigale"`).
- Delete `"rating"`.
- New optional fields you may want while you're in there: `end_date`
  (multi-day festivals), `end_time`, `all_day` — see the schema.

## Finally

- Set `"schema_version": "3.0.0"` at the top level (or just re-download
  from the viewer, which stamps it).
