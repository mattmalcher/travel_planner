// The app's one live region (issue #93): the announcement channel for changes
// a view makes to itself, where nothing visible says what happened — a ticked
// item sinking down its list, a deleted row and the Undo offer that replaces
// it. Polite (role="status"), never assertive: none of this is worth
// interrupting whatever is being read.
//
// The region lives in src/index.html rather than being created here, and that
// is the whole reason this module is four lines: a region created and written
// to in the same frame is not reliably announced (the usual way this gets
// built, and it fails silently). It exists from the first paint, so writing to
// it is a plain textContent assignment.
//
// It is deliberately not cleared afterwards: a reader announces the *change*,
// so blanking the region later would be a second, empty announcement.

/** Say something in the live region. Text only — a message is a sentence a
    screen reader reads out, so it carries no markup and needs no escaping. */
export function announce(message) {
  const el = document.getElementById('hlive');
  if (el) el.textContent = message;
}
