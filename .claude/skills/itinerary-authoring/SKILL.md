---
name: itinerary-authoring
description: "Use this skill when editing, extending or researching into a HolidayItinerary JSON file (data/*.json, examples/*.json) on the desktop: adding segments, geocoding stops, filling in train times, promoting list items into plans, translating a phrase group, or preparing a file to upload back into the viewer. Covers the document-authoring rules the schema cannot enforce, how ids and rev work, validating with make validate, and handing a file back without it importing as a fork."
---

# Authoring HolidayItinerary documents

## Core insight

**The schema says what is well-formed JSON. It cannot say what is a well-formed
plan.** `make validate` will happily pass a document that puts a restaurant
shortlist in `segments` (so three restaurants you haven't chosen between all
land on the map and all count into the budget), or that invents `"ref": "n/a"`
for a local bus, or that gives an all-day museum wander a made-up `10:00` start.

The three kinds of thing a document holds are the whole model, and almost every
authoring mistake is putting something in the wrong one:

| | what it is | has a date/cost? | where it shows up |
|---|---|---|---|
| `segments` | **plans** | yes | itinerary, schedule, budget, map |
| `lists` | **intentions** you tick off or promote | no | Lists tab only |
| `phrases` | **reference** you never tick off | no | Phrases tab only |

Anything that gains a date or a cost becomes a segment. Nothing in `lists` or
`phrases` is ever counted into the budget.

## Where does this thing I researched go?

```
Is it a specific plan, at a specific time?
├── yes → segment
│         ├── booked and paid          → cost.status: paid
│         ├── agreed but not booked    → cost.status: not_booked
│         └── free                     → cost.status: free
└── no
    ├── one of several options I haven't chosen between  → a list item
    ├── a thing to remember to do/buy/eat (no time)      → a list item
    └── something to be able to SAY                      → a phrase group item
```

Competing options are **a list**, never competing segments — see the doctrine
below.

## 1. The desktop loop

Real trips live in `data/`, which is **gitignored**. The chain looks like
`data/<trip>_0.1.json`, `_0.2.json`, `_0.3.json` — hand-kept snapshots of *one*
trip, not separate trips.

```bash
# 1. Orient without pulling the whole file into context
npm run itin -- digest data/<trip>_0.3.json

# 2. Read and edit the highest-numbered file, writing to the next number
#    (keeps the previous pass readable as a diff)

# 3. Check it
make validate FILE=data/<trip>_0.4.json

# 4. Mark it finished, so it doesn't import as a fork (§3)
npm run itin -- bump data/<trip>_0.4.json

# 5. Tell the user to upload that file in the viewer
```

`digest` is one line per segment — about a quarter the size of the raw JSON, and
usually all you need to find the segment you're changing. Read the full file
when you need fields the digest hides (notes, warnings, seats, payments,
coordinates).

Other things the CLI does:

```bash
npm run itin -- schema-brief             # condensed schema reference
npm run itin -- ids <file> seg 3         # 3 fresh segment ids
make validate                            # defaults to FILE=data/*.json
npm run validate -- <file> --strict      # make lint warnings fatal too
```

## 2. Ids

Never hand-write an id. Use `npm run itin -- ids <file> <prefix> [n]`, with
prefixes `seg-` `list-` `li-` `phr-` `ph-`.

Earlier desktop passes got this wrong and the evidence is still in the data:
`list-bay01` and `li-b1cat` sit alongside the app's `list-agn58` and `li-2wou4`.
Mnemonic ids are exactly what the random suffixes exist to prevent — see the
doctrine below for why.

## 3. `rev`, and the fork hazard

This is the one piece of app bookkeeping the desktop side is allowed to touch,
and it matters more than it looks.

`classifyImport` in `src/lib/library.js` decides what an uploaded file is by
comparing `trip_id` and `rev` against the copy already saved:

| incoming vs saved | classified as | primary button |
|---|---|---|
| higher `rev` | `newer` | **Replace** |
| same `rev`, different content | `fork` | **Keep both** |

A hand edit leaves `rev` alone — which is *precisely* the fork signature. And
for a fork, "Keep both" is the **first** button, and it mints a **new
`trip_id`**. So handing back an edited file without bumping puts the user one tap
from splitting their trip into two revision chains, on a phone, mid-holiday.

`npm run itin -- bump <file>` sets `rev + 1` and a fresh `updated_at`, which
makes it classify as `newer` instead. It refuses to bump a file with schema
errors, because bumping is the "this file is finished" signal. It never touches
`trip_id`, `forked_from` or `schema_version`.

**Do not bump when the divergence is real.** If the user has edited the trip on
their phone since they downloaded this file, the two copies genuinely have
diverged and forking is the correct outcome. The identity line printed by
`make validate` (`rev`, `updated_at`) is what lets you check.

Two more traps in the same area:

- **Uploading the wrong file.** `data/` holds several revs of one `trip_id`;
  uploading `_0.1` classifies as `older`. The highest `_0.N` is the one to
  upload.
- **The rev gap.** `_0.2` is rev 2 but `_0.3` is rev 4, because the app bumped
  once in the browser between passes. Never "fix" a gap — `rev` is a counter,
  not an index.

## 4. Geocoding stops

Use `/find-stop` for coordinates. Two translations to get right:

