// Pure helpers for lists — the shared checklist/option-pool concept (issue
// #40): pools of intentions that aren't (yet) plans. Items are checked off
// (done) or promoted into an ordinary segment (segment_id); everything the
// views need beyond DOM wiring lives here. The array-of-groups shape lists
// share with the phrasebook lives in lib/collection.js.
import { arr, groupIds, itemIds, plural } from './collection.js';

/** Done/total counts for one list. Tolerates a missing items array. */
export function listProgress(list) {
  const items = arr(list && list.items);
  return { done: items.filter(i => i && i.done).length, total: items.length };
}

/** Partition a list's items into open (unticked) and done, preserving order
    within each half — the views sink done items below the open ones. */
export function partitionItems(list) {
  const items = arr(list && list.items);
  return {
    open: items.filter(i => i && !i.done),
    done: items.filter(i => i && i.done),
  };
}

/** Items in the order the views draw them — open above done, original order
    within each half. The one definition of where a row belongs, and the reason
    a focus key cannot be a rendered position (issue #93): this ordering moves
    a row the moment it is ticked. */
export function displayOrder(list) {
  const { open, done } = partitionItems(list);
  return [...open, ...done];
}

/* What the live region says after each mutation (issue #93). The counts come
   from listProgress, the same call the visible progress badge uses, so the
   spoken and the shown number cannot drift — which is why these are here and
   not spelled out inline in the view. The count is the useful half of the
   sentence: it is the thing a non-visual user cannot see. */

const itemName = item => (item && item.name) || 'Item';
const items = n => plural(n, 'item');

export function toggleMessage(item, list) {
  const p = listProgress(list);
  return `${itemName(item)} ${item && item.done ? 'ticked off' : 'unticked'}. ${p.done} of ${p.total} done.`;
}

export function deleteMessage(item) {
  return `Deleted ${itemName(item)}. Undo available.`;
}

export function restoreMessage(item, list) {
  return `${itemName(item)} restored. ${items(listProgress(list).total)}.`;
}

export function addMessage(item, list) {
  return `${itemName(item)} added. ${items(listProgress(list).total)}.`;
}

/** Every list id in the document — the taken set for newId('list-', …). */
export const takenListIds = doc => groupIds(doc, 'lists');

/** Every item id in the document. Item ids are unique across all lists (the
    schema says so, and segment_id back-references assume it), so an id for a
    new item has to be checked against the whole document, not one list. */
export const takenItemIds = doc => itemIds(doc, 'lists');

/** Items whose segment_id points at no segment in the document (the promoted
    segment was deleted, or the id was mistyped). Returns
    [{listId, itemId, segmentId}] — lint formats these into warnings (issue
    #17) and the Lists view styles the link chip as broken. */
export function danglingListRefs(doc) {
  if (!doc || !Array.isArray(doc.lists)) return [];
  const segIds = new Set(arr(doc.segments).map(s => s && s.id).filter(Boolean));
  const out = [];
  doc.lists.forEach((list, i) => {
    if (!list) return;
    arr(list.items).forEach((item, j) => {
      if (item && item.segment_id && !segIds.has(item.segment_id))
        out.push({ listId: list.id || `#${i + 1}`, itemId: item.id || `#${j + 1}`, segmentId: item.segment_id });
    });
  });
  return out;
}
