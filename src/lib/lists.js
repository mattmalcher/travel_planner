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
