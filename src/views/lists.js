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
//
// Mutations touch only the row they are about (issue #93). This is the view
// where a keyboard user works down a list ticking things off, and a
// `box.innerHTML = …` per tick destroyed the checkbox they were standing on:
// focus fell to <body> and the next Tab started from the top of the document —
// a 3.2.2 (On Input) failure that made the view impractical to use without
// sight. So each handler mutates the document, then patches the row, the
// progress badge and the Undo offer, and says what changed in the shared live
// region (views/live.js). renderLists() is still the full redraw, for loading
// a trip and for anything structural (lists added or removed via the modal).
import { state } from '../state.js';
import { persist } from '../store.js';
import { esc, safeUrl } from '../lib/escape.js';
import { newId } from '../lib/ids.js';
import {
  listProgress, takenItemIds, displayOrder, locateItem,
  toggleMessage, deleteMessage, restoreMessage, addMessage,
} from '../lib/lists.js';
import { revealSegment, openScheduleItem, openEditListItem } from '../app.js';
import { jumpTo, bindJumpSpy, updateActiveChip } from './jump-nav.js';
import { announce } from './live.js';

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

/* How a row in the DOM names the item it draws (issue #93). A row outlives the
   mutations around it now, so it cannot be keyed by index — every index after a
   deleted item shifts while the rows stay put. It is not keyed by `item.id`
   either: an id is only unique in a document that validates, and "Load anyway"
   can put two of the same one on the page, which would aim a click at the wrong
   item. Instead each item object gets an opaque key, minted on first render and
   stable for as long as the object lives; a click resolves the key back to the
   object and lib/lists.js locates it by identity. Keys are generated here, so
   they are safe to interpolate into an inline handler as-is. */
const itemKeys = new WeakMap(); // item object → key
let rowKeys = new Map(); // key → item object, for the inline handlers
let keySeq = 0;

function keyOf(item) {
  let key = itemKeys.get(item);
  if (!key) { key = 'ik' + (++keySeq); itemKeys.set(item, key); }
  rowKeys.set(key, item);
  return key;
}

/** Resolve a row key to {li, ii, list, item}, or null if the item has left the
    document (a reload, an AI edit, a restored revision) — in which case the
    caller redraws rather than patching a row that no longer means anything. */
function resolveRow(key) {
  const item = rowKeys.get(key);
  return item ? locateItem(state.HD, item) : null;
}

/* --- the pieces of the view an in-place mutation has to keep in step --- */

const listsBox = () => document.getElementById('hvlists');
const sectionEl = li => { const b = listsBox(); return b && b.querySelector(`.hjump-a[data-k="${li}"]`); };
const rowEl = key => { const b = listsBox(); return b && b.querySelector(`.hli[data-ik="${key}"]`); };
const segmentIds = () => new Set((state.HD && state.HD.segments || []).map(s => s && s.id).filter(Boolean));

/** The counts badge, visible text and accessible name together (issue #92) —
    they come from the same listProgress call the full render uses. */
function syncProgress(sec, list) {
  const p = listProgress(list);
  const badge = sec.querySelector('.hli-progress');
  if (!badge) return;
  badge.textContent = `${p.done}/${p.total}`;
  badge.setAttribute('aria-label', `${p.done} of ${p.total} done`);
}

/** The <ul> of rows, created (replacing the "No items yet" note) if this list
    had none. Returns null if the section is not shaped as expected, which
    sends the caller to a full redraw. */
function rowsHost(sec) {
  let ul = sec.querySelector('.hplain-list');
  if (ul) return ul;
  const note = sec.querySelector('.hli-empty');
  if (!note) return null;
  note.insertAdjacentHTML('beforebegin', itemsUl(''));
  ul = sec.querySelector('.hplain-list');
  note.remove();
  return ul;
}

/** Swap the (now empty) <ul> back for the note, so deleting the last item
    leaves the same markup a full redraw would. */
function pruneRows(sec) {
  const ul = sec.querySelector('.hplain-list');
  if (ul && !ul.querySelector('.hli')) {
    ul.insertAdjacentHTML('beforebegin', EMPTY_ITEMS);
    ul.remove();
  }
}

/** The row that should follow `item`, per the model's display order — null
    when the item belongs last. */
function beforeRow(ul, list, item) {
  const order = displayOrder(list);
  const next = order[order.indexOf(item) + 1];
  return next ? ul.querySelector(`.hli[data-ik="${keyOf(next)}"]`) : null;
}

