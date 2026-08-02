// Phrases view (issue #75): a phrasebook, on its own tab because it is not a
// checklist. A list item is an intention you tick off or schedule; a phrase is
// something you look up mid-conversation and look up again tomorrow, so there
// is no checkbox, no Schedule chip and no done state to sink it down the card.
//
// What the row optimises for is reading it out: the local wording is the big
// line, the pronunciation sits under it, and your own language is the small
// label you scan for. Everything else follows the Lists view's conventions so
// the two tabs behave alike — quick-add and "New group" always on (issue #76),
// the pencils and the inline × behind edit mode with one level of undo (issue
// #69), and a jump strip once there is more than one group.
import { state } from '../state.js';
import { persist } from '../store.js';
import { esc } from '../lib/escape.js';
import { newId } from '../lib/ids.js';
import {
  phraseCount, untranslated, takenPhraseIds,
  deleteMessage, restoreMessage, addMessage,
} from '../lib/phrases.js';
import { jumpTo, bindJumpSpy, updateActiveChip, jumpChip, jumpStrip } from './jump-nav.js';
import { keepFocus, announce } from './focus.js';

/** Tabler icon class for a phrase group's kind. */
export function phraseIcon(kind) {
  return {
    greetings: 'ti-mood-smile',
    food: 'ti-tools-kitchen-2',
    transport: 'ti-train',
    shopping: 'ti-shopping-bag',
    directions: 'ti-directions',
    emergency: 'ti-urgent',
  }[kind] || 'ti-message-language';
}

// One level of undo for the inline delete, held (with the document it came
// from) until the next change to any group. The Lists view keeps its own.
let undo = null; // { hd, gi, pi, phrase }

/** Delete a phrase outright — no confirm, because the Undo chip below the
    group costs one click and keeps everything the phrase held. The row focus
    was on is gone with it, so focus hands over to that Undo button and the
    live region says it is there (issue #93) — it was visual-only before, and
    it is the only recovery from the delete. */
export function deletePhrase(gi, pi) {
  const group = state.HD.phrases[gi];
  if (!group || !Array.isArray(group.items)) return;
  const [phrase] = group.items.splice(pi, 1);
  undo = phrase ? { hd: state.HD, gi, pi, phrase } : null;
  persist();
  keepFocus(renderPhrases, `ph-undo:${gi}`, `ph-add:${gi}`);
  if (phrase) announce(deleteMessage(phrase));
}

/** Put the last deleted phrase back where it was, with focus following it —
    the Undo button it was on does not survive the redraw. */
export function undoDeletePhrase() {
  if (!undo) return;
  const { gi, pi, phrase } = undo;
  const group = state.HD.phrases[gi];
  if (group) {
    if (!Array.isArray(group.items)) group.items = [];
    group.items.splice(Math.min(pi, group.items.length), 0, phrase);
    persist();
  }
  undo = null;
  keepFocus(renderPhrases, `ph-edit:${gi}:${pi}`, `ph-add:${gi}`);
  announce(restoreMessage(phrase, group));
}

/** Scroll to a group from the jump strip, keyed by group index. */
export function jumpToPhraseGroup(key) {
  jumpTo('hvphrases', key);
}

const addInput = gi => document.querySelector(`.hph-add-in[data-gi="${gi}"]`);

/** Quick-add: the typed text becomes a phrase with a fresh document-unique id
    and nothing else. The translation is deliberately not asked for here — the
    common case is jotting down what you need to be able to say and filling in
    the local wording later (by hand in the modal, or by asking the AI). */
export function addPhrase(gi) {
  const el = addInput(gi);
  if (!el) return;
  const text = el.value.trim();
  if (!text) { el.focus(); return; }
  const group = state.HD.phrases[gi];
  if (!Array.isArray(group.items)) group.items = [];
  const phrase = { id: newId('ph-', takenPhraseIds(state.HD)), text };
  group.items.push(phrase);
  undo = null;
  persist();
  keepFocus(renderPhrases, `ph-add:${gi}`); // shared helper since issue #93
  announce(addMessage(phrase, group));
}

/** Enter in the quick-add box adds the phrase (a lone input has no form). */
export function addPhraseKey(ev, gi) {
  if (ev.key === 'Enter') { ev.preventDefault(); addPhrase(gi); }
}

