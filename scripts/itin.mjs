// Terminal entry point for working on itinerary files in this repo.
//
// The browser app validates an upload with ajv and lints it advisorily
// (src/validate.js, src/ai/preview.js), but desktop editing had neither — the
// first thing to check a hand-edited file was the upload screen on a phone.
// docs/migrating-2.x-to-3.0.0.md already told the reader to do "an ajv run
// against schema/holiday_itinerary_schema.json"; this is that run.
//
// All the interpretation is reused from src/lib/ (pure, unit-tested); this file
// owns only argument parsing, file I/O and formatting. ajv deliberately stays
// out of src/lib/: lib/ is the browser bundle's pure logic, and a node-only ajv
// wrapper living there would be one careless import away from a second copy of
// ajv in the single-file output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { lintItinerary } from '../src/lib/lint.js';
import { itineraryDigest } from '../src/lib/digest.js';
import { condenseSchema } from '../src/lib/schema-brief.js';
import { renderDoctrine } from '../src/lib/doctrine.js';
import { newId } from '../src/lib/ids.js';
import { takenListIds, takenItemIds } from '../src/lib/lists.js';
import { takenGroupIds, takenPhraseIds } from '../src/lib/phrases.js';
import {
  decodeShare, shareDocument, shareUrl, isOverlong, SHARE_WARN_CHARS,
} from '../src/lib/sharelink.js';

const SCHEMA_URL = new URL('../schema/holiday_itinerary_schema.json', import.meta.url);
const SKILL_URL = new URL('../.claude/skills/itinerary-authoring/SKILL.md', import.meta.url);
const draft7 = 'http://json-schema.org/draft-07/schema#';

export const schema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));

/* --- validators, in the same shapes src/validate.js compiles ------------- */

/** Segment type → definition name. Mirrors src/validate.js: a segment is
    checked against the ONE subschema its type names, because under the oneOf
    ajv reports every branch's failures and a half-filled event comes back
    demanding transport's "mode" and "departs" (issue #76). */
const SEG_DEFS = { transport: 'TransportSegment', accommodation: 'AccommodationSegment', event: 'EventSegment' };

let compiled = null;
function validators() {
  if (compiled) return compiled;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const sub = body => ajv.compile({ $schema: draft7, definitions: schema.definitions, ...body });
  const byType = {};
  for (const [type, def] of Object.entries(SEG_DEFS)) byType[type] = sub({ $ref: '#/definitions/' + def });
  compiled = {
    doc: ajv.compile(schema),
    segByType: byType,
    // Fallback for a segment naming no known type — the oneOf is the only thing
    // that can say "this is not any kind of segment".
    segAny: sub({ oneOf: Object.values(SEG_DEFS).map(d => ({ $ref: '#/definitions/' + d })) }),
  };
  return compiled;
}

const errLine = e => `${e.instancePath || '/'} ${e.message}`;

/* --- checking ------------------------------------------------------------ */

/** The MAJOR of a semver-ish string, or null when it isn't one. */
function major(version) {
  const m = /^(\d+)\./.exec(String(version || ''));
  return m ? m[1] : null;
}

function segLabel(seg, i) {
  return (seg && seg.id) ? `segment "${seg.id}"` : `segment ${i + 1}`;
}

/**
 * Schema-validate and lint one already-parsed document.
 *
 * Returns `{schemaErrors, warnings, identity, counts}`. Schema errors are
 * fatal; lint warnings are advisory, exactly as in the app — src/ai/preview.js
 * never lets a lint warning block Apply.
 */
export function checkDoc(doc) {
  const v = validators();
  const schemaErrors = [];

  // A major-version mismatch is its own error rather than a pile of confusing
  // schema failures, and points at the migration doc — the same call
  // src/app.js's version guard makes on load.
  const docMajor = major(doc && doc.schema_version);
  if (docMajor !== null && docMajor !== major(schema.version))
    schemaErrors.push(`schema_version ${doc.schema_version} is a different major version than the repo schema (${schema.version}) — see docs/migrating-2.x-to-3.0.0.md`);

  if (!v.doc(doc)) {
    // Document-level errors, minus everything under /segments/: those get
    // re-derived per segment below, where the message is actually usable.
    for (const e of v.doc.errors || [])
      if (!String(e.instancePath || '').startsWith('/segments/')) schemaErrors.push(errLine(e));

    const segments = Array.isArray(doc && doc.segments) ? doc.segments : [];
    segments.forEach((seg, i) => {
      const validate = (seg && v.segByType[seg.type]) || v.segAny;
      if (validate(seg)) return;
      for (const e of validate.errors || []) schemaErrors.push(`${segLabel(seg, i)} ${errLine(e)}`);
    });
  }

  const count = (key, inner) => {
    const arr = Array.isArray(doc && doc[key]) ? doc[key] : [];
    if (!inner) return arr.length;
    return arr.reduce((n, x) => n + ((x && Array.isArray(x[inner])) ? x[inner].length : 0), 0);
  };

  return {
    schemaErrors,
    warnings: lintItinerary(doc),
    identity: {
      name: (doc && doc.trip && doc.trip.name) || '(unnamed)',
      trip_id: (doc && doc.trip_id) || null,
      rev: (doc && doc.rev) || null,
      schema_version: (doc && doc.schema_version) || null,
      updated_at: (doc && doc.updated_at) || null,
      updated_by: (doc && doc.updated_by) || null,
    },
    counts: {
      segments: count('segments'),
      lists: count('lists'),
      items: count('lists', 'items'),
      phraseGroups: count('phrases'),
      phrases: count('phrases', 'items'),
    },
  };
}

