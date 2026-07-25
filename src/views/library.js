/**
 * The trip library's UI (issue #80): the switcher in the header, the same rows
 * as a "recent trips" list on the upload screen, and each row's revision
 * history underneath it.
 *
 * One row renderer serves both places, so expanding a trip's revisions works
 * on the upload screen as well as in the switcher — a returning visit is one
 * tap, including a tap back to how the trip looked yesterday.
 */
import { state } from '../state.js';
import { esc } from '../lib/escape.js';
import { fmtDate, timeAgo } from '../lib/dates.js';
import {
  savedTrips, savedTrip, revisions, revisionDoc, restoreRevision,
  forget, forgetEverything, updatedBy, setUpdatedBy, persist,
} from '../store.js';
import { load, closeTrip, downloadDoc } from '../app.js';

/** Trips whose revision list is open. UI state only — nothing stored. */
const expanded = new Set();

/** How many trips the upload screen lists before it stops being a shortcut. */
const RECENT_SHOWN = 6;

const dateRange = e => (e.start && e.end)
  ? `${fmtDate(e.start)} – ${fmtDate(e.end)}`
  : (e.start ? fmtDate(e.start) : '');

/** "rev 9, edited 20 minutes ago by Sarah" — with each half dropped when the
    document doesn't carry it (a legacy import has no updated_by). */
function metaLine(entry, nowMs) {
  const bits = [`rev ${entry.rev || 1}`];
  const ago = timeAgo(entry.updated_at, nowMs);
  if (ago) bits.push(`edited ${ago}${entry.updated_by ? ` by ${entry.updated_by}` : ''}`);
  else if (entry.updated_by) bits.push(`edited by ${entry.updated_by}`);
  return bits.join(', ');
}