function phraseRow(phrase, gi, pi) {
  // Untranslated is a normal state, not an error: the row says so plainly and
  // the pencil is where the local wording gets filled in.
  const local = phrase.local
    ? `<div class="hph-local">${esc(phrase.local)}</div>`
    : `<div class="hph-local hph-todo">Not translated yet</div>`;
  return `<div class="hph">
    <div class="hph-main">
      <div class="hph-text">${esc(phrase.text)}</div>
      ${local}
      ${phrase.pronunciation ? `<div class="hph-say">${esc(phrase.pronunciation)}</div>` : ''}
      ${phrase.note ? `<div class="hph-note">${esc(phrase.note)}</div>` : ''}
    </div>
    <div class="hph-acts">
      <button class="hph-edit hedit-btn" data-focus="ph-edit:${gi}:${pi}" onclick="hOpenEditPhrase(${gi},${pi})" title="Edit phrase" aria-label="Edit phrase"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      <button class="hph-del hedit-btn" data-focus="ph-del:${gi}:${pi}" onclick="hPhraseDel(${gi},${pi})" title="Delete phrase" aria-label="Delete phrase"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>
  </div>`;
}

/** The undo offer, shown in the group the deleted phrase came from. */
function undoRow(gi) {
  if (!undo || undo.gi !== gi) return '';
  return `<div class="hli-undo">
    <span>Deleted “${esc(undo.phrase.text || 'phrase')}”</span>
    <button class="hli-chip" data-focus="ph-undo:${gi}" onclick="hPhraseUndo()"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> Undo</button>
  </div>`;
}

/** The quick-add row under each group — always shown, no edit mode needed. */
function addRow(gi) {
  return `<div class="hli-add">
    <input class="hph-add-in hli-add-in" type="text" data-gi="${gi}" data-focus="ph-add:${gi}" placeholder="Something to be able to say…"
      aria-label="Add a phrase" onkeydown="hPhraseAddKey(event,${gi})">
    <button class="hli-chip" onclick="hPhraseAdd(${gi})"><i class="ti ti-plus" aria-hidden="true"></i> Add</button>
  </div>`;
}

const newGroupBtn = `<button onclick="hOpenAddPhraseGroup()" class="htool"><i class="ti ti-plus" aria-hidden="true"></i> New group</button>`;

/** The jump strip over the groups — the same widget the Itinerary and Lists
    views use, keyed by index so a group with no id still works. */
function jumpNav(groups) {
  if (groups.length < 2) return '';
  return jumpStrip('Jump to phrase group', groups.map((group, gi) =>
    jumpChip(gi, 'hJumpPhraseGroup', esc(group.name || 'Phrases'), { icon: phraseIcon(group.kind) })));
}

export function renderPhrases() {
  const HD = state.HD;
  const groups = (HD && Array.isArray(HD.phrases)) ? HD.phrases : [];
  const box = document.getElementById('hvphrases');
  if (undo && undo.hd !== HD) undo = null; // a different itinerary was loaded
  if (!groups.length) {
    box.innerHTML = `<div class="hempty">
      No phrases yet. A phrasebook holds things you want to be able to say — greetings, ordering food,
      asking directions — grouped by situation, for looking up on the day. Add a group below, ask the
      AI assistant to build and translate one, or write them into the itinerary JSON (<code>phrases</code>).
      <div style="margin-top:.7rem">${newGroupBtn}</div></div>`;
    return;
  }
  box.innerHTML = jumpNav(groups) + groups.map((group, gi) => {
    const items = Array.isArray(group.items) ? group.items.filter(Boolean) : [];
    const todo = untranslated(group).length;
    return `<div class="hseg hjump-a" data-k="${gi}">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ${phraseIcon(group.kind)} hcard-ic" aria-hidden="true"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:500">${esc(group.name)}</div>
          ${group.language ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:1px">${esc(group.language)}</div>` : ''}
        </div>
        ${todo ? `<span class="hli-progress hph-todo-count" title="Phrases with no translation yet">${todo} to translate</span>` : ''}
        <span class="hli-progress">${phraseCount(group)}</span>
        <button class="hpencil hedit-btn" data-focus="group-edit:${gi}" onclick="hOpenEditPhraseGroup(${gi})" title="Edit group"><i class="ti ti-pencil" aria-hidden="true"></i></button>
      </div>
      <div style="margin-top:8px">${items.map(p => phraseRow(p, gi, group.items.indexOf(p))).join('') ||
        '<div style="font-size:12px;color:var(--color-text-tertiary)">No phrases yet.</div>'}</div>
      ${undoRow(gi)}${addRow(gi)}
    </div>`;
  }).join('') + `<div style="margin-top:.9rem">${newGroupBtn}</div>`;
  bindJumpSpy('hvphrases');
  updateActiveChip('hvphrases');
}
