/** One source for the document-authoring doctrine: the rules that decide what a
    well-formed HolidayItinerary looks like, as opposed to what the JSON Schema
    can enforce on its own.

    Four consumers share three views. The in-app assistant renders the `app`
    view into its system prompt (src/ai/prompt.js). Desktop editing in this
    repo renders the `desktop` view into
    .agents/skills/itinerary-authoring/SKILL.md, kept in step by
    `npm run itin -- doctrine --write` and guarded by
    tests/unit/doctrine.test.js; the standalone skill that
    scripts/bundle-authoring.mjs generates for private workspaces copies that
    SKILL.md, so it carries the same view. An MCP host driving
    lib/authoring.js (the travel plugin, which vendors this file) renders the
    `mcp` view: the app's tools, but with whole documents in hand rather than
    a digest.

    The split exists because roughly a third of the original prompt was not
    doctrine at all but context-window mitigation: the assistant sees a digest
    (lib/digest.js) rather than the document, so it must re-read a segment before
    editing it and prefer partial patches. On the desktop the whole file is in
    hand, and those rules are not merely unnecessary — they are wrong. Hence
    `scope`, and hence the `not-mobile` entry telling a desktop reader so
    explicitly.

    Pure: no DOM, no state, no imports. */

/** `scope` decides which surfaces a rule reaches — 'all', one surface, or an
    array of surfaces:
      all      — a format truth that holds wherever the JSON is written
      app      — tool mechanics or digest handling, meaningless outside the app
      desktop  — file, id and hand-off conventions the app never faces
      mcp      — tool mechanics for a host that returns whole documents, so the
                 app's digest and read-before-edit rules do not apply
    An `id` may repeat across entries when one topic needs a per-surface tail,
    but never twice under the same scope value. */
