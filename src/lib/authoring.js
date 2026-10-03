// The itinerary-authoring core: the tool definitions offered to a model, and
// the interpreter that applies one tool call to a HolidayItinerary document.
//
// Pure: no DOM, no window, no shared state. The document is never mutated —
// applyTool returns the next one — and the schema validators and the
// read-before-edit record are passed in. Two hosts drive it: the in-app
// assistant (src/ai/tools.js adapts it to OpenRouter and state.draft), and the
// travel plugin's MCP server, which vendors this file and its imports.
import { mergePatch } from './merge-patch.js';
import { newId } from './ids.js';

/** Tool definitions as plain JSON Schema: `{name, description, parameters}`.
    Hosts wrap them in their own envelope (OpenAI function tools, MCP tools). */
export const TOOLS = [
  { name: 'get_segment', description: 'Fetch the full JSON of one or more segments by id (reflects your own pending edits from earlier in this turn). You must read a segment this way before editing it with patch_segment or update_segment — the digest omits fields (notes, warnings, seats, payments, coordinates) that an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more segment ids, e.g. ["seg-1","seg-4"]' } }, required: ['ids'] } },
  { name: 'add_segment', description: 'Add a new segment (transport, accommodation or event) to the itinerary. The segment id is assigned automatically and returned in the result — you may omit id from the payload.', parameters: { type: 'object', properties: { segment: { type: 'object', description: 'A complete segment object conforming to the HolidayItinerary schema (id optional — one is assigned).' } }, required: ['segment'] } },
  { name: 'patch_segment', description: 'Update part of an existing segment (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Preferred over update_segment for partial edits.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } },
  { name: 'update_segment', description: 'Replace an existing segment (matched by id) with a new full segment object.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the segment to replace' }, segment: { type: 'object', description: 'The complete replacement segment object.' } }, required: ['id', 'segment'] } },
  { name: 'remove_segment', description: 'Remove the segment with the given id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'patch_trip', description: 'Update part of the trip metadata (name, travellers, start, end, currency_primary, passes) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Preferred over update_trip for partial changes.', parameters: { type: 'object', properties: { changes: { type: 'object', description: 'An object containing only the trip fields to change.' } }, required: ['changes'] } },
  { name: 'update_trip', description: 'Replace the trip metadata (name, travellers, start, end, currency_primary, passes) with a complete new trip object. Prefer patch_trip for partial changes — a replacement drops any field it omits.', parameters: { type: 'object', properties: { trip: { type: 'object', description: 'The complete trip object.' } }, required: ['trip'] } },
  { name: 'get_list', description: 'Fetch the full JSON of one or more lists by id (reflects your own pending edits from earlier in this turn). You must read a list this way before editing it with patch_list — the digest omits item fields (note, url) that an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more list ids, e.g. ["list-food"]' } }, required: ['ids'] } },
  { name: 'add_list', description: 'Add a new list (a pool of intentions: packing, foods to try, restaurant options). List and item ids are assigned automatically and returned in the result — you may omit them from the payload.', parameters: { type: 'object', properties: { list: { type: 'object', description: 'A complete List object conforming to the HolidayItinerary schema (ids optional — they are assigned).' } }, required: ['list'] } },
  { name: 'patch_list', description: 'Update part of an existing list (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Note the items array replaces wholesale — send the complete items array when changing any item (e.g. ticking one off with done:true, or recording a scheduled item\'s segment_id).', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the list to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } },
  { name: 'remove_list', description: 'Remove the list with the given id (its items are gone too; segments an item was scheduled into remain).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_phrase_group', description: 'Fetch the full JSON of one or more phrasebook groups by id (reflects your own pending edits from earlier in this turn). You must read a group this way before editing it with patch_phrase_group — the digest omits the per-phrase note, which an unread edit could silently destroy. Batch ids to save round trips.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'One or more phrase group ids, e.g. ["phr-greetings"]' } }, required: ['ids'] } },
  { name: 'add_phrase_group', description: 'Add a new phrasebook group (things to be able to say in one situation: greetings, ordering food, emergencies). Group and phrase ids are assigned automatically and returned in the result — you may omit them from the payload.', parameters: { type: 'object', properties: { group: { type: 'object', description: 'A complete PhraseGroup object conforming to the HolidayItinerary schema (ids optional — they are assigned).' } }, required: ['group'] } },
  { name: 'patch_phrase_group', description: 'Update part of an existing phrasebook group (matched by id) via JSON Merge Patch: nested objects merge, arrays and scalars replace, null removes a field. Note the items array replaces wholesale — send the complete items array when changing any phrase (e.g. filling in translations).', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id of the phrase group to modify' }, changes: { type: 'object', description: 'An object containing only the fields to change.' } }, required: ['id', 'changes'] } },
  { name: 'remove_phrase_group', description: 'Remove the phrasebook group with the given id (its phrases go with it).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

/* --- the three entity families (segments, lists, phrase groups) need the same
       four things: a read-before-edit guard, a wrong-id error, id assignment
       and a schema check. Each is written once here and described per family
       below, so a fourth family is one more FAMILIES entry rather than four
       more copies. --- */

const FAMILIES = {
  segments: {
    kind: 'segment', getTool: 'get_segment', knownLabel: 'Known ids',
    loses: 'it has fields the digest does not show, which an unread edit could lose',
  },
  // Lists (issue #40): same id-assignment and read-before-edit rules as
  // segments, applied to the lists array and its items.
  lists: {
    kind: 'list', getTool: 'get_list', knownLabel: 'Known list ids',
    loses: 'items carry fields the digest does not show (note, url), which an unread edit could lose',
  },
  // Phrases (issue #75): the list rules again, over doc.phrases. A phrase
  // group is a list of things to say and a phrase is its item, so the
  // machinery is the same shape — only the branch of the document differs.
  phrases: {
    kind: 'phrase group', getTool: 'get_phrase_group', knownLabel: 'Known phrase group ids',
    loses: 'its phrases carry a note field the digest does not show, which an unread edit could lose',
  },
};

/** An empty read-before-edit record, one id set per family. A host resets it
    whenever the model loses sight of what it read (the app: every turn). */
export function newReads() {
  return { segments: new Set(), lists: new Set(), phrases: new Set() };
}

/* The in-app prompt only carries a one-line digest of each entity (issue #31),
   so an edit composed without reading the full record can silently drop fields
   the model never saw. Refuse such edits until it has been fetched. `loses`
   names what an unread edit would destroy — it is the half of the message that
   actually helps the model correct itself. With no read record (reads null)
   the host has shown the model whole documents, and the guard is off. */
function guardRead(reads, family, id) {
  if (!reads || reads[family].has(id)) return null;
  const f = FAMILIES[family];
  return `ERROR: ${f.kind} "${id}" has not been read this turn. Call ${f.getTool} first — ${f.loses} — then retry.`;
}

/* A wrong-id error the model can self-correct from: without the known-id
   list a small model retries blind (issue #41). */
function noSuchId(family, entries, id) {
  const f = FAMILIES[family];
  const known = entries.map(e => e && e.id).filter(Boolean);
  return `ERROR: no ${f.kind} with id "${id}". ${f.knownLabel}: ${known.join(', ') || '(none)'}.`;
}

/* Give every item in `self` a document-unique id, replacing missing or
   colliding ones — item ids are how later edits and the segment_id
   back-reference find them. `self` is excluded from the taken-id scan so a
   group's own unchanged items keep their ids. Mutates `self`, which callers
   only ever pass as a fresh copy. */
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
   into the tool loop instead of only surfacing at a whole-document check
   after the loop has finished. A missing validator skips the check. */
function schemaError(check, label, value) {
  if (!check) return null;
  const v = check(value);
  return v.ok ? null : `ERROR — ${label} failed schema validation. Fix and retry:\n` + JSON.stringify(v.errors, null, 2);
}

/* Payload params are typed objects in the tool schemas (issue #42), but some
   models stringify anyway, and pre-rollout transcripts used *_json string
   arguments — accept an object, a JSON-encoded string, or the legacy name.
   Always returns a fresh copy, so assigning ids never touches the caller's
   arguments. */
function objArg(args, name) {
  let v = args[name];
  if (v === undefined) v = args[name + '_json'];
  if (typeof v === 'string') v = JSON.parse(v);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('the "' + name + '" argument must be a JSON object');
  return structuredClone(v);
}

const entries = (doc, family) => (Array.isArray(doc[family]) ? doc[family] : []);
const withRead = (reads, family, id) => (reads ? { ...reads, [family]: new Set(reads[family]).add(id) } : null);

/**
 * Apply one tool call to a document.
 *
 * - `doc`: the HolidayItinerary being edited. Never mutated.
 * - `call`: `{name, arguments}`, arguments as an object or a JSON string.
 * - `validators`: optional `{segment, trip, list, phraseGroup}`, each
 *   `value => {ok, errors}`. A missing one skips that check.
 * - `reads`: a read-before-edit record from newReads(), or null to turn the
 *   guard off for a host that shows the model whole documents.
 *
 * Returns `{doc, reads, result, op}`: the next document (the same object when
 * nothing changed), the next read record, a string result for the model ("OK…"
 * or an "ERROR…" it can react to), and the change for a diff preview (null
 * when nothing changed).
 */
export function applyTool(doc, call, { validators = {}, reads = null } = {}) {
  const name = call && call.name;
  const raw = call && call.arguments;
  let args;
  try { args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch (e) { return { doc, reads, result: 'ERROR: could not parse tool arguments: ' + e.message, op: null }; }
  const fail = result => ({ doc, reads, result, op: null });
  const done = (family, list, op, result = 'OK — change recorded.', nextReads = reads) =>
    ({ doc: family === 'trip' ? { ...doc, trip: list } : { ...doc, [family]: list }, reads: nextReads, result, op });
  const replaceAt = (list, idx, value) => list.map((x, j) => (j === idx ? value : x));

  /* get_*: return each record's JSON and mark it read. */
  const get = family => {
    const ids = Array.isArray(args.ids) ? args.ids : [args.ids].filter(Boolean);
    if (!ids.length) return fail(`ERROR: ${FAMILIES[family].getTool} needs at least one ${FAMILIES[family].kind} id.`);
    let nextReads = reads;
    const result = ids.map(id => {
      const found = entries(doc, family).find(e => e && e.id === id);
      if (!found) return noSuchId(family, entries(doc, family), id);
      nextReads = withRead(nextReads, family, id);
      return JSON.stringify(found);
    }).join('\n');
    return { doc, reads: nextReads, result, op: null };
  };

  try {
    if (name === 'get_segment') return get('segments');
    if (name === 'get_list') return get('lists');
    if (name === 'get_phrase_group') return get('phrases');

    if (name === 'add_segment') {
      const segments = entries(doc, 'segments');
      const seg = objArg(args, 'segment');
      // A missing id gets one assigned; a colliding id is overridden rather
      // than silently creating a duplicate that later edits-by-id would reach
      // nondeterministically. Assigned ids carry a random suffix (issue #41,
      // see lib/ids.js), so a hallucinated id misses and errors loudly.
      if (!seg.id || segments.some(s => s && s.id === seg.id)) seg.id = newId('seg-', new Set(segments.map(s => s && s.id)));
      const bad = schemaError(validators.segment, 'segment', seg); if (bad) return fail(bad);
      // The model authored it in full, so it may edit it without a read.
      return done('segments', [...segments, seg], { kind: 'add', after: seg },
        'OK — created segment "' + seg.id + '". Use this id for any further edits to it.', withRead(reads, 'segments', seg.id));
    }
    if (name === 'patch_segment') {
      const segments = entries(doc, 'segments');
      const idx = segments.findIndex(s => s && s.id === args.id);
      if (idx < 0) return fail(noSuchId('segments', segments, args.id));
      const unread = guardRead(reads, 'segments', args.id); if (unread) return fail(unread);
      const seg = mergePatch(segments[idx], objArg(args, 'changes'));
      const bad = schemaError(validators.segment, 'patched segment', seg); if (bad) return fail(bad);
      return done('segments', replaceAt(segments, idx, seg), { kind: 'update', id: args.id, before: segments[idx], after: seg });
    }
    if (name === 'update_segment') {
      const segments = entries(doc, 'segments');
      const seg = objArg(args, 'segment');
      const bad = schemaError(validators.segment, 'replacement segment', seg); if (bad) return fail(bad);
      const idx = segments.findIndex(s => s && s.id === args.id);
      if (idx < 0) return fail(noSuchId('segments', segments, args.id));
      const unread = guardRead(reads, 'segments', args.id); if (unread) return fail(unread);
      if (seg.id && seg.id !== args.id && segments.some((s, j) => j !== idx && s && s.id === seg.id))
        return fail('ERROR: replacement id "' + seg.id + '" already belongs to another segment — ids must be unique. Keep id "' + args.id + '" or pick a fresh one.');
      // A replacement may carry a new id, which counts as read.
      return done('segments', replaceAt(segments, idx, seg), { kind: 'update', id: args.id, before: segments[idx], after: seg },
        undefined, withRead(reads, 'segments', seg.id));
    }
    if (name === 'remove_segment') {
      const segments = entries(doc, 'segments');
      const idx = segments.findIndex(s => s && s.id === args.id);
      if (idx < 0) return fail(noSuchId('segments', segments, args.id));
      return done('segments', segments.filter((_, j) => j !== idx), { kind: 'remove', id: args.id, before: segments[idx] });
    }

    if (name === 'add_list') {
      const lists = entries(doc, 'lists');
      const list = objArg(args, 'list');
      if (!list.id || lists.some(l => l && l.id === list.id)) list.id = newId('list-', new Set(lists.map(l => l && l.id)));
      assignIds(list, lists, 'li-');
      const bad = schemaError(validators.list, 'list', list); if (bad) return fail(bad);
      const itemIds = (list.items || []).map(it => it && it.id).filter(Boolean);
      return done('lists', [...lists, list], { kind: 'add-list', after: list },
        'OK — created list "' + list.id + '"' + (itemIds.length ? ' with item ids ' + itemIds.join(', ') : '') + '. Use these ids for any further edits.',
        withRead(reads, 'lists', list.id));
    }
    if (name === 'patch_list') {
      const lists = entries(doc, 'lists');
      const idx = lists.findIndex(l => l && l.id === args.id);
      if (idx < 0) return fail(noSuchId('lists', lists, args.id));
      const unread = guardRead(reads, 'lists', args.id); if (unread) return fail(unread);
      // Copied because an unpatched items array is still the document's own.
      const list = structuredClone(mergePatch(lists[idx], objArg(args, 'changes')));
      assignIds(list, replaceAt(lists, idx, list), 'li-');
      const bad = schemaError(validators.list, 'list', list); if (bad) return fail(bad);
      return done('lists', replaceAt(lists, idx, list), { kind: 'update-list', id: args.id, before: lists[idx], after: list });
    }
    if (name === 'remove_list') {
      const lists = entries(doc, 'lists');
      const idx = lists.findIndex(l => l && l.id === args.id);
      if (idx < 0) return fail(noSuchId('lists', lists, args.id));
      return done('lists', lists.filter((_, j) => j !== idx), { kind: 'remove-list', id: args.id, before: lists[idx] });
    }

    if (name === 'add_phrase_group') {
      const groups = entries(doc, 'phrases');
      const group = objArg(args, 'group');
      if (!group.id || groups.some(g => g && g.id === group.id)) group.id = newId('phr-', new Set(groups.map(g => g && g.id)));
      assignIds(group, groups, 'ph-');
      const bad = schemaError(validators.phraseGroup, 'phrase group', group); if (bad) return fail(bad);
      const phraseIds = (group.items || []).map(p => p && p.id).filter(Boolean);
      return done('phrases', [...groups, group], { kind: 'add-phrases', after: group },
        'OK — created phrase group "' + group.id + '"' + (phraseIds.length ? ' with phrase ids ' + phraseIds.join(', ') : '') + '. Use these ids for any further edits.',
        withRead(reads, 'phrases', group.id));
    }
    if (name === 'patch_phrase_group') {
      const groups = entries(doc, 'phrases');
      const idx = groups.findIndex(g => g && g.id === args.id);
      if (idx < 0) return fail(noSuchId('phrases', groups, args.id));
      const unread = guardRead(reads, 'phrases', args.id); if (unread) return fail(unread);
      const group = structuredClone(mergePatch(groups[idx], objArg(args, 'changes')));
      assignIds(group, replaceAt(groups, idx, group), 'ph-');
      const bad = schemaError(validators.phraseGroup, 'phrase group', group); if (bad) return fail(bad);
      return done('phrases', replaceAt(groups, idx, group), { kind: 'update-phrases', id: args.id, before: groups[idx], after: group });
    }
    if (name === 'remove_phrase_group') {
      const groups = entries(doc, 'phrases');
      const idx = groups.findIndex(g => g && g.id === args.id);
      if (idx < 0) return fail(noSuchId('phrases', groups, args.id));
      return done('phrases', groups.filter((_, j) => j !== idx), { kind: 'remove-phrases', id: args.id, before: groups[idx] });
    }

    if (name === 'patch_trip' || name === 'update_trip') {
      const trip = name === 'patch_trip' ? mergePatch(doc.trip, objArg(args, 'changes')) : objArg(args, 'trip');
      const bad = schemaError(validators.trip, 'trip', trip); if (bad) return fail(bad);
      return done('trip', trip, { kind: 'trip', before: doc.trip, after: trip });
    }
    return fail('ERROR: unknown tool "' + name + '".');
  } catch (e) { return fail('ERROR applying ' + name + ': ' + e.message); }
}
