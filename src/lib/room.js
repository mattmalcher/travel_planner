/**
 * The room record and the rules around it (issue #124): the fourth key space
 * in localStorage, what "unpushed" means, and what an automatically-arriving
 * document is allowed to do.
 *
 *   hShare:<trip_id>  →  { k?, id, enc, created_at, last_push, rev_pushed, etag }
 *
 * A **fourth key space**, deliberately not a field on the index row:
 * `entryFor()` rebuilds every row from the document on each save, so a secret
 * parked there would be wiped by the next `persist()`. Keying by `trip_id`
 * also settles fork inheritance for free — `forkOf` mints a new `trip_id`, so
 * a fork has no record here and cannot push over the original's link.
 *
 * `k` is the master key and its presence is what makes this device a *writer*;
 * a record without it came from a viewer link and can only read. `id` and
 * `enc` are cached derivations, so opening a trip does not re-run HKDF.
 *
 * The record is quota-classed with the **working copy, not history**: a few
 * hundred bytes whose loss orphans a link already sitting in someone's
 * WhatsApp. It is also deliberately *not* in the downloaded JSON — a file is
 * the thing people mail around casually, and a key inside one would silently
 * promote every recipient to writer.
 *
 * The store is a parameter, exactly as in library.js, so every rule below is
 * unit-testable against a plain object.
 */
import { classifyImport, safeSetItem } from './library.js';

export const ROOM_PREFIX = 'hShare:';

export function roomKey(tripId) { return ROOM_PREFIX + tripId; }

/** The room record for a trip, or null. Tolerant of junk: a record that will
    not parse is the same as no room, because the recovery from both is the
    same one tap ("Share live" again). */
export function readRoom(store, tripId) {
  if (!tripId) return null;
  const raw = store.getItem(roomKey(tripId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && typeof v.id === 'string' ? v : null;
  } catch (e) { return null; }
}

/** Quota-guarded, exactly as the working copy is: these few hundred bytes
    carry a key, and losing them orphans a link already sitting in someone's
    WhatsApp. `safeSetItem` spends revision history to make room, which is the
    right trade — history is expendable and a live link is not. */
export function writeRoom(store, tripId, record) {
  safeSetItem(store, roomKey(tripId), JSON.stringify(record));
}

/** Forget the room. Called by "Stop sharing" *as well as* the delete, because
    a room the store has dropped but this device still holds the key to comes
    straight back at the next push — the derived id makes that unavoidable, so
    stopping has to forget the key too. Also called by deleteTrip and
    clearLibrary in library.js: a deleted trip must not leave a live room
    serving its last state until the TTL runs out. */
export function forgetRoom(store, tripId) {
  store.removeItem(roomKey(tripId));
}

/** Whether this device may push to the room it holds. */
export function canWrite(room) { return !!(room && room.k); }

/**
 * How many revisions of local work have not been shared. `persist()` already
 * settles `rev`, so this costs nothing to compute and is the one number the
 * status pill needs: because a push carries the whole document, "unpushed" is
 * a single fact rather than an offline queue of operations.
 */
export function unpushedCount(doc, room) {
  if (!doc || !room) return 0;
  return Math.max(0, (doc.rev || 1) - (room.rev_pushed || 0));
}

/**
 * What an *automatically* pulled document may do. Pull is automatic where push
 * is manual, so this is the rule that keeps a poll from ever interrupting:
 *
 *   apply  local has nothing unpushed and theirs is strictly newer — it lands
 *          silently, which is the whole point of a link that stays current.
 *   drop   older or identical. A mutable slot read through an eventually
 *          consistent store can *regress* (rev 9, then a stale edge serves
 *          rev 8), and a poll that goes backwards must say nothing at all.
 *   park   anything else — a fork, or theirs arriving over unpushed local
 *          edits. Parked, never raised: an automatic pull that threw a
 *          resolve banner over someone's half-finished edit would be worse
 *          than the staleness it was fixing. The pill says changes are
 *          waiting and the user picks the moment.
 */
export function pullAction(incoming, local, room) {
  const { kind, rev, mine } = classifyImport(incoming, local);
  if (kind === 'duplicate' || kind === 'older') return { action: 'drop', kind, rev, mine };
  if (kind === 'new') return { action: 'apply', kind, rev, mine };
  if (kind === 'newer' && unpushedCount(local, room) === 0)
    return { action: 'apply', kind, rev, mine };
  return { action: 'park', kind, rev, mine };
}

/** The record after a successful push: what was sent, and what it now sits on
    top of. `etag` is the store's view of the blob, which the next push offers
    back as its `If-Match` so a conflict is caught at the friendly moment. */
export function pushed(room, doc, etag, nowIso) {
  return { ...room, rev_pushed: doc.rev || 1, etag, last_push: nowIso };
}

/**
 * The rev a document must claim to sit *on top of* theirs rather than beside
 * it. "Keep mine" inside a room cannot mean "push my rev 8 over their rev 8" —
 * the other side would then see a fork, permanently. It means my content,
 * renumbered as the next revision above whichever of us is higher, so the
 * chain stays single and unbroken.
 */
export function aboveRev(mine, theirs) {
  return Math.max(mine || 1, theirs || 1) + 1;
}
