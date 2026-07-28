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
import { state } from '../state.js';
import { persist } from '../store.js';
import { esc, safeUrl } from '../lib/escape.js';
import { newId } from '../lib/ids.js';
import {
  listProgress, displayOrder, takenItemIds,
  toggleMessage, deleteMessage, restoreMessage, addMessage,
} from '../lib/lists.js';
import { revealSegment } from '../app.js';
import { jumpTo, bindJumpSpy, updateActiveChip } from './jump-nav.js';
import { keepFocus, announce } from './focus.js';

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
    so no full refreshAfterChange. The whole view is redrawn and the row
    generally moves (displayOrder sinks done items below the open ones), so the
    checkbox that was pressed is put back under the cursor by its document
    position rather than by where it was drawn, and the new count is said out
    loud (issue #93). */
export function toggleListItem(li, ii) {
  const list = state.HD.lists[li];
  const item = list.items[ii];
  item.done = !item.done;
  undo = null;
  persist();
  keepFocus(renderLists);
  announce(toggleMessage(item, list));
}

/** Delete an item outright — no confirm, because the Undo chip below the
    list costs one click and keeps everything the item held (issue #69). Any
    segment it was promoted into is a segment now and stays on the itinerary,
    exactly as it does when the item is deleted from the modal.
    The row focus was on is gone, so focus hands over to the Undo button — which
    is also the only recovery from the delete, and was previously visual-only
    (issue #93). */
export function deleteListItem(li, ii) {
  const list = state.HD.lists[li];
  if (!list || !Array.isArray(list.items)) return;
  const [item] = list.items.splice(ii, 1);
  undo = item ? { hd: state.HD, li, ii, item } : null;
  persist();
  keepFocus(renderLists, `li-undo:${li}`, `li-add:${li}`);
  if (item) announce(deleteMessage(item));
}

/** Put the last deleted item back where it was, and focus lands back on the
    restored item — the Undo button it was on is gone by then. */
export function undoDeleteListItem() {
  if (!undo) return;
  const { li, ii, item } = undo;
  const list = state.HD.lists[li];
  if (list) {
    if (!Array.isArray(list.items)) list.items = [];
    list.items.splice(Math.min(ii, list.items.length), 0, item);
    persist();
  }
  undo = null;
  keepFocus(renderLists, `li-check:${li}:${ii}`, `li-add:${li}`);
  announce(restoreMessage(item, list));
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
  const item = { id: newId('li-', takenItemIds(state.HD)), name };
  list.items.push(item);
  undo = null;
  persist();
  // The hand-rolled re-focus this used to do is now the shared helper's job
  // (issue #93) — same behaviour, and the add box is named like every other
  // control worth returning to.
  keepFocus(renderLists, `li-add:${li}`);
  announce(addMessage(item, list));
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
    // The visible text is the bare id, which announces as "seg-a1b2, button"
    // and says nothing about what pressing it does — hence the fuller name
    // (issue #92). The id is itinerary-supplied, so it goes through esc() in
    // the label exactly as it does in the body (issue #9).
    chip = `<button class="hli-chip" data-sid="${esc(item.segment_id)}" onclick="hListSeg(this.dataset.sid)" title="Open in itinerary" aria-label="Open ${esc(item.segment_id)} in itinerary"><i class="ti ti-calendar-check" aria-hidden="true"></i> ${esc(item.segment_id)}</button>`;
  } else if (item.segment_id) {
    chip = `<span class="hli-chip broken" title="The scheduled segment no longer exists"><i class="ti ti-unlink" aria-hidden="true"></i> ${esc(item.segment_id)}</span>`;
  } else {
    chip = `<button class="hli-chip" onclick="hListSchedule(${li},${ii})" title="Create a segment from this item"><i class="ti ti-calendar-plus" aria-hidden="true"></i> Schedule</button>`;
  }
  // data-focus is what survives the innerHTML rewrite (issue #93): the row is
  // destroyed and rebuilt on every tick, and it moves as well (displayOrder
  // sinks done items below the open ones), so focus is restored by this key
  // rather than by where the control was drawn. The key is the item's position
  // in the *document* — stable across the view's display re-ordering, which is
  // the case that was broken, but not across an index shift: deleting from the
  // middle leaves this key on the item that shifted up into the slot, and the
  // modal-delete test asserts exactly that. An identity key (a WeakMap of item
  // objects) would fix it and is what to reach for if this ever misfires; it
  // buys nothing while the only mutation that shifts indices also destroys the
  // control focus was on. The indices are the view's own, never itinerary data,
  // so they need no escaping.
  return `<li class="hli${item.done ? ' done' : ''}">
    <label class="hli-main">
      <input type="checkbox" data-focus="li-check:${li}:${ii}" ${item.done ? 'checked' : ''} onchange="hListToggle(${li},${ii})">
      <span class="hli-name">${esc(item.name)}${item.local_name ? ` <span class="hli-local">${esc(item.local_name)}</span>` : ''}</span>
    </label>
    ${url ? `<a class="hli-chip" href="${esc(url)}" target="_blank" rel="noopener">Link <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a>` : ''}
    ${chip}
    <button class="hli-edit hedit-btn" data-focus="li-edit:${li}:${ii}" onclick="hOpenEditListItem(${li},${ii})" title="Edit item" aria-label="Edit item"><i class="ti ti-pencil" aria-hidden="true"></i></button>
    <button class="hli-del hedit-btn" data-focus="li-del:${li}:${ii}" onclick="hListDel(${li},${ii})" title="Delete item" aria-label="Delete item"><i class="ti ti-x" aria-hidden="true"></i></button>
    ${item.note ? `<div class="hli-note">${esc(item.note)}</div>` : ''}
  </li>`;
}

