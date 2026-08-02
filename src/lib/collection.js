// The shape `lists` and `phrases` have in common (issues #40, #75).
//
// They are deliberately different *concepts* — a list is ticked off, a phrase
// group is reference material — but structurally both are a top-level array of
// groups, each holding an `items` array, with group ids unique in the document
// and item ids unique across every group. That shape, and the tolerance for a
// half-built document, is described once here; lists.js and phrases.js name it
// in their own words. Nothing about ticking off, costing or translating
// belongs in this file.

/** A value as an array — an absent or malformed one reads as empty. A document
    can reach a view unvalidated (the "Load anyway" escape hatch), and a group
    that has only just been added has no `items` yet. */
export const arr = v => (Array.isArray(v) ? v : []);

/** Ids of the groups themselves — the taken set when minting a new group id. */
export function groupIds(doc, key) {
  return new Set(arr(doc && doc[key]).map(g => g && g.id).filter(Boolean));
}

/** Every item id across all groups. Both kinds are document-unique (the schema
    says so, and list `segment_id` back-references assume it), so a new id has
    to be checked against the whole document, not one group. */
export function itemIds(doc, key) {
  const out = new Set();
  for (const group of arr(doc && doc[key]))
    for (const item of arr(group && group.items))
      if (item && item.id) out.add(item.id);
  return out;
}

/** "1 item" / "3 phrases" — the counted half of a live-region sentence. */
export const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
