// Tool definitions offered to the model, and the interpreter that applies a
// tool call to the draft itinerary (state.draft) while recording the
// operation (state.ops) for the diff preview.
import { state } from '../state.js';
import { mergePatch } from '../lib/merge-patch.js';
import { newId } from '../lib/ids.js';

export function buildTools() {
  const tools = [
    { type: 'function', function: { name: 'get_segment', description: 'Fetch the full JSON of one or more segments by id (reflects your own pending edits from earlier in this turn). You must read a segment this way before editing it with patch_segment or update_segment — the digest omits fields (notes, warnings, seats, payments, coordinates) that an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more segment ids, e.g. ["seg-1","seg-4"]' } }, required: ['ids'] } } },
    { type: 'function', function: { name: 'add_segment', description: 'Add a new segment (transport, accommodation or event) to the itinerary. The segment id is assigned automatically and returned in the result — you may omit id from the payload.', parameters: { type: 'object', properties: { segment: { type: 'object', description: 'A complete segment object conforming to the HolidayItinerary schema (id optional — one is assigned).' } }, required: ['segment'] } } },
    { type: 'function', function: { name: 'patch_segment', description: 'Update part of an existing segment (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Preferred over update_segment for partial edits.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } } },
    { type: 'function', function: { name: 'update_segment', description: 'Replace an existing segment (matched by id) with a new full segment object.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to replace' }, segment: { type: 'object', description: 'The complete replacement segment object.' } }, required: ['id', 'segment'] } } },
    { type: 'function', function: { name: 'remove_segment', description: 'Remove the segment with the given id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'patch_trip', description: 'Update part of the trip metadata (name, travellers, start, end, currency_primary, passes) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Preferred over update_trip for partial changes.', parameters: { type: 'object', properties: { changes: { type: 'object', description: 'An object containing only the trip fields to change.' } }, required: ['changes'] } } },
    { type: 'function', function: { name: 'update_trip', description: 'Replace the trip metadata (name, travellers, start, end, currency_primary, passes) with a complete new trip object. Prefer patch_trip for partial changes — a replacement drops any field it omits.', parameters: { type: 'object', properties: { trip: { type: 'object', description: 'The complete trip object.' } }, required: ['trip'] } } },
    { type: 'function', function: { name: 'get_list', description: 'Fetch the full JSON of one or more lists by id (reflects your own pending edits from earlier in this turn). You must read a list this way before editing it with patch_list — the digest omits item fields (note, url) that an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more list ids, e.g. ["list-food"]' } }, required: ['ids'] } } },
    { type: 'function', function: { name: 'add_list', description: 'Add a new list (a pool of intentions: packing, foods to try, restaurant options). List and item ids are assigned automatically and returned in the result — you may omit them from the payload.', parameters: { type: 'object', properties: { list: { type: 'object', description: 'A complete List object conforming to the HolidayItinerary schema (ids optional — they are assigned).' } }, required: ['list'] } } },
    { type: 'function', function: { name: 'patch_list', description: 'Update part of an existing list (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Note the items array replaces wholesale — send the complete items array when changing any item (e.g. ticking one off with done:true, or recording a scheduled item\'s segment_id).', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the list to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } } },
    { type: 'function', function: { name: 'remove_list', description: 'Remove the list with the given id (its items are gone too; segments an item was scheduled into remain).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'get_phrase_group', description: 'Fetch the full JSON of one or more phrasebook groups by id (reflects your own pending edits from earlier in this turn). You must read a group this way before editing it with patch_phrase_group — the digest omits the per-phrase note, which an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more phrase group ids, e.g. ["phr-greetings"]' } }, required: ['ids'] } } },
    { type: 'function', function: { name: 'add_phrase_group', description: 'Add a new phrasebook group (things to be able to say in one situation: greetings, ordering food, emergencies). Group and phrase ids are assigned automatically and returned in the result — you may omit them from the payload.', parameters: { type: 'object', properties: { group: { type: 'object', description: 'A complete PhraseGroup object conforming to the HolidayItinerary schema (ids optional — they are assigned).' } }, required: ['group'] } } },
    { type: 'function', function: { name: 'patch_phrase_group', description: 'Update part of an existing phrasebook group (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Note the items array replaces wholesale — send the complete items array when changing any phrase (e.g. filling in translations).', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the phrase group to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } } },
    { type: 'function', function: { name: 'remove_phrase_group', description: 'Remove the phrasebook group with the given id (its phrases go with it).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  ];
  if (localStorage.getItem('hOpenRouterWeb') === '1')
    tools.push({ type: 'openrouter:web_search', parameters: { engine: 'auto', max_results: 3 } });
  return tools;
}

/* --- the three entity families (segments, lists, phrase groups) need the same
       four things: a read-before-edit guard, a wrong-id error, id assignment
       and a schema check. Each is written once here and named per family
       below, so a fourth family is four one-liners rather than four more
       copies. --- */

/* The system prompt only carries a one-line digest of each entity (issue #31),
   so an edit composed without reading the full record can silently drop fields
   the model never saw. Refuse such edits until it has been fetched this turn.
   `loses` names what an unread edit would destroy — it is the half of the
   message that actually helps the model correct itself. */
function guardRead(reads, kind, tool, loses, id) {
  if (reads.has(id)) return null;
  return `ERROR: ${kind} "${id}" has not been read this turn. Call ${tool} first — ${loses} — then retry.`;
}

/* A wrong-id error the model can self-correct from: without the known-id
   list a small model retries blind (issue #41). */
function noSuchId(kind, knownLabel, known, id) {
  return `ERROR: no ${kind} with id "${id}". ${knownLabel}: ${known.filter(Boolean).join(', ') || '(none)'}.`;
}

/* Give every item in `self` a document-unique id, replacing missing or
   colliding ones — item ids are how later edits and the segment_id
   back-reference find them. `self` is excluded from the taken-id scan so a
   group's own unchanged items keep their ids. */
function assignIds(self, groups, prefix) {
  const taken = new Set();
  for (const g of groups) if (g && g !== self) for (const it of g.items || []) if (it && it.id) taken.add(it.id);
  for (const it of self.items || []) {
    if (!it) continue;
    if (!it.id || taken.has(it.id)) it.id = newId(prefix, taken);
    taken.add(it.id);
  }
}

/* Payloads are schema-checked at tool time (issue #43) so errors feed back
   into the tool loop instead of only surfacing at the preview's whole-document
   check, after the loop has finished. */
function schemaError(validator, label, value) {
  const check = window[validator];
  if (!check) return null;
  const v = check(value);
  return v.ok ? null : `ERROR — ${label} failed schema validation. Fix and retry:\n` + JSON.stringify(v.errors, null, 2);
}

/* The branch of the draft an entity family lives on, created on first use. */
function draftArray(key) {
  return Array.isArray(state.draft[key]) ? state.draft[key] : (state.draft[key] = []);
}

const readGuard = id => guardRead(state.reads, 'segment', 'get_segment',
  'it has fields the digest does not show, which an unread edit could lose', id);

/* Interpreter-assigned segment ids (issue #41, see lib/ids.js): a random
   suffix means a hallucinated id misses and errors loudly instead of
   resolving to whichever real segment it happens to name (sequential seg-N
   ids made a guessed id usually *exist*). Existing documents keep their ids
   — only newly assigned ones use this format. */
function newSegId(segments) {
  return newId('seg-', new Set(segments.map(s => s && s.id)));
}

const noSuchSegment = id => noSuchId('segment', 'Known ids',
  state.draft.segments.map(s => s && s.id), id);

/* --- lists (issue #40): same id-assignment and read-before-edit rules as
       segments, applied to the lists array and its items --- */

const draftLists = () => draftArray('lists');

const listReadGuard = id => guardRead(state.listReads, 'list', 'get_list',
  'items carry fields the digest does not show (note, url), which an unread edit could lose', id);

const noSuchList = id => noSuchId('list', 'Known list ids', draftLists().map(l => l && l.id), id);

/* List item ids are "li-" + a random suffix. */
const assignItemIds = (self, lists) => assignIds(self, lists, 'li-');

const listError = list => schemaError('hValidateList', 'list', list);

/* --- phrases (issue #75): the list rules again, over doc.phrases. A phrase
       group is a list of things to say and a phrase is its item, so the
       id-assignment, read-before-edit and validation machinery is the same
       shape — only the branch of the document differs. --- */

const draftGroups = () => draftArray('phrases');

const groupReadGuard = id => guardRead(state.phraseReads, 'phrase group', 'get_phrase_group',
  'its phrases carry a note field the digest does not show, which an unread edit could lose', id);

const noSuchGroup = id => noSuchId('phrase group', 'Known phrase group ids', draftGroups().map(g => g && g.id), id);

/* Phrase ids are "ph-" + a random suffix, assigned exactly as item ids are. */
const assignPhraseIds = (self, groups) => assignIds(self, groups, 'ph-');

const groupError = group => schemaError('hValidatePhraseGroup', 'phrase group', group);

/* Payload params are typed objects in the tool schemas (issue #42), but some
   models stringify anyway, and pre-rollout transcripts used *_json string
   arguments — accept an object, a JSON-encoded string, or the legacy name. */
function objArg(args, name) {
  let v = args[name];
  if (v === undefined) v = args[name + '_json'];
  if (typeof v === 'string') v = JSON.parse(v);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('the "' + name + '" argument must be a JSON object');
  return v;
}

const tripError = trip => schemaError('hValidateTrip', 'trip', trip);

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
        if (!seg) return noSuchSegment(id);
        state.reads.add(id);
        return JSON.stringify(seg);
      }).join('\n');
    } else if (name === 'add_segment') {
      const seg = objArg(args, 'segment');
      // A missing id gets one assigned; a colliding id is overridden rather
      // than silently creating a duplicate that later edits-by-id would
      // reach nondeterministically (issue #41).
      if (!seg.id || state.draft.segments.some(s => s && s.id === seg.id)) seg.id = newSegId(state.draft.segments);
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      state.draft.segments.push(seg); state.ops.push({ kind: 'add', after: seg });
      state.reads.add(seg.id); // the model authored it in full, so it may edit it without a read
      return 'OK — created segment "' + seg.id + '". Use this id for any further edits to it.';
    } else if (name === 'patch_segment') {
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return noSuchSegment(args.id);
      const unread = readGuard(args.id); if (unread) return unread;
      const seg = mergePatch(state.draft.segments[idx], objArg(args, 'changes'));
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — patched segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      state.ops.push({ kind: 'update', id: args.id, before: state.draft.segments[idx], after: seg });
      state.draft.segments[idx] = seg;
    } else if (name === 'update_segment') {
      const seg = objArg(args, 'segment');
      if (window.hValidateSegment) { const v = window.hValidateSegment(seg); if (!v.ok) return 'ERROR — replacement segment failed schema validation. Fix and retry:\n' + JSON.stringify(v.errors, null, 2); }
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return noSuchSegment(args.id);
      const unread = readGuard(args.id); if (unread) return unread;
      if (seg.id && seg.id !== args.id && state.draft.segments.some((s, j) => j !== idx && s && s.id === seg.id))
        return 'ERROR: replacement id "' + seg.id + '" already belongs to another segment — ids must be unique. Keep id "' + args.id + '" or pick a fresh one.';
      state.ops.push({ kind: 'update', id: args.id, before: state.draft.segments[idx], after: seg });
      state.draft.segments[idx] = seg;
      state.reads.add(seg.id); // a replacement may carry a new id
    } else if (name === 'remove_segment') {
      const idx = state.draft.segments.findIndex(s => s.id === args.id);
      if (idx < 0) return noSuchSegment(args.id);
      state.ops.push({ kind: 'remove', id: args.id, before: state.draft.segments[idx] });
      state.draft.segments.splice(idx, 1);
    } else if (name === 'get_list') {
      const ids = Array.isArray(args.ids) ? args.ids : [args.ids].filter(Boolean);
      if (!ids.length) return 'ERROR: get_list needs at least one list id.';
      return ids.map(id => {
        const list = draftLists().find(l => l && l.id === id);
        if (!list) return noSuchList(id);
        state.listReads.add(id);
        return JSON.stringify(list);
      }).join('\n');
    } else if (name === 'add_list') {
      const list = objArg(args, 'list');
      const lists = draftLists();
      if (!list.id || lists.some(l => l && l.id === list.id)) list.id = newId('list-', new Set(lists.map(l => l && l.id)));
      assignItemIds(list, lists);
      const bad = listError(list); if (bad) return bad;
      lists.push(list); state.ops.push({ kind: 'add-list', after: list });
      state.listReads.add(list.id); // the model authored it in full, so it may edit it without a read
      const itemIds = (list.items || []).map(it => it && it.id).filter(Boolean);
      return 'OK — created list "' + list.id + '"' + (itemIds.length ? ' with item ids ' + itemIds.join(', ') : '') + '. Use these ids for any further edits.';
    } else if (name === 'patch_list') {
      const lists = draftLists();
      const idx = lists.findIndex(l => l && l.id === args.id);
      if (idx < 0) return noSuchList(args.id);
      const unread = listReadGuard(args.id); if (unread) return unread;
      const list = mergePatch(lists[idx], objArg(args, 'changes'));
      assignItemIds(list, lists.map((l, j) => j === idx ? list : l));
      const bad = listError(list); if (bad) return bad;
      state.ops.push({ kind: 'update-list', id: args.id, before: lists[idx], after: list });
      lists[idx] = list;
    } else if (name === 'remove_list') {
      const lists = draftLists();
      const idx = lists.findIndex(l => l && l.id === args.id);
      if (idx < 0) return noSuchList(args.id);
      state.ops.push({ kind: 'remove-list', id: args.id, before: lists[idx] });
      lists.splice(idx, 1);
    } else if (name === 'get_phrase_group') {
      const ids = Array.isArray(args.ids) ? args.ids : [args.ids].filter(Boolean);
      if (!ids.length) return 'ERROR: get_phrase_group needs at least one phrase group id.';
      return ids.map(id => {
        const group = draftGroups().find(g => g && g.id === id);
        if (!group) return noSuchGroup(id);
        state.phraseReads.add(id);
        return JSON.stringify(group);
      }).join('\n');
    } else if (name === 'add_phrase_group') {
      const group = objArg(args, 'group');
      const groups = draftGroups();
      if (!group.id || groups.some(g => g && g.id === group.id)) group.id = newId('phr-', new Set(groups.map(g => g && g.id)));
      assignPhraseIds(group, groups);
      const bad = groupError(group); if (bad) return bad;
      groups.push(group); state.ops.push({ kind: 'add-phrases', after: group });
      state.phraseReads.add(group.id); // the model authored it in full, so it may edit it without a read
      const phraseIds = (group.items || []).map(p => p && p.id).filter(Boolean);
      return 'OK — created phrase group "' + group.id + '"' + (phraseIds.length ? ' with phrase ids ' + phraseIds.join(', ') : '') + '. Use these ids for any further edits.';
    } else if (name === 'patch_phrase_group') {
      const groups = draftGroups();
      const idx = groups.findIndex(g => g && g.id === args.id);
      if (idx < 0) return noSuchGroup(args.id);
      const unread = groupReadGuard(args.id); if (unread) return unread;
      const group = mergePatch(groups[idx], objArg(args, 'changes'));
      assignPhraseIds(group, groups.map((g, j) => j === idx ? group : g));
      const bad = groupError(group); if (bad) return bad;
      state.ops.push({ kind: 'update-phrases', id: args.id, before: groups[idx], after: group });
      groups[idx] = group;
    } else if (name === 'remove_phrase_group') {
      const groups = draftGroups();
      const idx = groups.findIndex(g => g && g.id === args.id);
      if (idx < 0) return noSuchGroup(args.id);
      state.ops.push({ kind: 'remove-phrases', id: args.id, before: groups[idx] });
      groups.splice(idx, 1);
    } else if (name === 'patch_trip') {
      const trip = mergePatch(state.draft.trip, objArg(args, 'changes'));
      const bad = tripError(trip); if (bad) return bad;
      state.ops.push({ kind: 'trip', before: state.draft.trip, after: trip }); state.draft.trip = trip;
    } else if (name === 'update_trip') {
      const trip = objArg(args, 'trip');
      const bad = tripError(trip); if (bad) return bad;
      state.ops.push({ kind: 'trip', before: state.draft.trip, after: trip }); state.draft.trip = trip;
    } else return 'ERROR: unknown tool "' + name + '".';
  } catch (e) { return 'ERROR applying ' + name + ': ' + e.message; }
  return 'OK — change recorded.';
}