/** checkDoc for a path, with parse and read failures reported the same way as
    schema failures so one bad file never takes the whole run down. */
export function checkFile(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { path, unreadable: e.message, schemaErrors: [], warnings: [] };
  }
  return { path, doc, ...checkDoc(doc) };
}

/* --- reporting ---------------------------------------------------------- */

/** The identity line leads every report: data/ holds several hand-versioned
    snapshots of ONE trip_id at different revs, so "which of these do I upload"
    is the question a report has to answer first. */
function identityLine(id) {
  const bits = [id.name];
  if (id.trip_id) bits.push('trip_id ' + id.trip_id);
  if (id.rev) bits.push('rev ' + id.rev);
  if (id.schema_version) bits.push('schema ' + id.schema_version);
  if (id.updated_at) bits.push('updated ' + id.updated_at);
  if (id.updated_by) bits.push('by ' + id.updated_by);
  return bits.join('  ');
}

export function formatReport(reports) {
  const out = [];
  for (const r of reports) {
    out.push(r.path);
    if (r.unreadable) {
      out.push(`  ✗ unreadable: ${r.unreadable}`);
      continue;
    }
    out.push('  ' + identityLine(r.identity));
    for (const e of r.schemaErrors) out.push(`  ✗ schema: ${e}`);
    for (const w of r.warnings) out.push(`  ! lint: ${w}`);
    const c = r.counts;
    out.push(`  ${c.segments} segments, ${c.lists} lists (${c.items} items), ${c.phraseGroups} phrase groups (${c.phrases} phrases)`);
    if (!r.schemaErrors.length && !r.warnings.length) out.push('  ✓ valid, no warnings');
  }
  return out.join('\n');
}

/** Exit code: schema errors fail, lint warnings do not — the app treats lint as
    advisory too. --strict promotes warnings, for a stricter gate. */
export function exitCode(reports, strict) {
  const bad = reports.some(r => r.unreadable || r.schemaErrors.length || (strict && r.warnings.length));
  return bad ? 1 : 0;
}

/* --- subcommands -------------------------------------------------------- */

