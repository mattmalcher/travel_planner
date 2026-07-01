// Top-level app behaviour: loading files, tab switching, the JSON edit
// modal, download, and the saved-data schema-version guard.
import { state, persist, major, H_SCHEMA_VERSION } from './state.js';
import { updateHeader, renderAll, refreshAfterChange, showApp } from './render.js';
import { renderMap, destroyMap } from './views/map.js';
import { renderChat } from './ai/chat.js';
import { hidePreview } from './ai/preview.js';

export function load(data) {
  state.HD = typeof data === 'string' ? JSON.parse(data) : data;
  persist();
  showApp();
  updateHeader();
  renderAll();
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
  document.querySelectorAll('.htab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  document.getElementById('hvlist').className = 'hv' + (v === 'list' ? ' on' : '');
  document.getElementById('hvbudget').className = 'hv' + (v === 'budget' ? ' on' : '');
  document.getElementById('hvmap').className = 'hv' + (v === 'map' ? ' on' : '');
  document.getElementById('hvgantt').className = 'hv' + (v === 'gantt' ? ' on' : '');
  if (v === 'map' && !state.mapReady && state.HD) { state.mapReady = true; setTimeout(renderMap, 120); }
}

export function download() {
  const blob = new Blob([JSON.stringify(state.HD, null, 2)], { type: 'application/json' });
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
  document.getElementById('hedit-modal').classList.add('on');
}

export function openEditTrip() {
  state.editTarget = { type: 'trip' };
  document.getElementById('hedit-title').textContent = 'Edit: Trip details';
  document.getElementById('hedit-ta').value = JSON.stringify(state.HD.trip, null, 2);
  document.getElementById('hedit-err').textContent = '';
  document.getElementById('hedit-modal').classList.add('on');
}

export function closeEdit() {
  document.getElementById('hedit-modal').classList.remove('on');
  state.editTarget = null;
}

export function saveEdit() {
  let val;
  try { val = JSON.parse(document.getElementById('hedit-ta').value); }
  catch (e) { document.getElementById('hedit-err').textContent = 'Invalid JSON: ' + e.message; return; }
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