/** Draw a new row into its display position. */
function insertRow(sec, li, list, item) {
  const ul = rowsHost(sec);
  if (!ul) return null;
  const key = keyOf(item);
  const before = beforeRow(ul, list, item);
  const html = itemRow(item, li, segmentIds());
  if (before) before.insertAdjacentHTML('beforebegin', html);
  else ul.insertAdjacentHTML('beforeend', html);
  return rowEl(key);
}

/** Move an existing row to where the model now says it goes (a ticked item
    sinks below the open ones). Re-inserting a node blurs whatever was focused
    inside it, so focus is put back on the very element it was on — the point
    of the exercise. */
function moveRow(row, list, item) {
  const ul = row.parentElement;
  if (!ul) return;
  const before = beforeRow(ul, list, item);
  if (before === row.nextElementSibling) return;
  const active = document.activeElement;
  const refocus = row.contains(active) ? active : null;
  ul.insertBefore(row, before);
  if (refocus) refocus.focus();
}

/** The Undo offer never survives a change to any list, so dropping it is a
    sweep of the view rather than a per-section fix-up. */
function clearUndoRows() {
  const b = listsBox();
  if (b) b.querySelectorAll('.hli-undo').forEach(el => el.remove());
}

/** Put the current Undo offer above the quick-add row of the list it belongs
    to, and return its button so a delete can hand focus over. */
function showUndoRow(sec, li) {
  const anchor = sec.querySelector('.hli-add');
  const html = undoRow(li);
  if (!anchor || !html) return null;
  anchor.insertAdjacentHTML('beforebegin', html);
  return sec.querySelector('.hli-undo .hli-chip');
}

/* --- mutations --- */

/** Toggle an item's done flag and patch its row: the tick, the class that
    greys it, its new position among the done items, and the counts. Only this
    view changes, so no full refreshAfterChange. */
export function toggleListItem(key) {
  const at = resolveRow(key);
  if (!at) { renderLists(); return; }
  const { list, item, li } = at;
  item.done = !item.done;
  undo = null;
  persist();
  const sec = sectionEl(li), row = rowEl(key);
  if (!sec || !row) { renderLists(); return; }
  clearUndoRows();
  row.classList.toggle('done', !!item.done);
  const cb = row.querySelector('input[type=checkbox]');
  if (cb) cb.checked = !!item.done;
  moveRow(row, list, item);
  syncProgress(sec, list);
  announce(toggleMessage(item, list));
}

/** Delete an item outright — no confirm, because the Undo chip below the
    list costs one click and keeps everything the item held (issue #69). Any
    segment it was promoted into is a segment now and stays on the itinerary,
    exactly as it does when the item is deleted from the modal.
    The row the × lived on is gone, so focus moves to that Undo chip: it is the
    only way back and it disappears on the next change, which a non-visual user
    would otherwise never know about at all (issue #93). */
export function deleteListItem(key) {
  const at = resolveRow(key);
  if (!at) { renderLists(); return; }
  const { list, item, li, ii } = at;
  list.items.splice(ii, 1);
  undo = { hd: state.HD, li, ii, item };
  persist();
  const sec = sectionEl(li), row = rowEl(key);
  if (!sec || !row) { renderLists(); return; }
  clearUndoRows();
  row.remove();
  pruneRows(sec);
  syncProgress(sec, list);
  announce(deleteMessage(item));
  const btn = showUndoRow(sec, li);
  if (btn) btn.focus();
}

/** Put the last deleted item back where it was, and leave focus on its
    checkbox — the row the user was working on is back, so that is where they
    were. */
export function undoDeleteListItem() {
  if (!undo) return;
  const { li, ii, item } = undo;
  const list = state.HD.lists[li];
  undo = null;
  if (!list) { renderLists(); return; }
  if (!Array.isArray(list.items)) list.items = [];
  list.items.splice(Math.min(ii, list.items.length), 0, item);
  persist();
  const sec = sectionEl(li);
  if (!sec) { renderLists(); return; }
  clearUndoRows();
  const row = insertRow(sec, li, list, item);
  if (!row) { renderLists(); return; }
  syncProgress(sec, list);
  announce(restoreMessage(item, list));
  const cb = row.querySelector('input[type=checkbox]');
  if (cb) cb.focus();
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

/* The row's two modal actions resolve their key here and hand app.js the
   indices it works in — the modal edits a path into the document, and a key is
   a view concept. */

export function scheduleListItem(key) {
  const at = resolveRow(key);
  if (at) openScheduleItem(at.li, at.ii);
}

export function editListItem(key) {
  const at = resolveRow(key);
  if (at) openEditListItem(at.li, at.ii);
}

const addInput = li => document.querySelector(`.hli-add-in[data-li="${li}"]`);

/** Quick-add: the typed name becomes an item with a fresh document-unique id
    and nothing else — everything optional is left to the item's edit modal.
    The box is the same element afterwards (nothing is redrawn), so it is
    simply emptied and kept focused, and a run of items can be typed one after
    another. */
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
  const sec = sectionEl(li);
  if (!sec) { renderLists(); return; }
  clearUndoRows();
  if (!insertRow(sec, li, list, item)) { renderLists(); return; }
  syncProgress(sec, list);
  announce(addMessage(item, list));
  el.value = '';
  el.focus();
}

