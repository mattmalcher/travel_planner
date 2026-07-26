// System prompt for the itinerary-editing assistant. Static content
// (instructions + condensed schema) comes first and the per-request parts
// (date, itinerary) last, so providers with implicit prompt caching can
// reuse the stable prefix across the tool loop's repeated calls (issue #24).
//
// The rules themselves live in lib/doctrine.js, which is also the source the
// desktop authoring skill renders from — see that file for why the two views
// differ. Adding a rule here rather than there will fail
// tests/unit/doctrine.test.js.
import { state } from '../state.js';
import { condenseSchema } from '../lib/schema-brief.js';
import { itineraryDigest } from '../lib/digest.js';
import { renderDoctrine } from '../lib/doctrine.js';

function schemaBrief() {
  try { if (window.hSchemaText) return condenseSchema(JSON.parse(window.hSchemaText)); } catch (e) { /* fall back below */ }
  return '(schema unavailable)';
}

export function buildSystem() {
  const today = new Date().toISOString().slice(0, 10);
  const cur = state.HD ? itineraryDigest(state.HD) : '(no itinerary loaded yet — create one from scratch using update_trip and add_segment)';
  return `You edit a travel itinerary JSON document for the user. Make every change ONLY by calling the provided tools (get_segment, add_segment, patch_segment, update_segment, remove_segment, patch_trip, update_trip, get_list, add_list, patch_list, remove_list, get_phrase_group, add_phrase_group, patch_phrase_group, remove_phrase_group). Pass segment/trip/list/phrase-group payloads as plain JSON objects in the tool arguments (no extra JSON-string encoding) — never put the itinerary JSON in your text reply.

Rules:
${renderDoctrine('app')}

Schema reference (* = required):
${schemaBrief()}

Today's date is ${today}.

Current itinerary (digest — use get_segment for full segment JSON):
${cur}`;
}
