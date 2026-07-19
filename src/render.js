// App-level render helpers shared by file loading, the edit modal and the AI
// preview apply path.
import { state } from './state.js';
import { esc } from './lib/escape.js';
import { renderList } from './views/list.js';
import { renderBudget } from './views/budget.js';
import { renderGantt } from './views/gantt.js';
import { renderLists } from './views/lists.js';
import { renderMap, destroyMap } from './views/map.js';

export function updateHeader() {
  const HD = state.HD;
  // Trip dates and travellers used to live here too, but they are redundant —
  // dates appear on the timeline/gantt and travellers via cost splits — and on
  // a narrow phone the extra line just crowds the header (issue #66).
  document.getElementById('htname').innerHTML = `${esc(HD.trip.name)} <button class="hedit-btn" onclick="hOpenEditTrip()" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary);vertical-align:middle" title="Edit trip details"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
}

export function renderAll() {
  renderList(); renderBudget(); renderGantt(); renderLists();
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