- OpenStreetMap returns `lon`; the schema uses **`lng`**.
- A `TransportStop`'s name field is **`place`** (it was `station` before schema
  3.0).

## 5. The authoring rules

These are generated from `src/lib/doctrine.js`, which is also what the in-app
assistant's system prompt renders from — one source, so the phone and the
desktop cannot drift apart. Edit that file, not this block, then run
`npm run itin -- doctrine --write`.

<!-- doctrine:begin — generated from src/lib/doctrine.js; run `npm run itin -- doctrine --write` -->
- Follow the schema exactly: required fields, enums, and the "type" const for each segment kind.
- The schema is schema/holiday_itinerary_schema.json; `npm run itin -- schema-brief` prints a short reference when the full file is more than you need. `make validate` runs the same ajv the app runs on upload, so a file that validates here will load there.
- Use 24-hour HH:MM times and YYYY-MM-DD dates. Currency codes are 3 uppercase letters; default to the trip's currency_primary (GBP for a new trip).
- Provide duration_min where the schema requires it (transport).
- Costs carry one "amount" (plus optional payments[] instalments that sum to it); a cost with status paid/pending needs an amount or payments.
- Transport ref is optional: omit it when unknown or not applicable (taxis, local buses) — never fill in placeholders like "n/a". Travel class goes in seats[] or notes if it matters. When a leg is covered by a travel pass (e.g. Interrail), define the pass once in trip.passes and set the leg's pass_id instead of abusing ref.
- Multi-day events (festivals) set end_date; timed events use time plus end_time or duration_min; genuinely all-day activities set all_day true instead of an invented time.
- Lists hold intentions that aren't (yet) plans (packing, foods to try, restaurant options); segments hold plans. List items have no date or cost — when the user schedules an item, create a normal event segment, then set that item's segment_id to the new segment's id. To tick an item off set its done flag.
- The phrasebook (phrases) holds things the traveller wants to be able to SAY, grouped by situation, with no date, cost or done flag — it is reference material, not a plan and not a checklist. A Phrase has text (the traveller's own language), local (the same thing in the local language), an optional pronunciation respelled for a reader of the traveller's language, and an optional note on when to use it. Set the group's language so it is clear which language "local" is.
- Infer reasonable values for missing details, but do not invent booking references unless asked; use status "not_booked" when something isn't confirmed.
- If a choice between valid options genuinely depends on user preference, ask rather than quietly deciding for the user.
- Do not carry the in-app assistant's rules across from src/ai/prompt.js. Its digest disclosure, its read-before-edit requirement and its prefer-a-patch rule are all mitigations for a phone that sees a one-line-per-segment digest instead of the document. Here you have the file: read it, edit it in place, and ignore all three.
- Ids are random on purpose (src/lib/ids.js): a mistyped or guessed id should miss loudly rather than resolve to whichever real record it happens to name. Mint new ones with `npm run itin -- ids <file> <prefix> [n]` — never hand-write mnemonic ids like list-bay01 or li-b1cat, which is how earlier desktop passes drifted from the convention. Existing ids are opaque: never renumber or tidy them.
- Competing options are a list, not competing segments. Three candidate trains or four candidate restaurants belong in a list, where they carry no date and no cost; promote the chosen one to a segment and set the item's segment_id. The schema has no notion of mutually exclusive segments, so two candidates for the same slot would both plot on the map and both count into the budget.
- trip_id, updated_at, forked_from and schema_version are the app's bookkeeping — never hand-edit them. rev is the one sanctioned exception, and only via `npm run itin -- bump`, which exists because a re-uploaded file whose rev did not move is indistinguishable from a genuine divergence.
- A file you edited is not finished until `make validate FILE=<path>` is clean. Schema errors are fatal. Lint warnings are advisory — say what they are rather than swallowing them, since they catch the things hand editing breaks: duplicate ids, a segment_id pointing at a segment that no longer exists, payments that do not sum to their total.
- data/<trip>_<0.N>.json is a hand-kept chain of snapshots of one trip_id, not separate trips. Read the highest N, and write a research pass to N+1 so the previous pass stays readable as a diff. The highest N is the one to upload.
- data/*.json is gitignored real personal data — real names, addresses and booking references. Never copy any of it into examples/, tests/, a commit message or a PR body; those stay fictional (the Jetsons pattern).
<!-- doctrine:end -->

## 6. Real data vs fixtures

`data/*.json` is gitignored **real personal data** — real names, addresses and
booking references. `examples/` and `tests/` are fictional (the Jetsons
pattern: "Judy Jetson", invented refs, no real private addresses).

Never move content from `data/` into `examples/`, `tests/`, a commit message or
a PR body. When you need a fixture, invent one.

## Quick reference

- [ ] Edited the **highest** `data/<trip>_0.N.json`, written to `N+1`
- [ ] Every new id came from `npm run itin -- ids`
- [ ] Shortlists went in `lists`, not `segments`
- [ ] No invented booking refs; unconfirmed things are `not_booked`
- [ ] All-day things set `all_day`, not a made-up `time`
- [ ] `make validate FILE=…` is clean, and any lint warnings were reported
- [ ] `npm run itin -- bump` run (unless the phone has diverged)
- [ ] Told the user which file to upload