function readDoc(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const TAKEN = {
  'seg-': doc => new Set((Array.isArray(doc.segments) ? doc.segments : []).map(s => s && s.id).filter(Boolean)),
  'list-': takenListIds,
  'li-': takenItemIds,
  'phr-': takenGroupIds,
  'ph-': takenPhraseIds,
};

function cmdIds(args) {
  const [path, rawPrefix, rawN] = args;
  if (!path || !rawPrefix) return usage('ids needs a file and a prefix');
  const prefix = rawPrefix.endsWith('-') ? rawPrefix : rawPrefix + '-';
  const taken = TAKEN[prefix];
  if (!taken) return usage(`unknown id prefix "${prefix}" (expected one of ${Object.keys(TAKEN).join(' ')})`);
  const n = Math.max(1, parseInt(rawN || '1', 10) || 1);
  const used = taken(readDoc(path));
  const made = [];
  // Thread `taken` so the batch cannot collide with itself, not just with the file.
  for (let i = 0; i < n; i++) { const id = newId(prefix, used); used.add(id); made.push(id); }
  console.log(made.join('\n'));
  return 0;
}

const DOCTRINE_BEGIN = '<!-- doctrine:begin';
const DOCTRINE_END = '<!-- doctrine:end -->';

/** The generated block as it must appear in SKILL.md. Markdown cannot import
    lib/doctrine.js the way src/ai/prompt.js does, so the desktop half of the
    doctrine is generated into the file and guarded by a unit test rather than
    rendered at read time. */
export function doctrineBlock() {
  return [
    `${DOCTRINE_BEGIN} — generated from src/lib/doctrine.js; run \`npm run itin -- doctrine --write\` -->`,
    renderDoctrine('desktop'),
    DOCTRINE_END,
  ].join('\n');
}

/** Replace the marked block in `md`, or throw if the markers aren't both there
    exactly once — silently appending would produce a file with two blocks, one
    of them stale. */
export function replaceDoctrineBlock(md) {
  const start = md.indexOf(DOCTRINE_BEGIN);
  const end = md.indexOf(DOCTRINE_END);
  if (start === -1 || end === -1)
    throw new Error(`SKILL.md is missing the "${DOCTRINE_BEGIN} ... -->" / "${DOCTRINE_END}" markers`);
  if (end < start) throw new Error('SKILL.md has the doctrine markers in the wrong order');
  if (md.indexOf(DOCTRINE_BEGIN, start + 1) !== -1 || md.indexOf(DOCTRINE_END, end + 1) !== -1)
    throw new Error('SKILL.md has more than one doctrine marker pair');
  return md.slice(0, start) + doctrineBlock() + md.slice(end + DOCTRINE_END.length);
}

function cmdDoctrine(args) {
  if (!args.includes('--write')) { console.log(doctrineBlock()); return 0; }
  const md = readFileSync(SKILL_URL, 'utf8');
  const next = replaceDoctrineBlock(md);
  if (next === md) { console.log('SKILL.md doctrine block already up to date.'); return 0; }
  writeFileSync(SKILL_URL, next);
  console.log('Updated the doctrine block in .claude/skills/itinerary-authoring/SKILL.md');
  return 0;
}

/**
 * rev + 1 and a fresh updated_at, so a desktop round-trip does not land as a
 * fork.
 *
 * The app classifies same trip_id + same rev + different content as divergence
 * (classifyImport in src/lib/library.js), and offers "Keep both" FIRST for a
 * fork — which mints a new trip_id. An edit here that leaves rev alone is
 * exactly that signature, so re-uploading it sits one tap from splitting the
 * trip into two revision chains. A higher rev classifies as "newer" instead,
 * where Replace is the primary action and persist() takes the incoming document
 * as-is (library.js honours a higher incoming rev).
 *
 * This is not a view or a form writing identity fields — it is a file editor
 * handing the app a completed next revision, which is what rev counts.
 * trip_id, forked_from and schema_version are never touched.
 */
export function bumpDoc(doc, now = new Date()) {
  const rev = Number.isInteger(doc.rev) && doc.rev >= 1 ? doc.rev : 1;
  return { ...doc, rev: rev + 1, updated_at: now.toISOString() };
}

function cmdBump(args) {
  const paths = args.filter(a => !a.startsWith('--'));
  const outFlag = args.indexOf('--out');
  const out = outFlag === -1 ? null : args[outFlag + 1];
  const path = paths[0];
  if (!path) return usage('bump needs a file');

  const report = checkFile(path);
  if (report.unreadable || report.schemaErrors.length) {
    console.error(formatReport([report]));
    console.error('\nRefusing to bump: fix the schema errors first — bumping rev is the "this file is finished" signal.');
    return 1;
  }
  const next = bumpDoc(report.doc);
  const target = out || path;
  writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
  console.log(`${target}  rev ${report.identity.rev || 1} → ${next.rev}  updated_at ${next.updated_at}`);
  if (target === path) console.log('(written in place)');
  return 0;
}

/* --- share links: the way a trip reaches a machine with no data/ ---------- */

/**
 * Share links (issue #81) are how a document moves without a filesystem, and
 * that makes them the way in and out of a session running somewhere other than
 * the user's own machine — a Claude Code cloud session cloned from GitHub has
 * no `data/` at all, because it is gitignored real personal data.
 *
 * The encoding is src/lib/sharelink.js and src/lib/codec.js, imported here
 * rather than reimplemented: they are pure, and they lean on CompressionStream,
 * TextEncoder, btoa/atob and Response, all of which are node globals from 18
 * on. So the payload this writes is byte-identical to the one the browser
 * writes, and a scheme added there works here for free.
 */
const DEFAULT_BASE = 'https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html';
const DEFAULT_OUT = 'data/incoming.json';

/** A flag's value, or null when it is absent or another flag followed it —
    `--decode --out x` is a missing link, not a link named "--out". */
function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  return (v === undefined || v.startsWith('--')) ? null : v;
}

/** Everything after the first `#`. Accepts a whole share URL or a bare
    fragment: readShareFragment only understands the latter, and what the user
    has on their phone is the former. */
export function fragmentOf(input) {
  const s = String(input || '').trim();
  const cut = s.indexOf('#');
  return cut === -1 ? s : s.slice(cut + 1);
}

