// Pure helpers for the phrasebook (issue #75). Phrases are the third kind of
// thing a document holds, after segments (plans) and lists (intentions): they
// are reference material. Nothing here is checked off, scheduled or costed —
// a phrase group is a heading and a handful of things to say under it.
//
// Ids mirror the list rules: group ids unique in the document, phrase ids
// unique across *all* groups (the AI tools address a phrase by id alone).

/** Every phrase group in the document — the taken set for newId('phr-', …). */
export function takenGroupIds(doc) {
  const groups = (doc && Array.isArray(doc.phrases)) ? doc.phrases : [];
  return new Set(groups.map(g => g && g.id).filter(Boolean));
}

/** Every phrase id in the document. Phrase ids are document-unique, so an id
    for a new phrase has to be checked against every group, not just its own. */
export function takenPhraseIds(doc) {
  const groups = (doc && Array.isArray(doc.phrases)) ? doc.phrases : [];
  const out = new Set();
  for (const group of groups)
    for (const phrase of (group && Array.isArray(group.items)) ? group.items : [])
      if (phrase && phrase.id) out.add(phrase.id);
  return out;
}

/** How many phrases a group holds — the count badge on its card. Tolerates a
    missing items array (a group that has only just been created). */
export function phraseCount(group) {
  const items = (group && Array.isArray(group.items)) ? group.items : [];
  return items.filter(Boolean).length;
}

/** Phrases with no local wording yet: jotted down but not translated. The view
    counts them into the "n to translate" hint, which is the phrasebook's
    equivalent of a list's done/total progress. */
export function untranslated(group) {
  const items = (group && Array.isArray(group.items)) ? group.items : [];
  return items.filter(p => p && !p.local);
}
