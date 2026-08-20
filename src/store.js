/**
 * localStorage binding for the trip library (issue #80): the app-level half of
 * lib/library.js, holding the single save path and the clock, the encoder and
 * the `localStorage` object that the pure module deliberately doesn't reach for.
 *
 * `persist()` lives here rather than in state.js because it now has to know
 * about the library, and state.js stays what it says it is: the shared mutable
 * state object.
 */
import { state, H_SCHEMA_VERSION } from './state.js';
import { encodeValue, decodeValue } from './lib/codec.js';
import { renderRoom } from './views/room.js';
import {
  readDoc, writeDoc, readIndex, readHistory, writeHistory, nextHistory, historyMeta,
  nextRevision, withIdentity, restoredFrom, copyIdentity, classifyImport, forkOf,
  currentTripId, setCurrentTripId, deleteTrip, clearLibrary, migrateLegacy,
  safeSetItem, isQuotaError,
} from './lib/library.js';

const store = localStorage;

/** Who the picker says last touched a trip — a free-text label, not a login. */
export function updatedBy() {
  return localStorage.getItem('hUpdatedBy') || '';
}

export function setUpdatedBy(name) {
  if (name) localStorage.setItem('hUpdatedBy', name);
  else localStorage.removeItem('hUpdatedBy');
}

/* Storage failures are reported once per load: on iOS private browsing every
   write throws, and repeating that per keystroke would be unusable. The banner
   points at the download path, which is the durable copy either way. */
let warned = false;

function reportStorageFailure(e) {
  console.warn('Could not save to this browser:', e);
  if (warned) return;
  warned = true;
  const el = document.getElementById('hstorewarn');
  if (el) el.style.display = 'flex';
}

export function dismissStoreWarning() {
  const el = document.getElementById('hstorewarn');
  if (el) el.style.display = 'none';
}

/**
 * The single write path. Settles the loaded document's identity fields, writes
 * it as the library's working copy and rebuilds its index row — then, when the
 * save superseded an earlier revision, files that earlier revision away
 * (compressed) in the background.
 *
 * The working copy write is synchronous and quota-guarded; the history write is
 * neither, because compression is async and a lost revision is a smaller loss
 * than a lost save.
 */
export function persist() {
  if (!state.HD) return;
  const nowIso = new Date().toISOString();
  const settled = withIdentity(state.HD, { nowIso });
  const stored = readDoc(store, settled.trip_id);
  const { doc, changed } = nextRevision(settled, stored, { nowIso, updatedBy: updatedBy() });
  copyIdentity(state.HD, doc);
  try {
    writeDoc(store, state.HD);
    safeSetItem(store, 'hSchemaVersion', H_SCHEMA_VERSION);
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    reportStorageFailure(e);
    return;
  }
  // "How much of this has not been shared" is `rev` against `rev_pushed`
  // (issue #124), and `rev` is settled right here — so this is the one place
  // that cannot miss a change, whichever view made it.
  renderRoom();
  if (changed && stored) recordSuperseded(stored);
}

/* Recording a revision is read-modify-write on one key, and compressing first
   makes it async — so two quick saves would otherwise both read the history as
   it was and the second would overwrite the first's entry. They queue instead. */
let recording = Promise.resolve();

/** File away the revision a save has just replaced, so the trip can be wound
    back to it. Fire-and-forget: failures are logged, never surfaced, because
    history is the expendable half of the store. */
export function recordSuperseded(doc) {
  const tripId = doc.trip_id;
  recording = recording
    .then(() => encodeValue(doc))
    .then(({ enc, data }) => {
      const entry = { ...historyMeta(doc, Date.now()), enc, data };
      writeHistory(store, tripId, nextHistory(readHistory(store, tripId), entry));
    })
    .catch(e => console.warn('Could not record a revision:', e));
  return recording;
}

/* --- reading the library ------------------------------------------------- */

export function savedTrips() { return readIndex(store); }
export function savedTrip(tripId) { return readDoc(store, tripId); }
export function currentTrip() { return currentTripId(store); }
export function revisions(tripId) { return readHistory(store, tripId); }

/** The document behind one history entry (decompressing it), or null. */
export function revisionDoc(tripId, rev) {
  const entry = readHistory(store, tripId).find(e => e.rev === rev);
  return entry ? decodeValue(entry) : Promise.resolve(null);
}

/** The trip to open on boot: the last one open, else the most recently edited.
    Null when the library is empty. */
export function bootTripId() {
  const index = readIndex(store);
  const current = currentTripId(store);
  if (current && index.some(e => e.trip_id === current)) return current;
  return index.length ? index[0].trip_id : null;
}

/* --- changing the library ----------------------------------------------- */

export function forget(tripId) { deleteTrip(store, tripId); }
export function forgetEverything() { clearLibrary(store); }
export function closeCurrent() { setCurrentTripId(store, null); }

/** Bring a pre-library `hItinerary` value in as the first library entry. */
export function migrate() {
  return migrateLegacy(store, { nowIso: new Date().toISOString() });
}

/** What importing `doc` would mean given what the library already holds. */
export function importKind(doc) {
  const settled = withIdentity(doc, { nowIso: new Date().toISOString() });
  return { doc: settled, ...classifyImport(settled, readDoc(store, settled.trip_id)) };
}

/** Keep both: `doc` becomes a separate trip recording where it came from. */
export function asFork(doc) {
  return forkOf(doc, { nowIso: new Date().toISOString(), updatedBy: updatedBy() });
}

/**
 * The content of revision `rev` as the trip's next revision (append-only —
 * see restoredFrom). Resolves to the document to load, or null when the
 * revision has gone (coalesced or pruned).
 */
export async function restoreRevision(tripId, rev) {
  const snapshot = await revisionDoc(tripId, rev);
  if (!snapshot) return null;
  const current = readDoc(store, tripId) || snapshot;
  return restoredFrom(current, snapshot, {
    nowIso: new Date().toISOString(), updatedBy: updatedBy(),
  });
}
