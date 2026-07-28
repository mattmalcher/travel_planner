// Pure helpers for lists — the shared checklist/option-pool concept (issue
// #40): pools of intentions that aren't (yet) plans. Items are checked off
// (done) or promoted into an ordinary segment (segment_id); everything the
// views need beyond DOM wiring lives here.

/** Done/total counts for one list. Tolerates a missing items array. */
export function listProgress(list) {
  const items = (list && Array.isArray(list.items)) ? list.items : [];
  return { done: items.filter(i => i && i.done).length, total: items.length };
}

/** Partition a list's items into open (unticked) and done, preserving order
    within each half — the views sink done items below the open ones. */
export function partitionItems(list) {
  const items = (list && Array.isArray(list.items)) ? list.items : [];
  return {
    open: items.filter(i => i && !i.done),
    done: items.filter(i => i && i.done),
  };
}

/** Items in the order the views draw them — open above done, original order
    within each half. The one definition of where a row belongs, so a row moved
    in place after a tick (issue #93) lands exactly where a full redraw would
    have put it. */
export function displayOrder(list) {
  const { open, done } = partitionItems(list);
  return [...open, ...done];
}

/** Locate an item inside a document by object identity: {li, ii, list, item},
    or null once the item is no longer in the document.
    Identity rather than an id or an index, because the Lists view mutates rows
    in place (issue #93) and both of the alternatives go stale: an id is only
    unique in a document that validates, and every index after a deleted row
    shifts down while the rows around it stay on the page. */
export function locateItem(doc, item) {
  const lists = (doc && Array.isArray(doc.lists)) ? doc.lists : [];
  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    const items = (list && Array.isArray(list.items)) ? list.items : [];
    const ii = items.indexOf(item);
    if (ii >= 0) return { li, ii, list, item };
  }
  return null;
}

/* What the live region says after each mutation (issue #93). Counts come from
   listProgress, so the spoken sentence and the visible badge cannot drift.
   Every message carries a name and a count, which is also what keeps two
   consecutive announcements textually different — a live region written with
   the text it already holds is not a DOM change, and announces nothing. */

const itemName = item => (item && item.name) || 'Item';
const items = n => `${n} item${n === 1 ? '' : 's'}`;

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
export function takenListIds(doc) {
  const lists = (doc && Array.isArray(doc.lists)) ? doc.lists : [];
  return new Set(lists.map(l => l && l.id).filter(Boolean));
}

/** Every item id in the document. Item ids are unique across all lists (the
    schema says so, and segment_id back-references assume it), so an id for a
    new item has to be checked against the whole document, not one list. */
export function takenItemIds(doc) {
  const lists = (doc && Array.isArray(doc.lists)) ? doc.lists : [];
  const out = new Set();
  for (const list of lists)
    for (const item of (list && Array.isArray(list.items)) ? list.items : [])
      if (item && item.id) out.add(item.id);
  return out;
}

/** Items whose segment_id points at no segment in the document (the promoted
    segment was deleted, or the id was mistyped). Returns
    [{listId, itemId, segmentId}] — lint formats these into warnings (issue
    #17) and the Lists view styles the link chip as broken. */
export function danglingListRefs(doc) {
  if (!doc || !Array.isArray(doc.lists)) return [];
  const segIds = new Set((Array.isArray(doc.segments) ? doc.segments : []).map(s => s && s.id).filter(Boolean));
  const out = [];
  doc.lists.forEach((list, i) => {
    if (!list) return;
    (Array.isArray(list.items) ? list.items : []).forEach((item, j) => {
      if (item && item.segment_id && !segIds.has(item.segment_id))
        out.push({ listId: list.id || `#${i + 1}`, itemId: item.id || `#${j + 1}`, segmentId: item.segment_id });
    });
  });
  return out;
}