/** Enter in the quick-add box adds the item (a lone input has no form to
    submit, so the key is handled here). */
export function addListItemKey(ev, li) {
  if (ev.key === 'Enter') { ev.preventDefault(); addListItem(li); }
}

function itemRow(item, li, segIds) {
  const key = keyOf(item);
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
    chip = `<button class="hli-chip" onclick="hListSchedule('${key}')" title="Create a segment from this item"><i class="ti ti-calendar-plus" aria-hidden="true"></i> Schedule</button>`;
  }
  return `<li class="hli${item.done ? ' done' : ''}" data-ik="${key}">
    <label class="hli-main">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="hListToggle('${key}')">
      <span class="hli-name">${esc(item.name)}${item.local_name ? ` <span class="hli-local">${esc(item.local_name)}</span>` : ''}</span>
    </label>
    ${url ? `<a class="hli-chip" href="${esc(url)}" target="_blank" rel="noopener">Link <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a>` : ''}
    ${chip}
    <button class="hli-edit hedit-btn" onclick="hOpenEditListItem('${key}')" title="Edit item" aria-label="Edit item"><i class="ti ti-pencil" aria-hidden="true"></i></button>
    <button class="hli-del hedit-btn" onclick="hListDel('${key}')" title="Delete item" aria-label="Delete item"><i class="ti ti-x" aria-hidden="true"></i></button>
    ${item.note ? `<div class="hli-note">${esc(item.note)}</div>` : ''}
  </li>`;
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

// The rows and the "no rows" note, in one place each: an in-place mutation
// swaps between them (rowsHost/pruneRows), so the markup a delete leaves behind
// has to be the markup a full redraw would have produced.
const itemsUl = rows => `<ul class="hplain-list" style="margin-top:8px">${rows}</ul>`;
const EMPTY_ITEMS = '<div class="hli-empty" style="margin-top:8px;font-size:12px;color:var(--color-text-tertiary)">No items yet.</div>';

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
  // Every row is about to be replaced, so the keys of the rows that were on
  // the page stop meaning anything. (Items keep their key via the WeakMap; a
  // click on a stale row simply resolves to nothing and redraws.)
  rowKeys = new Map();
  if (!lists.length) {
    box.innerHTML = `<div style="font-size:13px;color:var(--color-text-secondary);padding:1rem 0">
      No lists yet. Lists hold intentions that aren't plans — foods to try, packing, restaurant options.
      Add one below, with the AI assistant, or in the itinerary JSON (<code>lists</code>), then tick
      items off here or schedule them into the itinerary.
      <div style="margin-top:.7rem">${newListBtn}</div></div>`;
    return;
  }
  const segIds = segmentIds();
  box.innerHTML = jumpNav(lists) + lists.map((list, li) => {
    const p = listProgress(list);
    const items = displayOrder(list).map(item => itemRow(item, li, segIds)).join('');
    return `<section class="hseg hjump-a" data-k="${li}">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ${listIcon(list.kind)}" style="font-size:17px;color:var(--color-text-secondary)" aria-hidden="true"></i>
        <h2 style="margin:0;font-size:14px;font-weight:500;flex:1">${esc(list.name)}</h2>
        <!-- "3/8" announces as "three slash eight". role="img" is what lets the
             badge take an author-supplied name at all — aria-label on a bare
             span (role=generic) is ignored by most screen readers, and the
             visible glyphs stay exactly as they were (issue #92). -->
        <span class="hli-progress" role="img" aria-label="${p.done} of ${p.total} done">${p.done}/${p.total}</span>
        <button class="hpencil hedit-btn" onclick="hOpenEditList(${li})" title="Edit list" aria-label="Edit list ${esc(list.name || '')}"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>
      ${items ? itemsUl(items) : EMPTY_ITEMS}
      ${undoRow(li)}${addRow(li)}
    </section>`;
  }).join('') + `<div style="margin-top:.9rem">${newListBtn}</div>`;
  bindJumpSpy('hvlists');
  updateActiveChip('hvlists');
}
