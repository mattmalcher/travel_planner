// What the assistant is doing right now, as a sentence for the busy line
// (issue #99). A turn is a loop of up to MAX_STEPS requests, each of which may
// run tools before the model speaks; "Thinking…" alone said none of that, so a
// long turn looked indistinguishable from a hung one.
//
// Pure, and deliberately tolerant: a tool name arrives from the model, so an
// unknown one still gets a sentence rather than breaking the line — and the
// caller escapes what comes back, because it is model input.

/** verb + noun per tool; the noun takes a bare 's' when there is more than one. */
const TOOL_WORDS = {
  get_segment: ['reading', 'segment'],
  add_segment: ['adding', 'segment'],
  patch_segment: ['updating', 'segment'],
  update_segment: ['replacing', 'segment'],
  remove_segment: ['removing', 'segment'],
  get_list: ['reading', 'list'],
  add_list: ['adding', 'list'],
  patch_list: ['updating', 'list'],
  remove_list: ['removing', 'list'],
  get_phrase_group: ['reading', 'phrase group'],
  add_phrase_group: ['adding', 'phrase group'],
  patch_phrase_group: ['updating', 'phrase group'],
  remove_phrase_group: ['removing', 'phrase group'],
  patch_trip: ['updating', 'trip'],
  update_trip: ['replacing', 'trip'],
};

/** One tool, run `n` times: "reading the segment" / "reading 3 segments". */
export function toolPhrase(name, n = 1) {
  const words = TOOL_WORDS[name];
  if (!words) return n > 1 ? `running ${name} ${n} times` : `running ${name}`;
  const [verb, noun] = words;
  return n > 1 ? `${verb} ${n} ${noun}s` : `${verb} the ${noun}`;
}

/** Tool names in call order → [{name, n}] in first-seen order. */
function tally(tools) {
  const out = [];
  for (const name of tools) {
    if (!name) continue;
    const seen = out.find(c => c.name === name);
    if (seen) seen.n++;
    else out.push({ name, n: 1 });
  }
  return out;
}

/**
 * The busy line for the step about to run: what the model asked for on the
 * step before (`tools`, in call order), and where that leaves the turn.
 * The first step has nothing behind it yet, so it is plain "Thinking…".
 */
export function statusLine(step, maxSteps, tools = []) {
  const counts = tally(tools);
  const where = `step ${step} of ${maxSteps}`;
  if (!counts.length) return step > 1 ? `Thinking… (${where})` : 'Thinking…';
  const phrase = counts.map(c => toolPhrase(c.name, c.n)).join(', ');
  return `${phrase[0].toUpperCase()}${phrase.slice(1)}… (${where})`;
}
