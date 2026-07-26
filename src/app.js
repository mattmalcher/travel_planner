// Top-level app behaviour: loading files, tab switching, the edit modal
// (form + raw JSON), download, and the saved-data schema-version guard.
import { state, major, H_SCHEMA_VERSION } from './state.js';
import {
  persist, savedTrip, savedTrips, bootTripId, importKind, asFork,
  migrate, closeCurrent, forgetEverything, dismissStoreWarning,
} from './store.js';
import { renderRecent } from './views/library.js';
import { esc } from './lib/escape.js';
import { newId } from './lib/ids.js';
import { takenListIds } from './lib/lists.js';
import { takenGroupIds } from './lib/phrases.js';
import { DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN, msToIso } from './lib/dates.js';
import { newSegmentDraft, newTripDraft, blankItinerary } from './lib/drafts.js';
import { fieldsFor, applyForm } from './lib/edit-form.js';
import { FORM_SPEC } from './form-spec.js';
import { renderForm, readForm } from './views/edit-form.js';
import { updateHeader, renderAll, refreshAfterChange, showApp } from './render.js';
import { renderMap, destroyMap } from './views/map.js';
import { refreshGanttNow } from './views/gantt.js';
import { updateActiveChip } from './views/jump-nav.js';
import { renderChat } from './ai/chat.js';
import { hidePreview } from './ai/preview.js';

export function load(data) {
  state.HD = typeof data === 'string' ? JSON.parse(data) : data;
  dismissStoreWarning();
  persist(); // settles trip_id/rev and makes this the library's current trip
  showApp();
  updateHeader();
  renderAll();
}

/* --- upload guard (issue #15): files declare a schema_version and are
       schema-validated before loading; both checks are advisory with a
       "load anyway" escape hatch, mirroring the localStorage guard --- */

/** The warning slot on the opening screen. Exported because an incoming share
    link (issue #81) reports its failures in the same place an upload does. */
export function showUploadWarning(html, buttons) {
  const w = document.getElementById('hverwarn');
  const actions = buttons || [
    '<button onclick="hUploadAnyway()" style="font-size:12px">Load anyway</button>',
    '<button onclick="hUploadCancel()" style="font-size:12px">Cancel</button>',
  ];
  w.innerHTML = html + `
    <div style="display:flex;gap:8px;margin-top:.6rem;flex-wrap:wrap">${actions.join('')}</div>`;
  w.style.display = 'block';
}

/** Upload/drag-drop entry point: version-check and validate before load(). */
export function loadUpload(data) {
  const doc = typeof data === 'string' ? JSON.parse(data) : data;
  document.getElementById('hverwarn').style.display = 'none';
  if (doc && doc.schema_version && major(doc.schema_version) !== major(H_SCHEMA_VERSION)) {
    state.pendingUpload = doc;
    showUploadWarning(`<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-alert-triangle" aria-hidden="true"></i> File is from a different schema version</div>
      This file declares schema <code>${esc(doc.schema_version)}</code> but this viewer expects <code>${H_SCHEMA_VERSION}</code>, so it may not display correctly.`);
    return;
  }
  // ajv and the schema are compiled into the bundle (src/validate.js), so this
  // guard is always present — including offline and on a saved file:// copy,
  // which is where an unvalidated share link used to slip through. The
  // fallback now only covers a schema ajv could not compile, which is a build
  // error; "Load anyway" below stays the deliberate, visible way past it.
  const v = window.hValidate ? window.hValidate(doc) : { ok: true, errors: [] };
  if (!v.ok) {
    state.pendingUpload = doc;
    const items = v.errors.slice(0, 8).map(e => `<li><code>${esc(e.path)}</code> ${esc(e.message || '')}</li>`).join('');
    const more = v.errors.length > 8 ? `<div>…and ${v.errors.length - 8} more</div>` : '';
    showUploadWarning(`<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-alert-triangle" aria-hidden="true"></i> File does not match the itinerary schema</div>
      Some views may render incorrectly or stay blank.
      <ul style="margin:.4rem 0 0 1.1rem">${items}</ul>${more}`);
    return;
  }
  loadImport(doc);
}

export function uploadAnyway() {
  const doc = state.pendingUpload;
  state.pendingUpload = null;
  document.getElementById('hverwarn').style.display = 'none';
  if (doc) loadImport(doc);
}

export function uploadCancel() {
  state.pendingUpload = null;
  document.getElementById('hverwarn').style.display = 'none';
}

