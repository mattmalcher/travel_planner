// Lists view (issue #40): pools of intentions that aren't (yet) plans.
// Every item offers two actions — check it off in place, or promote it into an
// ordinary segment via "Schedule" (see openScheduleItem in app.js).
// Manual authoring needs no LLM round trip (issue #72), and *adding* needs no
// edit mode either: the quick-add row per list and the "New list" button are
// always on, since jotting something down is what this view is for. The
// everyday action on an existing item is the checkbox; everything that
// changes the list itself — the pencils (item detail fields, the list) and
// the per-item × (issue #69) — waits for edit mode, where the × is one click
// backed by one level of undo rather than a confirm. All counting/
// partitioning maths lives in lib/lists.js.
import { state, persist } from '../state.js';
import { esc, safeUrl } from '../lib/escape.js';
import { newId } from '../lib/ids.js';
import { listProgress, partitionItems, takenItemIds } from '../lib/lists.js';
import { revealSegment } from '../app.js';
import { jumpTo, bindJumpSpy, updateActiveChip } from './jump-nav.js';

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

// One level of undo for the inline delete: the removed item is held here (with
// the document it came from, so a fresh itinerary drops it) until the next
// change to any list. Nothing outside this view reads it.
let undo = null; // { hd, li, ii, item }

/** Toggle an item's done flag in place and persist; only this view changes,
    so no full refreshAfterChange. */
export function toggleListItem(li, ii) {
  const item = state.HD.lists[li].items[ii];
  item.done = !item.done;
  undo = null;
  persist();
  renderLists();
}

/** Delete an item outright — no confirm, because the Undo chip below the
    list costs one click and keeps everything the item held (issue #69). Any
    segment it was promoted into is a segment now and stays on the itinerary,
    exactly as it does when the item is deleted from the modal. */
export function deleteListItem(li, ii) {
  const list = state.HD.lists[li];
  if (!list || !Array.isArray(list.items)) return;
  const [item] = list.items.splice(ii, 1);
  undo = item ? { hd: state.HD, li, ii, item } : null;
  persist();
  renderLists();
}

/** Put the last deleted item back where it was. */
export function undoDeleteListItem() {
  if (!undo) return;
  const list = state.HD.lists[undo.li];
  if (list) {
    if (!Array.isArray(list.items)) list.items = [];
    list.items.splice(Math.min(undo.ii, list.items.length), 0, undo.item);
    persist();
  }
  undo = null;
  renderLists();
}

/** Scroll to a list from the jump strip (issue #69), keyed by list index. */
export function jumpToList(key) {
  jumpTo('hvlists', key);
}

/** Jump to the segment an item was promoted into (link chip). */
export function revealListSegment(segId) {
  const idx = state.HD.segments.findIndex(s => s && s.id === segId);
  if (idx >= 0) revealSegment(idx);
}

const addInput = li => document.querySelector(`.hli-add-in[data-li="${li}"]`);

/** Quick-add: the typed name becomes an item with a fresh document-unique id
    and nothing else — everything optional is left to the item's edit modal.
    Re-renders and puts the cursor back in the box, so a run of items can be
    typed one after another. */
export function addListItem(li) {
  const el = addInput(li);
  if (!el) return;
  const name = el.value.trim();
  if (!name) { el.focus(); return; }
  const list = state.HD.lists[li];
  if (!Array.isArray(list.items)) list.items = [];
  list.items.push({ id: newId('li-', takenItemIds(state.HD)), name });
  undo = null;
  persist();
  renderLists();
  const next = addInput(li);
  if (next) next.focus();
}

/** Enter in the quick-add box adds the item (a lone input has no form to
    submit, so the key is handled here). */
export function addListItemKey(ev, li) {
  if (ev.key === 'Enter') { ev.preventDefault(); addListItem(li); }
}

