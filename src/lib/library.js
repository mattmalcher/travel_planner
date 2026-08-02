/**
 * The trip library (issue #80): the app holds several documents and flips
 * between them, instead of one `hItinerary` slot where loading a second trip
 * evicted the first.
 *
 * Everything about *storage* lives here, and nothing about the DOM does. The
 * store is a parameter — any `{getItem, setItem, removeItem}` — so the whole
 * module, quota handling included, is unit-testable with a plain object and a
 * fixed clock. `src/store.js` binds it to localStorage and to lib/codec.js.
 *
 * Layout:
 *   hTrips          index: [{trip_id, name, start, end, rev, updated_at, updated_by}]
 *                   — cheap to read on boot without parsing every document.
 *                   Derived, never authoritative: rebuilt from the document on
 *                   every save, so a rename in the trip editor needs no second
 *                   write path.
 *   hTrip:<id>      the working copy, uncompressed for a fast boot
 *   hTripHist:<id>  the revisions this trip has left behind, compressed
 *                   (see lib/codec.js)
 *   hCurrentTrip    which trip to restore on boot
 *   hItinerary      the pre-library single slot, migrated once and then left
 *                   alone as a backup for one release
 *
 * The in-memory shape is unchanged: `state.HD` is still the one loaded
 * document, and only the save/boot paths know the rest exists.
 */

export const INDEX_KEY = 'hTrips';
export const DOC_PREFIX = 'hTrip:';
export const HIST_PREFIX = 'hTripHist:';
export const CURRENT_KEY = 'hCurrentTrip';
export const LEGACY_KEY = 'hItinerary';
export const MIGRATED_KEY = 'hTripsMigrated';

/** Superseded revisions kept per trip. ~50 compressed revisions of a two-week
    trip is ~300 kB, comfortable inside a ~2.5M-character localStorage budget. */
export const HISTORY_CAP = 50;

/** Saves closer together than this collapse into one history entry, so a
    fiddly afternoon of small edits doesn't burn 30 of the 50 slots. */
export const COALESCE_MS = 5 * 60 * 1000;

/* --- identity ------------------------------------------------------------ */

/** Fields that describe the *document* rather than the holiday, and so are
    excluded when asking "is this the same content?". */
const META_FIELDS = ['schema_version', 'trip_id', 'rev', 'updated_at', 'updated_by'];

export function docKey(tripId) { return DOC_PREFIX + tripId; }
export function histKey(tripId) { return HIST_PREFIX + tripId; }

/** JSON with object keys in a fixed order, so two equal documents always
    serialise identically and content comparison is reliable. */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** A 64-bit-ish hex digest (two FNV-1a passes with different offset bases).
    Not cryptographic — it only has to be stable across devices and unlikely
    to collide between different trips. */
export function hash64(str) {
  const fnv = (seed) => {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  return fnv(0x811c9dc5).toString(16).padStart(8, '0') + fnv(0x7fffffff).toString(16).padStart(8, '0');
}

/** The document's content, with the identity/meta fields stripped. */
export function contentOf(doc) {
  const rest = { ...(doc || {}) };
  for (const f of META_FIELDS) delete rest[f];
  return stableStringify(rest);
}

export function sameContent(a, b) { return contentOf(a) === contentOf(b); }

/** A fresh trip id. A uuid where the platform offers one; the fallback is
    uuid-shaped so stored ids all look alike. */
export function newTripId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.random() * 16 | 0;
    return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * The id for a document written before `trip_id` existed. Derived from the
 * trip's name and dates rather than minted, so the same old file imported on
 * two devices lands in the same trip instead of splitting into two that can
 * never be reconciled.
 */
export function legacyTripId(doc) {
  const trip = (doc && doc.trip) || {};
  return 'trip-' + hash64([trip.name || '', trip.start || '', trip.end || ''].join('|'));
}

/** The fields nextRevision settles. Everything else about a document is
    content. */
export const IDENTITY_FIELDS = ['trip_id', 'rev', 'updated_at', 'updated_by'];

/**
 * Copy the settled identity fields onto the document the app already has
 * loaded, so saving never swaps `state.HD` for a different object — views hold
 * references to it (the Lists view's undo compares them). The one function
 * here that writes to its argument, and only these four keys.
 */
export function copyIdentity(target, source) {
  for (const f of IDENTITY_FIELDS) {
    if (source[f] === undefined) delete target[f];
    else target[f] = source[f];
  }
  return target;
}

/** `doc` with the given meta values applied, dropping the ones left undefined
    (an absent `updated_by` should stay absent, not become `undefined`). */
function withMeta(doc, meta) {
  const out = { ...doc };
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') delete out[k];
    else out[k] = v;
  }
  return out;
}