function revisionRows(tripId) {
  const list = revisions(tripId);
  if (!list.length)
    return '<div class="hlib-rev hlib-none">No earlier revisions saved yet</div>';
  // Newest first, matching the trip rows above.
  return [...list].reverse().map(r => `<div class="hlib-rev">
      <span class="hlib-rev-meta">rev ${r.rev}${r.updated_at ? ` · ${esc(new Date(r.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}${r.updated_by ? ` · ${esc(r.updated_by)}` : ''}</span>
      <button onclick="hLibRestore('${esc(tripId)}',${r.rev})" title="Restore this revision"><i class="ti ti-restore" aria-hidden="true"></i> Restore</button>
      <button onclick="hLibDownloadRev('${esc(tripId)}',${r.rev})" title="Download this revision as JSON"><i class="ti ti-download" aria-hidden="true"></i></button>
    </div>`).join('');
}

function tripRow(entry, nowMs, openId) {
  const open = entry.trip_id === openId;
  const id = esc(entry.trip_id);
  return `<div class="hlib-row${open ? ' on' : ''}">
    <button class="hlib-open" onclick="hLibSwitch('${id}')" title="${open ? 'Already open' : 'Switch to this trip'}">
      <span class="hlib-name">${esc(entry.name || 'Untitled trip')}${open ? ' <span class="hlib-tag">open</span>' : ''}${entry.forked_from ? ' <span class="hlib-tag"><i class="ti ti-git-fork" aria-hidden="true"></i> fork</span>' : ''}</span>
      <span class="hlib-meta">${esc(metaLine(entry, nowMs))}${dateRange(entry) ? ` · ${esc(dateRange(entry))}` : ''}</span>
    </button>
    <button class="hlib-icon" onclick="hLibRevs('${id}')" title="Revision history" aria-expanded="${expanded.has(entry.trip_id)}"><i class="ti ti-history" aria-hidden="true"></i></button>
    <button class="hlib-icon" onclick="hLibDelete('${id}')" title="Delete this trip" style="color:var(--color-text-danger)"><i class="ti ti-trash" aria-hidden="true"></i></button>
  </div>${expanded.has(entry.trip_id) ? `<div class="hlib-hist">${revisionRows(entry.trip_id)}</div>` : ''}`;
}

function tripRows(index, nowMs) {
  const openId = state.HD ? state.HD.trip_id : null;
  return index.map(e => tripRow(e, nowMs, openId)).join('');
}

/** The switcher's list, and the name new revisions are labelled with. */
export function renderLibrary(nowMs = Date.now()) {
  const el = document.getElementById('hlib-list');
  if (!el) return;
  const index = savedTrips();
  el.innerHTML = index.length ? tripRows(index, nowMs)
    : '<div class="hlib-none">No trips saved in this browser yet.</div>';
  const by = document.getElementById('hlib-by');
  if (by && document.activeElement !== by) by.value = updatedBy();
}

/** The upload screen's shortcut back into a trip already in the library. */
export function renderRecent(nowMs = Date.now()) {
  const el = document.getElementById('hupl-recent');
  if (!el) return;
  const index = savedTrips();
  if (!index.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const shown = index.slice(0, RECENT_SHOWN);
  const rest = index.length - shown.length;
  el.style.display = 'block';
  el.innerHTML = `<div class="hlib-hd-row">
      <span><i class="ti ti-luggage" aria-hidden="true"></i> Trips saved in this browser</span>
      ${rest > 0 ? `<button onclick="hLibOpen()" style="font-size:11px">All ${index.length}…</button>` : ''}
    </div>${tripRows(shown, nowMs)}`;
}

/** Redraw whichever of the two lists is on screen. */
export function refreshLibraryViews() {
  renderLibrary();
  renderRecent();
}

export function libOpen() {
  document.getElementById('hlib-modal').classList.add('on');
  renderLibrary();
}

export function libClose() {
  document.getElementById('hlib-modal').classList.remove('on');
}

/** Expand/collapse a trip's revision list. */
export function libRevs(tripId) {
  if (expanded.has(tripId)) expanded.delete(tripId); else expanded.add(tripId);
  refreshLibraryViews();
}

/** Switch trips: the open document is saved first, so nothing in flight is
    lost, and the chosen one becomes the current trip. */
export function libSwitch(tripId) {
  if (state.HD && state.HD.trip_id === tripId) { libClose(); return; }
  if (state.HD) persist();
  const doc = savedTrip(tripId);
  if (!doc) { refreshLibraryViews(); return; }
  libClose();
  load(doc);
}

/** Delete a trip from the library — with a confirm, like the other
    destructive actions, since the browser copy may be the only one left. */
export function libDelete(tripId) {
  const entry = savedTrips().find(e => e.trip_id === tripId);
  const name = (entry && entry.name) || 'this trip';
  const n = revisions(tripId).length;
  if (!confirm(`Delete "${name}"${n ? ` and its ${n} saved revision${n === 1 ? '' : 's'}` : ''} from this browser? `
    + 'Any downloaded copy is unaffected. This cannot be undone.')) return;
  const wasOpen = state.HD && state.HD.trip_id === tripId;
  forget(tripId);
  if (wasOpen) { libClose(); closeTrip(); }
  refreshLibraryViews();
}

/** Wind a trip back: the old revision's content is saved as a NEW revision, so
    the trip's revision chain only ever grows (see lib/library.js). */
export async function libRestore(tripId, rev) {
  const entry = savedTrips().find(e => e.trip_id === tripId);
  const at = (entry && entry.rev) || rev;
  if (!confirm(`Restore rev ${rev}? Its contents are saved as rev ${at + 1}, `
    + `so rev ${at} stays in the history.`)) return;
  const doc = await restoreRevision(tripId, rev);
  if (!doc) { alert('That revision is no longer stored.'); return; }
  libClose();
  load(doc);
}

/** Download one revision as JSON — the durable copy of an older version, and
    the thing to send someone until share links land (issue #81). */
export async function libDownloadRev(tripId, rev) {
  const doc = await revisionDoc(tripId, rev);
  if (!doc) { alert('That revision is no longer stored.'); return; }
  downloadDoc(doc, `rev${rev}`);
}

/** The label saved revisions carry ("Matt" / "Sarah"). Not an account. */
export function libSaveName() {
  const el = document.getElementById('hlib-by');
  if (el) setUpdatedBy(el.value.trim());
}

/** The explicit wipe-everything that reset() used to be before closing a trip
    stopped meaning forgetting it. */
export function libForgetAll() {
  const n = savedTrips().length;
  if (!n) return;
  if (!confirm(`Forget all ${n} trip${n === 1 ? '' : 's'} saved in this browser, with their revision histories? `
    + 'Downloaded copies are unaffected. This cannot be undone.')) return;
  forgetEverything();
  libClose();
  closeTrip();
  refreshLibraryViews();
}