function itemRow(item, li, ii, segIds) {
  const url = safeUrl(item.url);
  // Promotion chip: a working link to the segment, a broken-link warning when
  // it dangles (lint flags the same thing), or the Schedule action.
  let chip;
  if (item.segment_id && segIds.has(item.segment_id)) {
    // The id rides in a data attribute rather than an inline JS string so a
    // hostile id can't break out of the onclick (issue #9).
    chip = `<button class="hli-chip" data-sid="${esc(item.segment_id)}" onclick="hListSeg(this.dataset.sid)" title="Open in itinerary"><i class="ti ti-calendar-check" aria-hidden="true"></i> ${esc(item.segment_id)}</button>`;
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
    <button class="hli-edit hedit-btn" onclick="hOpenEditListItem(${li},${ii})" title="Edit item" aria-label="Edit item"><i class="ti ti-pencil" aria-hidden="true"></i></button>
    <button class="hli-del hedit-btn" onclick="hListDel(${li},${ii})" title="Delete item" aria-label="Delete item"><i class="ti ti-x" aria-hidden="true"></i></button>
    ${item.note ? `<div class="hli-note">${esc(item.note)}</div>` : ''}
  </div>`;
}

/** The undo offer, shown in the list the deleted item came from. */
function undoRow(li) {
  if (!undo || undo.li !== li) return '';
  return `<div class="hli-undo">
    <span>Deleted “${esc(undo.item.name || 'item')}”</span>
    <button class="hli-chip" onclick="hListUndo()"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> Undo</button>
  </div>`;
}

/** The quick-add row under each list — always shown, no edit mode needed. */
function addRow(li) {
  return `<div class="hli-add">
    <input class="hli-add-in" type="text" data-li="${li}" placeholder="Add an item…"
      aria-label="Add an item" onkeydown="hListAddKey(event,${li})">
    <button class="hli-chip" onclick="hListAdd(${li})"><i class="ti ti-plus" aria-hidden="true"></i> Add</button>
  </div>`;
}

const newListBtn = `<button onclick="hOpenAddList()" style="font-size:12px"><i class="ti ti-plus" aria-hidden="true"></i> New list</button>`;

/** The jump strip over the lists (issue #69) — the itinerary's day chips for
    lists, so a long Lists tab is navigable without scrolling through it.
    Keyed by index, like the cards below, so a list with no id still works. */
function jumpNav(lists) {
  if (lists.length < 2) return '';
  return `<div class="hjump-nav">${lists.map((list, li) =>
    `<button class="hjump-chip" data-k="${li}" onclick="hJumpList(this.dataset.k)"><i class="ti ${listIcon(list.kind)}" aria-hidden="true"></i> ${esc(list.name || 'List')}</button>`
  ).join('')}</div>`;
}

export function renderLists() {
  const HD = state.HD;
  const lists = (HD && Array.isArray(HD.lists)) ? HD.lists : [];
  const box = document.getElementById('hvlists');
  if (undo && undo.hd !== HD) undo = null; // a different itinerary was loaded
  if (!lists.length) {
    box.innerHTML = `<div style="font-size:13px;color:var(--color-text-secondary);padding:1rem 0">
      No lists yet. Lists hold intentions that aren't plans — foods to try, packing, restaurant options.
      Add one below, with the AI assistant, or in the itinerary JSON (<code>lists</code>), then tick
      items off here or schedule them into the itinerary.
      <div style="margin-top:.7rem">${newListBtn}</div></div>`;
    return;
  }
  const segIds = new Set((HD.segments || []).map(s => s && s.id).filter(Boolean));
  box.innerHTML = jumpNav(lists) + lists.map((list, li) => {
    const p = listProgress(list);
    const { open, done } = partitionItems(list);
    const row = item => itemRow(item, li, HD.lists[li].items.indexOf(item), segIds);
    return `<div class="hseg hjump-a" data-k="${li}">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ${listIcon(list.kind)}" style="font-size:17px;color:var(--color-text-secondary)" aria-hidden="true"></i>
        <div style="font-size:14px;font-weight:500;flex:1">${esc(list.name)}</div>
        <span class="hli-progress">${p.done}/${p.total}</span>
        <button class="hedit-btn" onclick="hOpenEditList(${li})" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary)" title="Edit list"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>
      <div style="margin-top:8px">${[...open, ...done].map(row).join('') ||
        '<div style="font-size:12px;color:var(--color-text-tertiary)">No items yet.</div>'}</div>
      ${undoRow(li)}${addRow(li)}
    </div>`;
  }).join('') + `<div style="margin-top:.9rem">${newListBtn}</div>`;
  bindJumpSpy('hvlists');
  updateActiveChip('hvlists');
}