/** `doc` with any missing identity fields filled in — a trip_id (deterministic
    for a legacy document), rev 1, and a timestamp. */
export function withIdentity(doc, { nowIso }) {
  const out = { ...doc };
  if (!out.trip_id) out.trip_id = legacyTripId(out);
  if (!Number.isInteger(out.rev) || out.rev < 1) out.rev = 1;
  if (!out.updated_at) out.updated_at = nowIso;
  return out;
}

/**
 * What to write when saving `doc` over `stored` (the working copy already in
 * the library, or null). Returns `{doc, changed}` — `changed` is whether this
 * is a new revision, and so whether it earns a history entry.
 *
 * `rev` is bumped only on a *real* change: persist() is the single write path
 * and runs on every load, so bumping unconditionally would inflate the counter
 * just by opening a trip. A `doc` that already declares a higher rev than the
 * store holds is taken at its word — that is an import or a restore, which
 * numbered itself deliberately.
 */
export function nextRevision(doc, stored, { nowIso, updatedBy }) {
  const base = withIdentity(doc, { nowIso });
  if (!stored) return { doc: base, changed: true };
  if (sameContent(base, stored))
    return {
      doc: withMeta(base, { rev: stored.rev, updated_at: stored.updated_at, updated_by: stored.updated_by }),
      changed: false,
    };
  if (base.rev > stored.rev) return { doc: base, changed: true };
  return {
    doc: withMeta(base, { rev: stored.rev + 1, updated_at: nowIso, updated_by: updatedBy }),
    changed: true,
  };
}

/**
 * Restoring an old revision is append-only: rev 3's *content* is saved as rev
 * 10 while at rev 9, never by rewinding the counter. A rewound rev would
 * collide with a revision the other person already has, and fork detection
 * would then call two different documents the same revision.
 */
export function restoredFrom(current, snapshot, { nowIso, updatedBy }) {
  const content = { ...snapshot };
  for (const f of META_FIELDS) delete content[f];
  return withMeta({ ...content, trip_id: current.trip_id, schema_version: current.schema_version },
    { rev: (current.rev || 1) + 1, updated_at: nowIso, updated_by: updatedBy });
}

/* --- the index ----------------------------------------------------------- */

/** The index row for a document. Rebuilt from the document on every save. */
export function entryFor(doc) {
  const trip = (doc && doc.trip) || {};
  const row = {
    trip_id: doc.trip_id,
    name: trip.name || '',
    start: trip.start || '',
    end: trip.end || '',
    rev: doc.rev || 1,
    updated_at: doc.updated_at || '',
  };
  if (doc.updated_by) row.updated_by = doc.updated_by;
  if (doc.forked_from) row.forked_from = doc.forked_from;
  return row;
}

/** Most recently edited first; `rev` then name break ties when two devices
    disagree about the clock. */
export function sortIndex(index) {
  return [...index].sort((a, b) =>
    String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || (b.rev || 0) - (a.rev || 0)
    || String(a.name || '').localeCompare(String(b.name || '')));
}

export function upsertIndex(index, entry) {
  return sortIndex([...index.filter(e => e && e.trip_id !== entry.trip_id), entry]);
}

