// Which subschema definition each segment type names.
//
// Errors about a segment must come from its own subschema, never the `oneOf`:
// under the oneOf ajv reports every branch, so a half-filled event comes back
// demanding transport's `mode` and `departs` — 14 misleading errors instead of
// one true one (issue #76). Both validators that exist — src/validate.js in
// the browser and scripts/itin.mjs on the desktop — need this map to do that,
// and a segment type added to one but not the other silently falls back to the
// oneOf. So the map lives here, imported by both.
//
// Only the map is shared: ajv itself deliberately stays out of lib/, because a
// node-only ajv wrapper here would be one careless import away from a second
// copy of ajv in the single-file bundle.

export const SEG_DEFS = {
  transport: 'TransportSegment',
  accommodation: 'AccommodationSegment',
  event: 'EventSegment',
};

/** `{ $ref: … }` bodies for every segment type, for the oneOf fallback that
    catches a segment naming no known type. */
export const segRefs = () => Object.values(SEG_DEFS).map(d => ({ $ref: '#/definitions/' + d }));