/* --- importing into a library rather than into the one slot (issue #80):
       a file that names a trip already saved here is a decision, not a silent
       overwrite. Which decision depends on how the two copies relate — see
       classifyImport in lib/library.js. --- */

/** Load an uploaded document, asking first when it collides with a saved trip. */
export function loadImport(doc) {
  const d = importKind(doc);
  const name = esc((d.doc.trip && d.doc.trip.name) || 'this trip');
  if (d.kind === 'new') { load(d.doc); return; }
  if (d.kind === 'duplicate') {
    // Re-opening the same file (or the same link) is a no-op: what is already
    // in the library IS this document, so open it rather than adding a copy.
    load(savedTrip(d.doc.trip_id) || d.doc);
    return;
  }
  state.pendingImport = d;
  const both = '<button onclick="hImportBoth()" style="font-size:12px">Keep both</button>';
  const replace = '<button onclick="hImportReplace()" style="font-size:12px">Replace</button>';
  const cancel = '<button onclick="hImportCancel()" style="font-size:12px">Cancel</button>';
  const body = d.kind === 'newer'
    ? `This file is rev ${d.rev} of <b>${name}</b>; the copy saved here is rev ${d.mine}.`
    : d.kind === 'older'
      ? `This file is rev ${d.rev} of <b>${name}</b>, older than the rev ${d.mine} saved here. Replacing keeps rev ${d.mine} in the trip's history.`
      : `This file and the copy saved here are both rev ${d.rev} of <b>${name}</b>, with different contents — someone edited each of them from the same starting point. Keeping both saves this file as a separate trip.`;
  showUploadWarning(`<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-${d.kind === 'fork' ? 'git-fork' : 'file-import'}" aria-hidden="true"></i> ${d.kind === 'fork' ? 'This trip has diverged' : 'You already have this trip'}</div>
    ${body}`, d.kind === 'newer' ? [replace, both, cancel] : [both, replace, cancel]);
}

export function importReplace() {
  const d = state.pendingImport;
  state.pendingImport = null;
  document.getElementById('hverwarn').style.display = 'none';
  if (d) load(d.doc);
}

export function importBoth() {
  const d = state.pendingImport;
  state.pendingImport = null;
  document.getElementById('hverwarn').style.display = 'none';
  if (d) load(asFork(d.doc));
}

export function importCancel() {
  state.pendingImport = null;
  document.getElementById('hverwarn').style.display = 'none';
}

/**
 * Close the open trip and go back to the opening screen. This used to mean
 * "forget everything" — with a library of trips it means only "put this one
 * down": the document stays saved, and the opening screen lists it (issue #80).
 * Forgetting is now the explicit action in the trip switcher.
 */
export function closeTrip() {
  state.HD = null;
  closeCurrent();
  destroyMap();
  dismissStoreWarning();
  state.chat = []; state.draft = null; state.ops = [];
  hidePreview(); renderChat();
  document.getElementById('hupl').style.display = 'block';
  document.getElementById('happ').style.display = 'none';
  document.getElementById('hverwarn').style.display = 'none';
  renderRecent();
  switchView('list');
}

export function switchView(v) {
  document.querySelectorAll('.htab').forEach(t => {
    const on = t.dataset.v === v;
    t.classList.toggle('on', on);
    document.getElementById('hv' + t.dataset.v).className = 'hv' + (on ? ' on' : '');
  });
  if (v === 'map' && !state.mapReady && state.HD) { state.mapReady = true; setTimeout(renderMap, 120); }
  if (v === 'gantt') refreshGanttNow(); // the "now" line drifts between visits (issue #35)
  // A hidden view can't measure its jump strip, so mark the current chip on
  // arrival; a no-op for the views that have no strip (issue #69).
  updateActiveChip('hv' + v);
}