export const DOCTRINE = [
  {
    id: 'digest',
    scope: 'app',
    text: 'The current itinerary below is a DIGEST: one line per segment (id | kind | when/where | name | cost), with +notes/+warnings/proposal flags marking detail the line omits. It is not the full data.',
  },
  {
    id: 'read-before-edit',
    scope: 'app',
    text: 'Before editing an existing segment with patch_segment or update_segment, fetch its full JSON with get_segment (batch several ids in one call) — segments carry fields the digest hides (notes, warnings, seats, payments, coordinates) that an unread edit would lose, so unread edits are rejected.',
  },
  {
    id: 'whole-document',
    scope: 'mcp',
    text: 'Tool results carry the whole stored itinerary, not a digest. Read a segment, list or phrase group there before editing it, and build each edit on the latest result rather than an earlier copy.',
  },
  {
    id: 'partial-edits',
    scope: ['app', 'mcp'],
    text: 'Prefer patch_segment for partial edits to an existing segment, and patch_trip for partial trip changes (send only the fields that change; null removes a field); use update_segment / update_trip only when replacing most of it — a full replacement drops every field it omits.',
  },
  {
    id: 'ids',
    scope: ['app', 'mcp'],
    text: "Segment ids are assigned for you: add_segment returns the created segment's id — use ids exactly as returned there or shown in the digest, never invent or guess one.",
  },
  {
    id: 'schema-authority',
    scope: 'all',
    text: 'Follow the schema exactly: required fields, enums, and the "type" const for each segment kind.',
  },
  {
    id: 'schema-authority',
    scope: ['app', 'mcp'],
    text: 'The schema reference below marks required fields with *. Every tool payload is validated against the full JSON Schema and any errors are returned to you to fix.',
  },
  {
    id: 'schema-authority',
    scope: 'desktop',
    text: 'The schema is schema/holiday_itinerary_schema.json; `npm run itin -- schema-brief` prints a short reference when the full file is more than you need. `make validate` runs the same ajv the app runs on upload, so a file that validates here will load there.',
  },
  {
    id: 'formats',
    scope: 'all',
    text: "Use 24-hour HH:MM times and YYYY-MM-DD dates. Currency codes are 3 uppercase letters; default to the trip's currency_primary (GBP for a new trip).",
  },
  {
    id: 'duration',
    scope: 'all',
    text: 'Provide duration_min where the schema requires it (transport).',
  },
  {
    id: 'cost-shape',
    scope: 'all',
    text: 'Costs carry one "amount" (plus optional payments[] instalments that sum to it); a cost with status paid/pending needs an amount or payments.',
  },
  {
    id: 'refs-and-passes',
    scope: 'all',
    text: 'Transport ref is optional: omit it when unknown or not applicable (taxis, local buses) — never fill in placeholders like "n/a". Travel class goes in seats[] or notes if it matters. When a leg is covered by a travel pass (e.g. Interrail), define the pass once in trip.passes and set the leg\'s pass_id instead of abusing ref.',
  },
  {
    id: 'event-timing',
    scope: 'all',
    text: 'Multi-day events (festivals) set end_date; timed events use time plus end_time or duration_min; genuinely all-day activities set all_day true instead of an invented time.',
  },
  {
    id: 'lists',
    scope: 'all',
    text: "Lists hold intentions that aren't (yet) plans (packing, foods to try, restaurant options); segments hold plans. List items have no date or cost — when the user schedules an item, create a normal event segment, then set that item's segment_id to the new segment's id. To tick an item off set its done flag.",
  },
  {
    id: 'lists',
    scope: 'app',
    text: 'Create that segment with add_segment and record the segment_id with patch_list. The same read-before-edit rule applies: get_list before patch_list, and a patch\'s items array replaces wholesale, so send it complete. List and item ids are assigned by add_list — use them exactly as returned or shown in the digest.',
  },
  {
    id: 'lists',
    scope: 'mcp',
    text: "Create that segment with add_segment and record the segment_id with patch_list. A patch's items array replaces wholesale, so send it complete. List and item ids are assigned by add_list — use them exactly as returned.",
  },
  {
    id: 'phrases',
    scope: 'all',
    text: 'The phrasebook (phrases) holds things the traveller wants to be able to SAY, grouped by situation, with no date, cost or done flag — it is reference material, not a plan and not a checklist. A Phrase has text (the traveller\'s own language), local (the same thing in the local language), an optional pronunciation respelled for a reader of the traveller\'s language, and an optional note on when to use it. Set the group\'s language so it is clear which language "local" is.',
  },
  {
    id: 'phrases',
    scope: 'app',
    text: 'When asked to translate a group, get_phrase_group it, then patch_phrase_group with the complete items array carrying the filled-in local and pronunciation fields. The read-before-edit rule and assigned ids work exactly as they do for lists.',
  },
  {
    id: 'phrases',
    scope: 'mcp',
    text: 'When asked to translate a group, patch_phrase_group with the complete items array carrying the filled-in local and pronunciation fields. Group and phrase ids are assigned by add_phrase_group, exactly as they are for lists.',
  },
  {
    id: 'unconfirmed',
    scope: 'all',
    text: 'Infer reasonable values for missing details, but do not invent booking references unless asked; use status "not_booked" when something isn\'t confirmed.',
  },
  {
    id: 'unconfirmed',
    scope: ['app', 'mcp'],
    text: 'A segment that has been suggested rather than agreed can carry a proposal instead.',
  },
  {
    id: 'preference',
    scope: ['app', 'mcp'],
    text: 'If a choice between valid options genuinely depends on user preference, ask in your text reply before calling tools.',
  },
  {
    id: 'preference',
    scope: 'desktop',
    text: 'If a choice between valid options genuinely depends on user preference, ask rather than quietly deciding for the user.',
  },
  {
    id: 'open-questions',
    scope: 'all',
    text: 'Never park a question, a decision or an unresolved option set in the document. Ask it in the conversation and write the answer. A document is a plan the traveller acts on, not a worklist between you and them: an entry saying "decide X before booking" or "Option A / Option B" is a question that will be read weeks later by someone who cannot answer it and has no idea what you were weighing.',
  },
  {
    id: 'broken-plan',
    scope: 'all',
    text: 'If research shows the plan cannot work as written — a connection that does not exist, a hut shut on the night, a bus that does not run that day — STOP and say so in the conversation. Do not record the impossibility in the document, and do not carry on filling in the parts that come after it: work downstream of a broken leg is wasted if the fix moves the dates, and a file describing a trip that cannot happen is worse than no file. Fix it with the user first, then write.',
  },
  {
    id: 'reader',
    scope: 'all',
    text: 'The document is read by a traveller who was not present for the research, on a phone, possibly mid-trip. Notes and warnings are instructions to them, not a log of how you worked: no feed names, dataset ids, tool names, file versions, schema talk, or "read on <date> from <source>". Give them what they can act on instead — the number to ring, the page to check, what to confirm and by when, and how much slack a connection really has. Say what changed and why only when it changes what they should DO.',
  },
  {
    id: 'summarise',
    scope: ['app', 'mcp'],
    text: 'After your tool calls, reply with a short plain-text summary of what you changed.',
  },

  /* --- desktop only: the conventions the browser app never has to face ---- */

  {
    id: 'not-mobile',
    scope: 'desktop',
    text: "Do not carry the in-app assistant's rules across from src/ai/prompt.js. Its digest disclosure, its read-before-edit requirement and its prefer-a-patch rule are all mitigations for a phone that sees a one-line-per-segment digest instead of the document. Here you have the file: read it, edit it in place, and ignore all three.",
  },
  {
    id: 'ids',
    scope: 'desktop',
    text: 'Ids are random on purpose (src/lib/ids.js): a mistyped or guessed id should miss loudly rather than resolve to whichever real record it happens to name. Mint new ones with `npm run itin -- ids <file> <prefix> [n]` — never hand-write mnemonic ids like list-bay01 or li-b1cat, which is how earlier desktop passes drifted from the convention. Existing ids are opaque: never renumber or tidy them.',
  },
  {
    id: 'options-are-lists',
    scope: 'desktop',
    text: 'Competing options are a list, not competing segments. Three candidate trains or four candidate restaurants belong in a list, where they carry no date and no cost; promote the chosen one to a segment and set the item\'s segment_id. The schema has no notion of mutually exclusive segments, so two candidates for the same slot would both plot on the map and both count into the budget.',
  },
  {
    id: 'identity',
    scope: 'desktop',
    text: 'trip_id, updated_at, forked_from and schema_version are the app\'s bookkeeping — never hand-edit them. rev is the one sanctioned exception, and only via `npm run itin -- bump`, which exists because a re-uploaded file whose rev did not move is indistinguishable from a genuine divergence.',
  },
  {
    id: 'validate-before-handback',
    scope: 'desktop',
    text: 'A file you edited is not finished until `make validate FILE=<path>` is clean. Schema errors are fatal. Lint warnings are advisory — say what they are rather than swallowing them, since they catch the things hand editing breaks: duplicate ids, a segment_id pointing at a segment that no longer exists, payments that do not sum to their total.',
  },
  {
    id: 'filenames',
    scope: 'desktop',
    text: 'Itinerary files may live outside the planner checkout, including a private research workspace. Accept an explicit file path. For numbered snapshots, read the highest N and write the next snapshot without overwriting the previous version. The latest completed snapshot is the one to upload.',
  },
  {
    id: 'privacy',
    scope: 'desktop',
    text: 'Real itineraries and research belong in a private workspace or the planner’s ignored data/ directory. Never copy personal trip data into public examples, tests, documentation, commit messages or PRs. In a private workspace, save the requested trip files through its documented persistence workflow.',
  },
];

/** The surfaces a rule can reach. */
export const SURFACES = ['app', 'desktop', 'mcp'];

/** Whether `rule` reaches `surface`. */
export function reaches(rule, surface) {
  return rule.scope === 'all' || rule.scope === surface
    || (Array.isArray(rule.scope) && rule.scope.includes(surface));
}

/** The doctrine as prompt/markdown bullet lines, for one surface. Entries keep
    their array order so the app's prompt prefix stays byte-stable across calls
    (issue #24: implicit prompt caching keys on it). */
export function renderDoctrine(target) {
  if (!SURFACES.includes(target))
    throw new Error(`renderDoctrine: unknown target "${target}" (expected one of ${SURFACES.join(', ')})`);
  return DOCTRINE
    .filter(rule => reaches(rule, target))
    .map(rule => '- ' + rule.text)
    .join('\n');
}
