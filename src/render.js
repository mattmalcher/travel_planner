// App-level render helpers shared by file loading, the edit modal and the AI
// preview apply path.
import { state } from './state.js';
import { fmtDate } from './lib/dates.js';
import { renderList } from './views/list.js';
import { renderBudget } from './views/budget.js';
import { renderGantt } from './views/gantt.js';
import { renderMap, destroyMap } from './views/map.js';

export function updateHeader() {
  const HD = state.HD;
  document.getElementById('htname').innerHTML = `${HD.trip.name} <button class="hedit-btn" onclick="hOpenEditTrip()" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary);vertical-align:middle" title="Edit trip details"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
  document.getElementById('htmeta').innerHTML = `
    <span><i class="ti ti-calendar" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${fmtDate(HD.trip.start)} – ${fmtDate(HD.trip.end)}</span>
    <span><i class="ti ti-users" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${HD.trip.travellers.join(' & ')}</span>`;
}

export function renderAll() {
  renderList(); renderBudget(); renderGantt();
}

/** Re-render every view after the itinerary changed: the map is rebuilt if
    visible, otherwise torn down so it rebuilds on the next visit. */
export function refreshAfterChange() {
  renderAll();
  if (document.getElementById('hvmap').classList.contains('on')) renderMap();
  else destroyMap();
}

export function showApp() {
  document.getElementById('hupl').style.display = 'none';
  document.getElementById('happ').style.display = 'block';
}
