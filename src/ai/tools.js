// Tool definitions offered to the model, and the interpreter that applies a
// tool call to the draft itinerary (state.draft) while recording the
// operation (state.ops) for the diff preview.
import { state } from '../state.js';
import { mergePatch } from '../lib/merge-patch.js';

export function buildTools() {
  const tools = [
    { type: 'function', function: { name: 'get_segment', description: 'Fetch the full JSON of one or more segments by id (reflects your own pending edits from earlier in this turn). You must read a segment this way before editing it with patch_segment or update_segment — the digest omits fields (notes, warnings, seats, payments, coordinates) that an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more segment ids, e.g. ["seg-1","seg-4"]' } }, required: ['ids'] } } },
    { type: 'function', function: { name: 'add_segment', description: 'Add a new segment (transport, accommodation or event) to the itinerary.', parameters: { type: 'object', properties: { segment_json: { type: 'string', description: 'A complete segment object, serialised as a JSON string, conforming to the HolidayItinerary schema.' } }, required: ['segment_json'] } } },
    { type: 'function', function: { name: 'patch_segment', description: 'Update part of an existing segment (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Preferred over update_segment for partial edits.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to modify' }, changes_json: { type: 'string', description: 'An object containing only the fields to change, serialised as a JSON string.' } }, required: ['id', 'changes_json'] } } },
    { type: 'function', function: { name: 'update_segment', description: 'Replace an existing segment (matched by id) with a new full segment object.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to replace' }, segment_json: { type: 'string', description: 'The complete replacement segment object, serialised as a JSON string.' } }, required: ['id', 'segment_json'] } } },
    { type: 'function', function: { name: 'remove_segment', description: 'Remove the segment with the given id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'update_trip', description: 'Replace the trip metadata (name, travellers, start, end, currency_primary, passes).', parameters: { type: 'object', properties: { trip_json: { type: 'string', description: 'The complete trip object, serialised as a JSON string.' } }, required: ['trip_json'] } } },
  ];
  if (localStorage.getItem('hOpenRouterWeb') === '1')
    tools.push({ type: 'openrouter:web_search', parameters: { engine: 'auto', max_results: 3 } });
  return tools;
}

/* The system prompt only carries a one-line digest of each segment (issue
   #31), so an edit composed without reading the full segment can silently
   drop fields the model never saw (notes, warnings, seats, payments). Refuse
   such edits until the segment has been fetched with get_segment this turn. */
function readGuard(id) {
  if (state.reads.has(id)) return null;
  return 'ERROR: segment "' + id + '" has not been read this turn. Call get_segment first — it has fields the digest does not show, which an unread edit could lose — then retry.';
}

/** Apply one tool call to state.draft. Returns a string result for the model
    ("OK" or an "ERROR: …" it can react to). Segment payloads are validated
    against the schema (window.hValidateSegment, set up by validate.js). */
export function applyTool(tc) {
  const name = tc.function && tc.function.name;
  let args;
  try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { return 'ERROR: could not parse tool arguments: ' + e.message; }
  try {
    if (name === 'get_segment') {
      const ids = Array.isArray(args.ids) ? args.ids : [args.ids].filter(Boolean);
      if (!ids.length) return 'ERROR: get_segment needs at least one segment id.';
      return ids.map(id => {
        const seg = state.draft.segments.find(s => s.id === id);
        if (!seg) return 'ERROR: no segment with id "' + id + '".';
        state.reads.add(id);
        return JSON.stringify(seg);
      }).join('\n');
    } else if (name === 'add_segment') {
      const seg = JSON.parse(args.segment_json);
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      state.draft.segments.push(seg); state.ops.push({ kind: 'add', after: seg });
      state.reads.add(seg.id); // the model authored it in full, so it may edit it without a read
    } else if (name === 'patch_segment') {
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return 'ERROR: no segment with id "' + args.id + '".';
      const unread = readGuard(args.id); if (unread) return unread;
      const seg = mergePatch(state.draft.segments[idx], JSON.parse(args.changes_json));
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — patched segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      state.ops.push({ kind: 'update', id: args.id, before: state.draft.segments[idx], after: seg });
      state.draft.segments[idx] = seg;
    } else if (name === 'update_segment') {
      const seg = JSON.parse(args.segment_json);
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — replacement segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return 'ERROR: no segment with id "' + args.id + '".';
      const unread = readGuard(args.id); if (unread) return unread;
      state.ops.push({ kind: 'update', id: args.id, before: state.draft.segments[idx], after: seg });
      state.draft.segments[idx] = seg;
      state.reads.add(seg.id); // a replacement may carry a new id
    } else if (name === 'remove_segment') {
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return 'ERROR: no segment with id "' + args.id + '".';
      state.ops.push({ kind: 'remove', id: args.id, before: state.draft.segments[idx] });
      state.draft.segments.splice(idx, 1);
    } else if (name === 'update_trip') {
      const trip = JSON.parse(args.trip_json);
      state.ops.push({ kind: 'trip', before: state.draft.trip, after: trip }); state.draft.trip = trip;
    } else return 'ERROR: unknown tool "' + name + '".';
  } catch (e) { return 'ERROR applying ' + name + ': ' + e.message; }
  return 'OK — change recorded.';
}
