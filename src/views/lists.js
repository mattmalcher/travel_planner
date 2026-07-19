// Lists view (issue #40): pools of intentions that aren't (yet) plans.
// Exactly two behaviours per item — check it off in place, or promote it into
// an ordinary segment via the "Schedule" action (see openScheduleItem in
// app.js). All counting/partitioning maths lives in lib/lists.js.
import { state, persist } from '../state.js';
import { esc, safeUrl } from '../lib/escape.js';
import { listProgress, partitionItems } from '../lib/lists.js';
import { revealSegment } from '../app.js';

/** Tabler icon class for a list's kind. */
export function listIcon(kind) {
  return {
    food: 'ti-tools-kitchen-2',
    packing: 'ti-luggage',
    restaurant: 'ti-chef-hat',
    sight: 'ti-map-pin',
    activity: 'ti-activity',
  }[kind] || 'ti-checklist';
}

/** Toggle an item's done flag in place and persist; only this view changes,
    so no full refreshAfterChange. */
export function toggleListItem(li, ii) {
  const item = state.HD.lists[li].items[ii];
  item.done = !item.done;
  persist();
  renderLists();
}

/** Jump to the segment an item was promoted into (link chip). */
export function revealListSegment(segId) {
  const idx = state.HD.segments.findIndex(s => s && s.id === segId);
  if (idx >= 0) revealSegment(idx);
}

function itemRow(item, li, ii, segIds) {
  const url = safeUrl(item.url);
  // Promotion chip: a working link to the segment, a broken-link warning when
  // it dangles (lint flags the same thing), or the Schedule action.
  let chip;
  if (item.segment_id && segIds.has(item.segment_id)) {
    // The id rides in a data attribute rather than an inline JS string so a
    // hostile id can't break out of the onclick (issue #9).
    chip = `<button class="hli-chip" data-sid="${esc(item.segment_id)}" onclick="hListSeg(this.dataset.sid)" title="Open in timeline"><i class="ti ti-calendar-check" aria-hidden="true"></i> ${esc(item.segment_id)}</button>`;
  } else if (item.segment_id) {
    chip = `<span class="hli-chip broken" title="The scheduled segment no longer exists"><i class="ti ti-unlink" aria-hidden="true"></i> ${esc(item.segment_id)}</span>`;
  } else {
    chip = `<button class="hli-chip" onclick="hListSchedule(${li},${ii})" title="Create a segment from this item"><i class="ti ti-calendar-plus" aria-hidden="true"></i> Schedule</button>`;
  }
  return `<div class="hli${item.done ? ' done' : ''}">
    <label class="hli-main">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="hListToggle(${li},${ii})">
      <span class="hli-name">${esc(item.name)}${item.local_name ? ` <span class="hli-local">${esc(item.local_name)}</span>` : ''}</span>
    </label>
    ${url ? `<a class="hli-chip" href="${esc(url)}" target="_blank" rel="noopener">Link <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a>` : ''}
    ${chip}
    ${item.note ? `<div class="hli-note">${esc(item.note)}</div>` : ''}
  </div>`;
}

export function renderLists() {
  const HD = state.HD;
  const lists = (HD && Array.isArray(HD.lists)) ? HD.lists : [];
  const box = document.getElementById('hvlists');
  if (!lists.length) {
    box.innerHTML = `<div style="font-size:13px;color:var(--color-text-secondary);padding:1rem 0">
      No lists yet. Lists hold intentions that aren't plans — foods to try, packing, restaurant options.
      Add one with the AI assistant or in the itinerary JSON (<code>lists</code>), then tick items off here or schedule them into the timeline.</div>`;
    return;
  }
  const segIds = new Set((HD.segments || []).map(s => s && s.id).filter(Boolean));
  box.innerHTML = lists.map((list, li) => {
    const p = listProgress(list);
    const { open, done } = partitionItems(list);
    const row = item => itemRow(item, li, HD.lists[li].items.indexOf(item), segIds);
    return `<div class="hseg">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ${listIcon(list.kind)}" style="font-size:17px;color:var(--color-text-secondary)" aria-hidden="true"></i>
        <div style="font-size:14px;font-weight:500;flex:1">${esc(list.name)}</div>
        <span class="hli-progress">${p.done}/${p.total}</span>
      </div>
      <div style="margin-top:8px">${[...open, ...done].map(row).join('') ||
        '<div style="font-size:12px;color:var(--color-text-tertiary)">No items yet.</div>'}</div>
    </div>`;
  }).join('');
}