/** The undo offer, shown in the list the deleted item came from. */
function undoRow(li) {
  if (!undo || undo.li !== li) return '';
  return `<div class="hli-undo">
    <span>Deleted “${esc(undo.item.name || 'item')}”</span>
    <button class="hli-chip" data-focus="li-undo:${li}" onclick="hListUndo()"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> Undo</button>
  </div>`;
}

/** The quick-add row under each list — always shown, no edit mode needed. */
function addRow(li) {
  return `<div class="hli-add">
    <input class="hli-add-in" type="text" data-li="${li}" data-focus="li-add:${li}" placeholder="Add an item…"
      aria-label="Add an item" onkeydown="hListAddKey(event,${li})">
    <button class="hli-chip" onclick="hListAdd(${li})"><i class="ti ti-plus" aria-hidden="true"></i> Add</button>
  </div>`;
}

const newListBtn = `<button onclick="hOpenAddList()" class="htool"><i class="ti ti-plus" aria-hidden="true"></i> New list</button>`;

/** The jump strip over the lists (issue #69) — the itinerary's day chips for
    lists, so a long Lists tab is navigable without scrolling through it.
    Keyed by index, like the cards below, so a list with no id still works. */
function jumpNav(lists) {
  if (lists.length < 2) return '';
  return `<nav class="hjump-nav" aria-label="Jump to list">${lists.map((list, li) =>
    `<button class="hjump-chip" data-k="${li}" onclick="hJumpList(this.dataset.k)"><i class="ti ${listIcon(list.kind)}" aria-hidden="true"></i> ${esc(list.name || 'List')}</button>`
  ).join('')}</nav>`;
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
    const items = displayOrder(list)
      .map(item => itemRow(item, li, list.items.indexOf(item), segIds))
      .join('');
    return `<section class="hseg hjump-a" data-k="${li}">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ${listIcon(list.kind)}" style="font-size:17px;color:var(--color-text-secondary)" aria-hidden="true"></i>
        <h2 style="margin:0;font-size:14px;font-weight:500;flex:1">${esc(list.name)}</h2>
        <!-- "3/8" announces as "three slash eight". role="img" is what lets the
             badge take an author-supplied name at all — aria-label on a bare
             span (role=generic) is ignored by most screen readers, and the
             visible glyphs stay exactly as they were (issue #92). -->
        <span class="hli-progress" role="img" aria-label="${p.done} of ${p.total} done">${p.done}/${p.total}</span>
        <button class="hpencil hedit-btn" data-focus="list-edit:${li}" onclick="hOpenEditList(${li})" title="Edit list" aria-label="Edit list ${esc(list.name || '')}"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>
      ${items
        ? `<ul class="hplain-list" style="margin-top:8px">${items}</ul>`
        : '<div style="margin-top:8px;font-size:12px;color:var(--color-text-tertiary)">No items yet.</div>'}
      ${undoRow(li)}${addRow(li)}
    </section>`;
  }).join('') + `<div style="margin-top:.9rem">${newListBtn}</div>`;
  bindJumpSpy('hvlists');
  updateActiveChip('hvlists');
}