/** Jump from another view to a segment's itinerary card and flash it (issue #21). */
export function revealSegment(idx) {
  switchView('list');
  const el = document.querySelector(`#hvlist .hseg[data-seg="${idx}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('hl');
  void el.offsetWidth; // restart the flash animation if it was mid-run
  el.classList.add('hl');
  el.addEventListener('animationend', () => el.classList.remove('hl'), { once: true });
}

/**
 * Download any document as JSON, stamped with the schema version this build
 * writes (issue #15) — the loaded trip, or one revision out of a trip's
 * history, in which case `suffix` distinguishes the file (issue #80).
 * The downloaded file keeps trip_id/rev, so re-uploading it lands back on the
 * trip it came from rather than starting a second copy — as does a share
 * link, which carries the same document (issue #81, src/share.js).
 */
export function downloadDoc(doc, suffix) {
  const out = { schema_version: H_SCHEMA_VERSION, ...doc };
  out.schema_version = H_SCHEMA_VERSION; // win over any version the uploaded file carried

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stem = ((doc.trip && doc.trip.name) || 'itinerary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').toLowerCase();
  a.download = stem + (suffix ? '_' + suffix : '') + '.json';
  a.click(); URL.revokeObjectURL(url);
}

export function download() {
  downloadDoc(state.HD);
}

/* --- edit modal: a generated form over the common fields, with the raw JSON
       textarea kept as the escape hatch for everything else (issue #65) --- */

export function toggleEdit() {
  const on = document.getElementById('happ').classList.toggle('hedit-on');
  document.getElementById('hedit-toggle').style.color = on ? 'var(--color-text-primary)' : '';
}

const editEl = part => document.getElementById('hedit-' + part);

/* Targets whose form is fixed by what is being edited rather than by a `type`
   key on the value — segments carry their own type, lists and the trip do not. */
const TARGET_FORM = {
  trip: 'trip', 'new-trip': 'trip',
  list: 'list', 'new-list': 'list',
  'list-item': 'list-item',
  'phrase-group': 'phrase-group', 'new-phrase-group': 'phrase-group',
  phrase: 'phrase',
};

/** Which set of form fields describes the thing being edited — null for a
    segment whose type the spec doesn't know, which stays JSON-only. */
function editFieldsFor(target, value) {
  return fieldsFor(FORM_SPEC, TARGET_FORM[target.type] || (value && value.type));
}

/** Swap the visible editor, drawing it from state.editValue (the single
    source of truth while the modal is open — each tab is a view of it). */
function setEditMode(mode) {
  state.editMode = mode;
  // Show the tab before filling it: the form's wrapping fields size
  // themselves to their content, which can only be measured while visible.
  editEl('inner').classList.toggle('json', mode === 'json');
  editEl('tab-form').classList.toggle('on', mode === 'form');
  editEl('tab-json').classList.toggle('on', mode === 'json');
  if (mode === 'form') renderForm(editEl('form'), state.editFields, state.editValue);
  else editEl('ta').value = JSON.stringify(state.editValue, null, 2);
}

/** The edited value as it currently stands in the active tab, or undefined
    when the JSON tab doesn't parse (the error is left in the modal). */
function harvestEdit() {
  if (state.editMode === 'form')
    return applyForm(state.editValue, state.editFields, readForm(editEl('form'), state.editFields));
  try { return JSON.parse(editEl('ta').value); }
  catch (e) { editEl('err').textContent = 'Invalid JSON: ' + e.message; return undefined; }
}

/** Form ⇄ JSON. The value round-trips through state.editValue, so fields the
    form doesn't cover survive a trip through the form and vice versa. */
export function editTab(mode) {
  if (!state.editTarget || mode === state.editMode) return;
  if (mode === 'form' && !state.editFields) return; // JSON-only target
  const val = harvestEdit();
  if (val === undefined) return;
  state.editValue = val;
  editEl('err').textContent = '';
  setEditMode(mode);
}

function openModal(target, value, title, deletable) {
  state.editTarget = target;
  state.editValue = value;
  state.editFields = editFieldsFor(target, value);
  editEl('title').textContent = title;
  editEl('err').textContent = '';
  editEl('del').style.display = deletable ? '' : 'none';
  editEl('tab-form').style.display = state.editFields ? '' : 'none';
  editEl('modal').classList.add('on'); // before setEditMode — see the note there
  setEditMode(state.editFields ? 'form' : 'json');
}

export function openEdit(idx) {
  const seg = state.HD.segments[idx];
  openModal({ type: 'segment', idx }, seg, 'Edit: ' + (seg.name || seg.operator || 'Segment'), true);
}

export function openEditTrip() {
  openModal({ type: 'trip' }, state.HD.trip, 'Edit: Trip details', false);
}

/* --- adding the top-level things by hand (issue #76). Editing a segment, a
       list or the trip already went through this modal; adding one now uses
       the same door, so a new thing is described by the same schema-derived
       form and gets the same validation before it lands in the document.
       Neither is gated on edit mode — nothing exists yet to protect from a
       stray tap, and adding is the point. --- */

/** Add a segment to the itinerary: the modal opens on a prefilled draft of
    the chosen type (see lib/drafts.js) with its required content left blank,
    so saving is refused until it says something. */
export function openAddSegment(type) {
  const seg = newSegmentDraft(type, state.HD);
  if (!seg) return;
  const title = { transport: 'New travel', accommodation: 'New stay', event: 'New event' }[type];
  openModal({ type: 'new-segment' }, seg, title, false);
}

/** Start an itinerary from scratch, with no file and no AI (issue #76): the
    trip form is the whole first step — saving it creates a document with no
    segments, which every view then invites you to fill. */
export function openNewItinerary(nowMs = Date.now()) {
  openModal({ type: 'new-trip' }, newTripDraft(msToIso(nowMs).date), 'New itinerary', false);
}

/* Promote a list item into the schedule (issue #40): promotion is a UI
   action, not a schema concept — "Schedule" opens the ordinary edit modal on
   a prefilled draft EventSegment, and saving writes the new segment's id
   back to the item's segment_id. */
export function openScheduleItem(li, ii) {
  const list = state.HD.lists[li];
  const item = list.items[ii];
  // The form makes date/time/duration discoverable whether or not they are
  // set, but they stay prefilled so the draft is schedulable as-is — the
  // defaults come from lib/dates.js (issue #13), not invented here.
  const seg = {
    id: newId('seg-', new Set(state.HD.segments.map(s => s && s.id))),
    type: 'event',
    subtype: (list.kind === 'food' || list.kind === 'restaurant') ? 'meal' : 'activity',
    name: item.name,
    date: state.HD.trip.start,
    time: DEFAULT_EVENT_TIME,
    duration_min: DEFAULT_EVENT_DURATION_MIN,
    cost: { status: 'not_booked' },
  };
  if (item.url) seg.url = item.url;
  if (item.note) seg.notes = item.note;
  openModal({ type: 'new-segment', li, ii }, seg, 'Schedule: ' + (item.name || 'Item'), false);
}

/* --- lists (issue #72): the same modal, so a list or an item gets the
       schema-derived form and the JSON escape hatch that segments already
       have. Adding an *item* is deliberately not here — that is the inline
       quick-add row in views/lists.js, since typing a name is the common
       case and a modal for it would be all ceremony. --- */

export function openEditList(li) {
  const list = state.HD.lists[li];
  openModal({ type: 'list', li }, list, 'Edit list: ' + (list.name || 'List'), true);
}

export function openAddList() {
  openModal({ type: 'new-list' }, { name: '', kind: 'other', items: [] }, 'New list', false);
}

export function openEditListItem(li, ii) {
  const item = state.HD.lists[li].items[ii];
  openModal({ type: 'list-item', li, ii }, item, 'Edit: ' + (item.name || 'Item'), true);
}

/* --- the phrasebook (issue #75): the same modal again. A phrase group is
       edited and added exactly as a list is, and a phrase as a list item —
       the only new thing here is which branch of the document it lands in. --- */

export function openEditPhraseGroup(gi) {
  const group = state.HD.phrases[gi];
  openModal({ type: 'phrase-group', gi }, group, 'Edit group: ' + (group.name || 'Phrases'), true);
}

export function openAddPhraseGroup() {
  openModal({ type: 'new-phrase-group' }, { name: '', kind: 'other', items: [] }, 'New phrase group', false);
}

export function openEditPhrase(gi, pi) {
  const phrase = state.HD.phrases[gi].items[pi];
  openModal({ type: 'phrase', gi, pi }, phrase, 'Edit: ' + (phrase.text || 'Phrase'), true);
}

export function closeEdit() {
  document.getElementById('hedit-modal').classList.remove('on');
  state.editTarget = null;
  state.editValue = null;
  state.editFields = null;
}

/** One-line summary of schema errors for the modal's error slot. */
function editErrorText(errors) {
  const shown = errors.slice(0, 3).map(e => `${e.path || '/'} ${e.message || ''}`.trim()).join('; ');
  const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
  return 'Schema: ' + shown + more;
}

/* Validate the edited value the same way the AI path does (issue #47).
   Degrades gracefully — {ok:true} — when validate.js failed to load ajv,
   matching validateSafe in ai/chat.js. For the trip target the whole
   document is validated, but only /trip errors block the save: a
   pre-existing invalid segment elsewhere shouldn't lock trip edits. */
function validateEdit(target, val) {
  if (target.type === 'segment' || target.type === 'new-segment')
    return window.hValidateSegment ? window.hValidateSegment(val) : { ok: true, errors: [] };
  // A list being created has no id yet (saveEdit assigns it), so it is
  // validated with a stand-in; every other target already carries its id, and
  // a JSON-tab edit that drops it should fail here rather than be papered over.
  if (target.type === 'new-list')
    return window.hValidateList ? window.hValidateList({ id: 'list-draft', ...val }) : { ok: true, errors: [] };
  if (target.type === 'list')
    return window.hValidateList ? window.hValidateList(val) : { ok: true, errors: [] };
  if (target.type === 'list-item')
    return window.hValidateListItem ? window.hValidateListItem(val) : { ok: true, errors: [] };
  // Same stand-in-id policy as lists: saveEdit assigns a new group's id.
  if (target.type === 'new-phrase-group')
    return window.hValidatePhraseGroup ? window.hValidatePhraseGroup({ id: 'phr-draft', ...val }) : { ok: true, errors: [] };
  if (target.type === 'phrase-group')
    return window.hValidatePhraseGroup ? window.hValidatePhraseGroup(val) : { ok: true, errors: [] };
  if (target.type === 'phrase')
    return window.hValidatePhrase ? window.hValidatePhrase(val) : { ok: true, errors: [] };
  // A from-scratch trip has no document around it yet, so the trip subschema
  // is validated on its own rather than as part of one (issue #76).
  if (target.type === 'new-trip')
    return window.hValidateTrip ? window.hValidateTrip(val) : { ok: true, errors: [] };
  if (!window.hValidate) return { ok: true, errors: [] };
  const v = window.hValidate({ ...state.HD, trip: val });
  const tripErrors = v.errors.filter(e => (e.path || '').startsWith('/trip'));
  return { ok: tripErrors.length === 0, errors: tripErrors };
}

export function saveEdit() {
  const val = harvestEdit();
  if (val === undefined) return;
  const errEl = editEl('err');
  const v = validateEdit(state.editTarget, val);
  if (!v.ok) { errEl.textContent = editErrorText(v.errors); return; }
  if (state.editTarget.type === 'new-trip') {
    // The first save *is* the load: there is no document to write into yet.
    closeEdit();
    load(blankItinerary(val));
    return;
  }
  if (state.editTarget.type === 'segment') {
    state.HD.segments[state.editTarget.idx] = val;
  } else if (state.editTarget.type === 'new-segment') {
    // A missing or colliding id gets replaced rather than creating a
    // duplicate that edits-by-id would reach nondeterministically (issue #41).
    if (!val.id || state.HD.segments.some(s => s && s.id === val.id))
      val.id = newId('seg-', new Set(state.HD.segments.map(s => s && s.id)));
    state.HD.segments.push(val);
    // A draft promoted from a list item points back at it; one added straight
    // to the itinerary (issue #76) has no item to link.
    if (state.editTarget.li !== undefined)
      state.HD.lists[state.editTarget.li].items[state.editTarget.ii].segment_id = val.id;
  } else if (state.editTarget.type === 'list') {
    state.HD.lists[state.editTarget.li] = val;
  } else if (state.editTarget.type === 'new-list') {
    if (!Array.isArray(state.HD.lists)) state.HD.lists = [];
    // Same id policy as segments (issue #41): missing or colliding ids are
    // replaced rather than left to resolve nondeterministically.
    const taken = takenListIds(state.HD);
    if (!val.id || taken.has(val.id)) val.id = newId('list-', taken);
    if (!Array.isArray(val.items)) val.items = [];
    state.HD.lists.push(val);
  } else if (state.editTarget.type === 'list-item') {
    state.HD.lists[state.editTarget.li].items[state.editTarget.ii] = val;
  } else if (state.editTarget.type === 'phrase-group') {
    state.HD.phrases[state.editTarget.gi] = val;
  } else if (state.editTarget.type === 'new-phrase-group') {
    if (!Array.isArray(state.HD.phrases)) state.HD.phrases = [];
    const taken = takenGroupIds(state.HD);
    if (!val.id || taken.has(val.id)) val.id = newId('phr-', taken);
    if (!Array.isArray(val.items)) val.items = [];
    state.HD.phrases.push(val);
  } else if (state.editTarget.type === 'phrase') {
    state.HD.phrases[state.editTarget.gi].items[state.editTarget.pi] = val;
  } else {
    state.HD.trip = val;
    updateHeader();
  }
  persist();
  closeEdit();
  refreshAfterChange();
}

/** The modal's Delete button, for whichever kind of thing it is open on. Only
    targets opened as deletable get here — a draft (new-*) has nothing to
    delete and its button is hidden. */
export function deleteEdit() {
  const t = state.editTarget;
  if (!t) return;
  if (t.type === 'segment') {
    const seg = state.HD.segments[t.idx];
    if (!confirm(`Delete "${seg.name || seg.operator || 'this segment'}"? This cannot be undone.`)) return;
    state.HD.segments.splice(t.idx, 1);
  } else if (t.type === 'list') {
    const list = state.HD.lists[t.li];
    const n = (list.items || []).length;
    if (!confirm(`Delete the list "${list.name || 'this list'}"${n ? ` and its ${n} item${n === 1 ? '' : 's'}` : ''}? `
      + 'Segments scheduled from it stay on the itinerary. This cannot be undone.')) return;
    state.HD.lists.splice(t.li, 1);
  } else if (t.type === 'list-item') {
    const item = state.HD.lists[t.li].items[t.ii];
    if (!confirm(`Delete "${item.name || 'this item'}"?`
      + (item.segment_id ? ' The segment it was scheduled into stays on the itinerary.' : '')
      + ' This cannot be undone.')) return;
    state.HD.lists[t.li].items.splice(t.ii, 1);
  } else if (t.type === 'phrase-group') {
    const group = state.HD.phrases[t.gi];
    const n = (group.items || []).length;
    if (!confirm(`Delete the phrase group "${group.name || 'this group'}"${n ? ` and its ${n} phrase${n === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    state.HD.phrases.splice(t.gi, 1);
  } else if (t.type === 'phrase') {
    const phrase = state.HD.phrases[t.gi].items[t.pi];
    if (!confirm(`Delete "${phrase.text || 'this phrase'}"? This cannot be undone.`)) return;
    state.HD.phrases[t.gi].items.splice(t.pi, 1);
  } else return;
  persist();
  closeEdit();
  refreshAfterChange();
}

/* --- saved-data guard: don't auto-load data written by an incompatible
       (different MAJOR schema version) deployment on this origin --- */

/** Every saved document, whichever side of the library migration it is on —
    what the version guard offers to back up before discarding. */
function savedDocs() {
  const docs = savedTrips().map(e => savedTrip(e.trip_id)).filter(Boolean);
  if (docs.length) return docs;
  const raw = localStorage.getItem('hItinerary');
  if (!raw) return [];
  try { return [JSON.parse(raw)]; } catch (e) { return []; }
}

/** One reloadable file per saved trip, staggered because a browser will drop
    downloads fired in the same tick. */
export function downloadSaved() {
  savedDocs().forEach((doc, i) => setTimeout(() => downloadDoc(doc, 'backup'), i * 300));
}

export function forceLoadSaved() {
  const doc = savedDocs()[0];
  if (!doc) return;
  document.getElementById('hverwarn').style.display = 'none';
  try { load(doc); } catch (e) { alert('Could not load saved itinerary: ' + e.message); }
}

export function discardSaved() {
  forgetEverything();
  localStorage.removeItem('hSchemaVersion');
  document.getElementById('hverwarn').style.display = 'none';
  renderRecent();
}

/**
 * Boot: restore the trip that was open, having first brought any pre-library
 * `hItinerary` value into the library. The version guard runs before either,
 * so data written by an incompatible deployment on this origin is neither
 * loaded nor migrated.
 */
export function loadSaved() {
  const ver = localStorage.getItem('hSchemaVersion');
  if (ver && major(ver) !== major(H_SCHEMA_VERSION) && savedDocs().length) {
    const n = savedDocs().length;
    const w = document.getElementById('hverwarn');
    w.innerHTML = `<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Saved ${n === 1 ? 'itinerary is' : 'itineraries are'} from a different version</div>
      ${n === 1 ? 'It was' : `${n} saved trips were`} saved for schema <code>${esc(ver)}</code> but this version expects <code>${H_SCHEMA_VERSION}</code>, so ${n === 1 ? 'it was' : 'they were'} not loaded automatically.
      <div style="display:flex;gap:8px;margin-top:.6rem;flex-wrap:wrap">
        <button onclick="hDownloadSaved()" style="font-size:12px">Download backup</button>
        <button onclick="hForceLoadSaved()" style="font-size:12px">Load anyway</button>
        <button onclick="hDiscardSaved()" style="font-size:12px">Discard</button>
      </div>`;
    w.style.display = 'block';
    return;
  }
  migrate();
  const doc = savedTrip(bootTripId());
  renderRecent();
  if (doc) load(doc);
}
