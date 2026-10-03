// The in-app assistant's side of the authoring core (lib/authoring.js): wraps
// its tool definitions for OpenRouter, and applies a tool call to the draft
// itinerary (state.draft) while recording the operation (state.ops) for the
// diff preview.
import { state } from '../state.js';
import { TOOLS, applyTool as applyToDoc } from '../lib/authoring.js';

export function buildTools() {
  const tools = TOOLS.map(fn => ({ type: 'function', function: fn }));
  if (localStorage.getItem('hOpenRouterWeb') === '1')
    tools.push({ type: 'openrouter:web_search', parameters: { engine: 'auto', max_results: 3 } });
  return tools;
}

/* The schema validators src/validate.js installs on window, read at call time
   so a validator that is missing (or stubbed in a test) behaves as it does
   there. */
function validators() {
  return {
    segment: window.hValidateSegment,
    trip: window.hValidateTrip,
    list: window.hValidateList,
    phraseGroup: window.hValidatePhraseGroup,
  };
}

/** Apply one OpenAI-style tool call to state.draft. Returns a string result
    for the model ("OK" or an "ERROR: …" it can react to). The read-before-edit
    record lives on state and is reset each turn by chat.js. */
export function applyTool(tc) {
  const fn = tc.function || {};
  const reads = { segments: state.reads, lists: state.listReads, phrases: state.phraseReads };
  const out = applyToDoc(state.draft, { name: fn.name, arguments: fn.arguments || '{}' }, { validators: validators(), reads });
  state.draft = out.doc;
  state.reads = out.reads.segments;
  state.listReads = out.reads.lists;
  state.phraseReads = out.reads.phrases;
  if (out.op) state.ops.push(out.op);
  return out.result;
}