/** The share link for a document, stamped with the repo schema's version —
    the CLI's counterpart to what src/share.js does with the build's constant,
    so a link made here meets the same version guard on the way back in. */
export function linkFor(doc, base = DEFAULT_BASE) {
  return shareUrl(base, shareDocument(doc, schema.version));
}

export async function linkDecode(link, out) {
  // decodeShare throws the UI copy ("The link is damaged or incomplete") for a
  // truncated link, which is exactly what should surface: a link that arrived
  // short must say so rather than yield an empty trip.
  const doc = await decodeShare(fragmentOf(link));
  const dir = dirname(out);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${out}`);

  // Written even when it fails to validate — an incoming document you have to
  // FIX has to land on disk first. Reported through the same checker `validate`
  // uses, so there is one description of what is wrong with a file.
  const report = checkFile(out);
  console.log(formatReport([report]));
  return exitCode([report], false);
}

export async function linkEncode(path, base = DEFAULT_BASE) {
  const report = checkFile(path);
  if (report.unreadable || report.schemaErrors.length) {
    console.error(formatReport([report]));
    console.error('\nRefusing to encode: fix the schema errors first — handing back a link is the "this file is finished" signal, same as bump.');
    return 1;
  }
  // Identity rides along untouched: it is what lets the link land on the trip
  // it came from. Bump first (§3 of the authoring skill) or it imports as a fork.
  const url = await linkFor(report.doc, base);
  console.error(formatReport([report]));
  if (isOverlong(url))
    console.error(`\n! ${url.length} characters, over ${SHARE_WARN_CHARS} — some messaging apps truncate a link this long silently.`);
  console.log(url);
  return 0;
}

async function cmdLink(args) {
  const decode = flagValue(args, '--decode');
  const encode = flagValue(args, '--encode');
  if (decode && encode) return usage('link takes --decode or --encode, not both');
  if (decode) return linkDecode(decode, flagValue(args, '--out') || DEFAULT_OUT);
  if (encode) return linkEncode(encode, flagValue(args, '--base') || DEFAULT_BASE);
  return usage('link needs --decode <url> or --encode <file>');
}

function cmdValidate(args) {
  const strict = args.includes('--strict');
  const paths = args.filter(a => !a.startsWith('--'));
  if (!paths.length) return usage('validate needs at least one file');
  const reports = paths.map(checkFile);
  console.log(formatReport(reports));
  return exitCode(reports, strict);
}

function cmdDigest(args) {
  const [path] = args;
  if (!path) return usage('digest needs a file');
  console.log(itineraryDigest(readDoc(path)));
  return 0;
}

function cmdSchemaBrief() {
  console.log(condenseSchema(schema));
  return 0;
}

/* --- entry point -------------------------------------------------------- */

const COMMANDS = {
  validate: cmdValidate,
  digest: cmdDigest,
  'schema-brief': cmdSchemaBrief,
  ids: cmdIds,
  doctrine: cmdDoctrine,
  bump: cmdBump,
  link: cmdLink,
};

function usage(problem) {
  if (problem) console.error('Error: ' + problem + '\n');
  console.error(`Usage: node scripts/itin.mjs <command> [args]

  validate <file...> [--strict]   ajv against the repo schema, then lint.
                                  Schema errors exit 1; lint warnings are
                                  advisory unless --strict.
  digest <file>                   One line per segment — orient on a trip
                                  without reading the whole file.
  schema-brief                    Condensed schema reference.
  ids <file> <prefix> [n]         n fresh ids that collide with nothing in the
                                  file. Prefixes: ${Object.keys(TAKEN).join(' ')}
  doctrine [--write]              Print the desktop doctrine, or sync it into
                                  the authoring skill.
  bump <file> [--out <path>]      rev + 1 and a fresh updated_at, so an edited
                                  file does not re-import as a fork.
  link --decode <url> [--out <path>]
                                  Write the document a share link carries to a
                                  file (default ${DEFAULT_OUT}), then check it.
  link --encode <file> [--base <url>]
                                  A share link for the file — the way to hand a
                                  trip back where there is no filesystem to
                                  share. Bump first, or it imports as a fork.`);
  return problem ? 1 : 0;
}

// Async because the share-link codec is: CompressionStream is a stream API, so
// encodeShare/decodeShare return promises. Every other command stays
// synchronous and simply resolves immediately.
async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') return usage();
  const run = COMMANDS[cmd];
  if (!run) return usage(`unknown command "${cmd}"`);
  try {
    return await run(args);
  } catch (e) {
    console.error('Error: ' + e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(await main(process.argv.slice(2)));
