// Interpreter-assigned ids (issue #41): a prefix plus a short random base-36
// suffix, so a hallucinated or guessed id misses and errors loudly instead of
// resolving to whichever real entry it happens to name. Existing documents
// keep their ids — only newly assigned ones use this format.

/** A fresh id ("<prefix><5 random chars>") not present in `taken`. */
export function newId(prefix, taken) {
  let id;
  do { id = prefix + Math.random().toString(36).slice(2, 7); }
  while (id.length < prefix.length + 5 || taken.has(id));
  return id;
}