export function removeFromIndex(index, tripId) {
  return index.filter(e => e && e.trip_id !== tripId);
}

function readJson(store, key, fallback) {
  const raw = store.getItem(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}

export function readIndex(store) {
  const v = readJson(store, INDEX_KEY, []);
  return Array.isArray(v) ? v.filter(e => e && e.trip_id) : [];
}

export function writeIndex(store, index) {
  safeSetItem(store, INDEX_KEY, JSON.stringify(sortIndex(index)));
}

export function readDoc(store, tripId) {
  return tripId ? readJson(store, docKey(tripId), null) : null;
}

export function currentTripId(store) {
  return store.getItem(CURRENT_KEY) || null;
}

export function setCurrentTripId(store, tripId) {
  if (tripId) safeSetItem(store, CURRENT_KEY, tripId);
  else store.removeItem(CURRENT_KEY);
}

/* --- quota: history is expendable, the working copy is not --------------- */

/** localStorage's quota error, under the names the engines use for it. */
export function isQuotaError(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError'
    || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || e.code === 22 || e.code === 1014;
}

/**
 * Drop the single oldest revision in the library. Returns false when there is
 * no history left anywhere, which is the signal that a failing write cannot be
 * rescued by pruning.
 */
export function pruneOldestHistory(store) {
  let oldest = null;
  for (const entry of readIndex(store)) {
    const list = readHistory(store, entry.trip_id);
    if (list.length && (!oldest || (list[0].at || 0) < (oldest.at || 0)))
      oldest = { trip_id: entry.trip_id, at: list[0].at, list };
  }
  if (!oldest) return false;
  oldest.list.shift();
  try { store.setItem(histKey(oldest.trip_id), JSON.stringify(oldest.list)); }
  catch (e) { store.removeItem(histKey(oldest.trip_id)); } // shrinking still didn't fit: drop the lot
  return true;
}

/**
 * setItem that treats a full quota as a reason to spend history rather than to
 * lose the write. Mobile Safari is the binding constraint (~5 MB per origin,
 * counted in UTF-16 code units, and effectively zero in private browsing), so
 * a save that doesn't fit prunes the oldest revisions and tries again, and
 * only a working copy that still won't fit surfaces as an error.
 */
export function safeSetItem(store, key, value) {
  for (;;) {
    try { store.setItem(key, value); return; }
    catch (e) {
      if (!isQuotaError(e) || !pruneOldestHistory(store)) throw e;
    }
  }
}

/* --- revision history --------------------------------------------------- */

export function readHistory(store, tripId) {
  const v = readJson(store, histKey(tripId), []);
  return Array.isArray(v) ? v.filter(e => e && typeof e.data === 'string') : [];
}

export function writeHistory(store, tripId, list) {
  if (list.length) safeSetItem(store, histKey(tripId), JSON.stringify(list));
  else store.removeItem(histKey(tripId));
}

/**
 * `list` with `entry` — the revision a save has just superseded — added:
 * oldest first, and capped.
 *
 * A save inside `coalesceMs` of the last entry recorded adds nothing. What a
 * burst of edits leaves behind is the state the burst *started* from, which is
 * the one worth winding back to; keeping the latest instead would spend a slot
 * on every keystroke and still leave nothing to return to. A rev already at the
 * head is likewise not recorded twice.
 */
export function nextHistory(list, entry, { cap = HISTORY_CAP, coalesceMs = COALESCE_MS } = {}) {
  const head = list[list.length - 1];
  if (head && (head.rev === entry.rev || (entry.at - (head.at || 0)) < coalesceMs)) return list;
  const out = [...list, entry];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** The metadata half of a history entry — what the picker shows without
    having to decompress anything. */
export function historyMeta(doc, nowMs) {
  const row = { rev: doc.rev || 1, updated_at: doc.updated_at || '', at: nowMs };
  if (doc.updated_by) row.updated_by = doc.updated_by;
  return row;
}

/* --- import decisions --------------------------------------------------- */

/**
 * What importing `incoming` means when the library already holds `stored` for
 * the same trip_id (null when it doesn't). Importing is a decision rather than
 * a silent overwrite:
 *   new        nothing here by that id — just load it
 *   duplicate  same content, so re-opening the same link is a no-op
 *   newer      a later revision of a trip already held → replace or keep both
 *   older      an earlier revision than the one held
 *   fork       the same rev with different content: two people edited rev 7
 *              and both produced a rev 8, which is divergence, not newness
 */
export function classifyImport(incoming, stored) {
  if (!stored) return { kind: 'new' };
  if (sameContent(incoming, stored)) return { kind: 'duplicate', rev: stored.rev };
  const mine = stored.rev || 1;
  const theirs = incoming.rev || 1;
  if (theirs > mine) return { kind: 'newer', rev: theirs, mine };
  if (theirs < mine) return { kind: 'older', rev: theirs, mine };
  return { kind: 'fork', rev: theirs, mine };
}

/**
 * Keep both: the incoming document becomes its own trip, with a new trip_id
 * and a note of where it came from. One trip stays one id and one revision
 * chain — a second entry sharing the id would make the revision history of
 * either copy meaningless.
 */
export function forkOf(doc, { tripId = newTripId(), nowIso, updatedBy } = {}) {
  return withMeta({ ...doc, trip_id: tripId, forked_from: { trip_id: doc.trip_id, rev: doc.rev || 1 } },
    { updated_at: nowIso, updated_by: updatedBy });
}

/* --- writes -------------------------------------------------------------- */

/**
 * Write `doc` as the library's working copy for its trip and rebuild its index
 * row. Synchronous and quota-guarded; the (compressed, therefore async)
 * history entry is a separate step, because losing a revision matters less
 * than losing the save.
 */
export function writeDoc(store, doc, { current = true } = {}) {
  safeSetItem(store, docKey(doc.trip_id), JSON.stringify(doc));
  writeIndex(store, upsertIndex(readIndex(store), entryFor(doc)));
  if (current) setCurrentTripId(store, doc.trip_id);
}

/** Forget one trip: its working copy, its history and its index row. */
export function deleteTrip(store, tripId) {
  store.removeItem(docKey(tripId));
  store.removeItem(histKey(tripId));
  writeIndex(store, removeFromIndex(readIndex(store), tripId));
  if (currentTripId(store) === tripId) store.removeItem(CURRENT_KEY);
}

/** Forget the whole library — the explicit wipe that reset() used to be. */
export function clearLibrary(store) {
  for (const entry of readIndex(store)) {
    store.removeItem(docKey(entry.trip_id));
    store.removeItem(histKey(entry.trip_id));
  }
  store.removeItem(INDEX_KEY);
  store.removeItem(CURRENT_KEY);
  store.removeItem(LEGACY_KEY);
  store.removeItem(MIGRATED_KEY);
}

/**
 * Bring a pre-library `hItinerary` value into the library, once. It becomes
 * the first entry rather than being discarded, and the old key is left in
 * place for a release as a backup — the marker key, not the absence of the
 * old value, is what stops it being re-imported (so deleting the migrated
 * trip doesn't resurrect it on the next boot).
 *
 * Returns the migrated document, or null when there was nothing to do.
 */
export function migrateLegacy(store, { nowIso }) {
  if (store.getItem(MIGRATED_KEY)) return null;
  const raw = store.getItem(LEGACY_KEY);
  if (!raw) return null; // nothing to bring over, and so nothing to mark done
  try { store.setItem(MIGRATED_KEY, '1'); } catch (e) { /* private browsing: retry next boot */ }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return null; }
  if (!doc || typeof doc !== 'object' || !doc.trip) return null;
  const settled = withIdentity(doc, { nowIso });
  if (readIndex(store).some(e => e.trip_id === settled.trip_id)) return null;
  writeDoc(store, settled, { current: !currentTripId(store) });
  return settled;
}
