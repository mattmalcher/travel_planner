// Top-level app behaviour: loading files, tab switching, the JSON edit
// modal, download, and the saved-data schema-version guard.
import { state, persist, major, H_SCHEMA_VERSION } from './state.js';
import { esc } from './lib/escape.js';
import { updateHeader, renderAll, refreshAfterChange, showApp } from './render.js';
import { renderMap, destroyMap } from './views/map.js';
import { refreshGanttNow } from './views/gantt.js';
import { renderChat } from './ai/chat.js';
import { hidePreview } from './ai/preview.js';

export function load(data) {
  state.HD = typeof data === 'string' ? JSON.parse(data) : data;
  persist();
  showApp();
  updateHeader();
  renderAll();
}

/* --- upload guard (issue #15): files declare a schema_version and are
       schema-validated before loading; both checks are advisory with a
       "load anyway" escape hatch, mirroring the localStorage guard --- */

function showUploadWarning(html) {
  const w = document.getElementById('hverwarn');
  w.innerHTML = html + `
    <div style="display:flex;gap:8px;margin-top:.6rem;flex-wrap:wrap">
      <button onclick="hUploadAnyway()" style="font-size:12px">Load anyway</button>
      <button onclick="hUploadCancel()" style="font-size:12px">Cancel</button>
    </div>`;
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
  // Degrades gracefully when ajv/schema failed to load (validate.js is async
  // and network-dependent) — same policy as validateSafe in ai/chat.js.
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
  load(doc);
}

export function uploadAnyway() {
  const doc = state.pendingUpload;
  state.pendingUpload = null;
  document.getElementById('hverwarn').style.display = 'none';
  if (doc) load(doc);
}

export function uploadCancel() {
  state.pendingUpload = null;
  document.getElementById('hverwarn').style.display = 'none';
}

export function reset() {
  state.HD = null;
  localStorage.removeItem('hItinerary');
  localStorage.removeItem('hSchemaVersion');
  destroyMap();
  state.chat = []; state.draft = null; state.ops = [];
  hidePreview(); renderChat();
  document.getElementById('hupl').style.display = 'block';
  document.getElementById('happ').style.display = 'none';
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
}

/** Jump from another view to a segment's timeline card and flash it (issue #21). */
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

export function download() {
  // Stamp the document with the schema version this build writes, replacing
  // any version an uploaded file carried in (issue #15).
  const doc = { schema_version: H_SCHEMA_VERSION, ...state.HD };
  doc.schema_version = H_SCHEMA_VERSION; // win over any version the uploaded file carried

  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.HD.trip.name || 'itinerary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').toLowerCase() + '.json';
  a.click(); URL.revokeObjectURL(url);
}

/* --- JSON edit modal --- */

export function toggleEdit() {
  const on = document.getElementById('happ').classList.toggle('hedit-on');
  document.getElementById('hedit-toggle').style.color = on ? 'var(--color-text-primary)' : '';
}

export function openEdit(idx) {
  state.editTarget = { type: 'segment', idx };
  const seg = state.HD.segments[idx];
  document.getElementById('hedit-title').textContent = 'Edit: ' + (seg.name || seg.operator || 'Segment');
  document.getElementById('hedit-ta').value = JSON.stringify(seg, null, 2);
  document.getElementById('hedit-err').textContent = '';
  document.getElementById('hedit-del').style.display = '';
  document.getElementById('hedit-modal').classList.add('on');
}

export function openEditTrip() {
  state.editTarget = { type: 'trip' };
  document.getElementById('hedit-title').textContent = 'Edit: Trip details';
  document.getElementById('hedit-ta').value = JSON.stringify(state.HD.trip, null, 2);
  document.getElementById('hedit-err').textContent = '';
  document.getElementById('hedit-del').style.display = 'none';
  document.getElementById('hedit-modal').classList.add('on');
}

export function closeEdit() {
  document.getElementById('hedit-modal').classList.remove('on');
  state.editTarget = null;
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
  if (target.type === 'segment')
    return window.hValidateSegment ? window.hValidateSegment(val) : { ok: true, errors: [] };
  if (!window.hValidate) return { ok: true, errors: [] };
  const v = window.hValidate({ ...state.HD, trip: val });
  const tripErrors = v.errors.filter(e => (e.path || '').startsWith('/trip'));
  return { ok: tripErrors.length === 0, errors: tripErrors };
}

export function saveEdit() {
  let val;
  const errEl = document.getElementById('hedit-err');
  try { val = JSON.parse(document.getElementById('hedit-ta').value); }
  catch (e) { errEl.textContent = 'Invalid JSON: ' + e.message; return; }
  const v = validateEdit(state.editTarget, val);
  if (!v.ok) { errEl.textContent = editErrorText(v.errors); return; }
  if (state.editTarget.type === 'segment') {
    state.HD.segments[state.editTarget.idx] = val;
  } else {
    state.HD.trip = val;
    updateHeader();
  }
  persist();
  closeEdit();
  refreshAfterChange();
}

export function deleteSegment() {
  if (!state.editTarget || state.editTarget.type !== 'segment') return;
  const seg = state.HD.segments[state.editTarget.idx];
  if (!confirm(`Delete "${seg.name || seg.operator || 'this segment'}"? This cannot be undone.`)) return;
  state.HD.segments.splice(state.editTarget.idx, 1);
  persist();
  closeEdit();
  refreshAfterChange();
}

/* --- saved-data guard: don't auto-load data written by an incompatible
       (different MAJOR schema version) deployment on this origin --- */

export function downloadSaved() {
  const raw = localStorage.getItem('hItinerary'); if (!raw) return;
  const blob = new Blob([raw], { type: 'application/json' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'itinerary_backup.json'; a.click(); URL.revokeObjectURL(url);
}

export function forceLoadSaved() {
  const raw = localStorage.getItem('hItinerary'); if (!raw) return;
  document.getElementById('hverwarn').style.display = 'none';
  try { load(JSON.parse(raw)); } catch (e) { alert('Could not load saved itinerary: ' + e.message); }
}

export function discardSaved() {
  localStorage.removeItem('hItinerary'); localStorage.removeItem('hSchemaVersion');
  document.getElementById('hverwarn').style.display = 'none';
}

export function loadSaved() {
  const raw = localStorage.getItem('hItinerary'); if (!raw) return;
  const ver = localStorage.getItem('hSchemaVersion');
  if (ver && major(ver) !== major(H_SCHEMA_VERSION)) {
    const w = document.getElementById('hverwarn');
    w.innerHTML = `<div style="font-weight:500;margin-bottom:4px"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Saved itinerary is from a different version</div>
      It was saved for schema <code>${ver}</code> but this version expects <code>${H_SCHEMA_VERSION}</code>, so it was not loaded automatically.
      <div style="display:flex;gap:8px;margin-top:.6rem;flex-wrap:wrap">
        <button onclick="hDownloadSaved()" style="font-size:12px">Download backup</button>
        <button onclick="hForceLoadSaved()" style="font-size:12px">Load anyway</button>
        <button onclick="hDiscardSaved()" style="font-size:12px">Discard</button>
      </div>`;
    w.style.display = 'block';
    return;
  }
  try { load(JSON.parse(raw)); } catch (e) { localStorage.removeItem('hItinerary'); localStorage.removeItem('hSchemaVersion'); }
}
