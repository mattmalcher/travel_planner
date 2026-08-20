/**
 * Live sharing, the browser half (issue #124): a share link that stays
 * current, and — with an edit link — several people on one plan.
 *
 * A `s1` share (issue #116) freezes the trip as it was the moment it was sent.
 * A **room** is the same stored blob made replaceable, addressed by an id
 * derived from a master key the page never transmits (lib/room-keys.js). What
 * that buys is a link you can keep: update the trip, tap Update, and every
 * link already sent shows the new version.
 *
 * The two cadences are deliberately asymmetric, and the asymmetry is what
 * keeps the whole thing simple:
 *
 *   **Push is manual.** `persist()` runs on every mutation, so pushing on it
 *   would be a network write per ticked checkbox — and the free tier's 1,000
 *   writes/day is *one Cloudflare account's quota shared by everyone using the
 *   deployed page*. An explicit "Update shared copy" bounds writes by human
 *   taps. No debounce, no `pagehide` flush, no in-flight serialisation. The
 *   cost is staleness nobody can see, so the status pill carries it.
 *
 *   **Pull is automatic** — on open, on focus, and a slow poll while the tab
 *   is visible. Reads carry the freshness instead, and they are ten times
 *   cheaper. An automatically arriving document may only land *silently*
 *   (lib/room.js `pullAction`); anything needing a decision is parked and the
 *   pill says so, because a resolve banner thrown over a half-finished edit is
 *   worse than the staleness it was fixing.
 *
 * **The room is never the source of truth.** The localStorage library is; the
 * room is transport. `file://`, offline, an empty `SHARE_ENDPOINT` and a spent
 * quota all keep working — sync just doesn't happen, and "Send a copy" still
 * produces a link, which is the same silent-fallback discipline `hostedLink()`
 * follows.
 *
 * Because the local library is authoritative, no failure here can lose a trip.
 * The compare-and-set at the store is best-effort (KV cannot do a real one),
 * so the guarantee is the revision chain: *a missed 409 degrades a push-time
 * conflict into a pull-time fork; it never silently discards anyone's trip.*
 */
import { state, H_SCHEMA_VERSION } from './state.js';
import { load, showUploadWarning, resolveWarning, hideWarning } from './app.js';
import { persist, importKind, asFork, updatedBy, setUpdatedBy } from './store.js';
import { esc } from './lib/escape.js';
import {
  readRoom, writeRoom, forgetRoom, canWrite, pullAction, pushed, aboveRev,
} from './lib/room.js';
import { newMasterKey, deriveRoom, digest } from './lib/room-keys.js';
import { encryptWith, decryptShare } from './lib/share-crypto.js';
import { shareDocument, parseShareDocument, parseRoom, writerUrl, viewerUrl } from './lib/sharelink.js';
import {
  hasShareStore, putRoom, getShare, deleteRoom, SHARE_TTL_DAYS,
} from './share-store.js';
import { shareToast, shareDoc, copyLink } from './share.js';
import { renderRoom, renderShareSheet, currentRoom, letThemEdit } from './views/room.js';

export { renderRoom, currentRoom, canShareLive } from './views/room.js';

const store = localStorage;

/**
 * How often a visible tab looks for someone else's changes. Reads are 100k/day
 * *across the whole deployment* — about one a second in aggregate — so a
 * 60-second floor, gated on visibility and on a room existing at all, keeps a
 * generous number of users inside a few thousand reads a day. This is a floor,
 * not a target: the honest description of the feature is "syncs when you ask
 * it to", and the poll is a convenience on top.
 */
export const POLL_MS = 60000;

const nowIso = () => new Date().toISOString();
const tripId = () => (state.HD ? state.HD.trip_id : null);

/* --- pushing ------------------------------------------------------------- */

/**
 * Mint a room for the open trip and put the first version in it.
 * Returns the room record, or null when the store refused — in which case
 * nothing is written locally, so the sheet still offers a snapshot instead.
 */
async function startRoom() {
  const id = tripId();
  const k = newMasterKey();
  const { id: rid, encKey } = await deriveRoom(k);
  writeRoom(store, id, {
    k, id: rid, enc: encKey, created_at: nowIso(), rev_pushed: 0, etag: null,
  });
  if (await pushRoom({ quiet: true })) return readRoom(store, id);
  forgetRoom(store, id);
  return null;
}

/**
 * Send the trip as it now stands. Manual, always — this is the only thing that
 * spends a write.
 *
 * Resolves true when the room now holds this revision. A conflict resolves
 * false and raises the banner: the friendly moment to be told someone else
 * changed it is the second after you asked to send it.
 */
export async function pushRoom({ quiet = false } = {}) {
  const id = tripId();
  const room = readRoom(store, id);
  if (!state.HD || !canWrite(room)) return false;
  const { id: rid, encKey, token } = await deriveRoom(room.k);
  const payload = shareDocument(state.HD, H_SCHEMA_VERSION);
  const bytes = await encryptWith(JSON.stringify(payload), encKey);
  let result;
  try {
    result = await putRoom(rid, bytes, token, room.etag);
  } catch (e) {
    if (e && e.conflict) { await raiseConflict(e.current, room, 'push'); return false; }
    if (!quiet) {
      shareToast(e && e.forbidden
        ? 'That shared trip does not accept changes from this device.'
        : `Could not send the update: ${e.message || e}. Your trip is saved here — try again.`);
    }
    return false;
  }
  writeRoom(store, id, pushed(room, payload, await digest(bytes), nowIso()));
  renderRoom();
  if (!quiet) shareToast(`Shared copy updated. The link works for ${SHARE_TTL_DAYS} days from now.`);
  // Swap semantics: the store hands back what this push replaced, so a write
  // that slipped past the store's advisory If-Match is caught here, seconds
  // later, instead of at the other person's next pull.
  if (result.previous && await digest(result.previous) !== room.etag)
    await raiseConflict(result.previous, room, 'swap');
  return true;
}

/* --- pulling ------------------------------------------------------------- */

/**
 * Look for someone else's changes. Silent about every failure: a room that has
 * lapsed, a tab that is offline and a store that is down are all normal states
 * for a poll, and none of them is the user's problem while their own copy is
 * sitting in front of them, authoritative.
 */
export async function pullRoom() {
  const id = tripId();
  const room = readRoom(store, id);
  if (!room || !state.HD || !hasShareStore()) return;
  let bytes;
  // No retry ladder: a room that is not there is a normal state for a poll.
  try { bytes = await getShare(room.id, []); } catch (e) { return; }
  const etag = await digest(bytes);
  if (etag === room.etag) return; // the version we already have
  let doc;
  try { doc = parseShareDocument(await decryptShare(bytes, room.enc)); } catch (e) { return; }
  const incoming = importKind(doc).doc;
  const act = pullAction(incoming, state.HD, room);
  if (act.action === 'drop') return;
  // `pullAction` sees persisted revisions, not the half-done edit in front of
  // the user: the edit modal open with nothing saved yet is exactly
  // "nothing unpushed", and a `load()` under it would leave `saveEdit`
  // writing by index into a document whose indices may have moved. Same for
  // an AI draft, computed against the document that would be swapped out.
  // Deferred rather than parked — nothing is stored, so the next pull (the
  // poll, or focus) fetches it again and it lands once the edit is done.
  if (act.action === 'apply' && (state.editTarget || state.draft)) return;
  if (act.action === 'apply') {
    load(incoming);
    writeRoom(store, id, { ...readRoom(store, id), rev_pushed: incoming.rev || 1, etag });
    renderRoom();
    return;
  }
  // Parked, not raised. The pill is how it gets said.
  state.roomWaiting = { doc: incoming, etag, kind: act.kind, rev: act.rev, mine: act.mine };
  renderRoom();
}

/* --- conflicts ----------------------------------------------------------- */

/** Decrypt what the store had and park it as a decision. `origin` only changes
    the wording: 'push' is "you tapped Update and they had moved", 'swap' is
    "your update went in over one you hadn't seen". */
async function raiseConflict(bytes, room, origin) {
  let doc;
  try { doc = parseShareDocument(await decryptShare(bytes, room.enc)); } catch (e) { return; }
  const incoming = importKind(doc).doc;
  state.roomWaiting = {
    doc: incoming,
    etag: await digest(bytes),
    kind: 'fork',
    rev: incoming.rev || 1,
    mine: (state.HD && state.HD.rev) || 1,
    origin,
  };
  renderRoom();
  reviewWaiting();
}

/**
 * Put the parked document to the user. The single warning banner, through the
 * one function that raises it, parked in a `state.pending*` slot so that every
 * button answering it goes through `resolveWarning` and the banner cannot be
 * left on screen after the decision it asked about is settled.
 */
export function reviewWaiting() {
  const waiting = state.roomWaiting;
  if (!waiting) return;
  state.pendingRoom = waiting;
  state.roomWaiting = null;
  const name = esc((waiting.doc.trip && waiting.doc.trip.name) || 'this trip');
  const intro = waiting.origin === 'swap'
    ? `Your update to <b>${name}</b> went out over a change someone else had made and this copy had not seen yet — nothing is lost, but the two need reconciling.`
    : waiting.origin === 'push'
      ? `Someone else changed <b>${name}</b> before your update went out.`
      : `Someone else has changed <b>${name}</b>.`;
  showUploadWarning('arrows-exchange', 'The shared copy has moved on',
    `${intro} Theirs is rev ${waiting.rev}; yours is rev ${waiting.mine}.
     <b>Take theirs</b> replaces what is here. <b>Keep mine</b> puts your version on top of theirs
     and sends it. <b>Keep both</b> lets the shared trip become theirs and keeps yours as a separate
     trip, out of the share.`,
    [
      '<button onclick="hRoomTheirs()" class="htool">Take theirs</button>',
      '<button onclick="hRoomMine()" class="htool">Keep mine</button>',
      '<button onclick="hRoomBoth()" class="htool">Keep both</button>',
      '<button onclick="hRoomLater()" class="htool">Later</button>',
    ]);
}

/**
 * Record what the room actually holds, as the decision has just shown it.
 * Both answers push over *their* version, so the next PUT has to offer their
 * etag as its `If-Match` — otherwise resolving a conflict is itself detected
 * as a clobber and raises the same banner again, forever.
 */
function baseOn(w) {
  const id = tripId();
  const room = readRoom(store, id);
  if (room) writeRoom(store, id, { ...room, etag: w.etag, rev_pushed: w.rev });
}

/** Take theirs: their document becomes this trip's content. `persist()` gives
    it the next rev locally, which leaves one change to send — the pill says so
    and a tap converges both sides. */
export function roomTheirs() {
  resolveWarning('pendingRoom', w => { load(w.doc); baseOn(w); renderRoom(); });
}

/**
 * Keep mine: *not* "push my rev 8 over their rev 8" — the other side would see
 * a fork of their own, permanently. My content is renumbered as the next
 * revision above theirs and then sent, so the chain stays single.
 */
export function roomMine() {
  resolveWarning('pendingRoom', w => {
    if (!state.HD) return;
    baseOn(w);
    state.HD.rev = aboveRev(state.HD.rev, w.rev);
    persist();
    pushRoom({ quiet: true });
  });
}

/**
 * Keep both: the shared trip becomes theirs, and *my* divergent version forks
 * off as a trip of its own — which, because the room record is keyed by
 * `trip_id` and `forkOf` mints a new one, is also how it leaves the share.
 * There is nothing extra to unset.
 *
 * It is my copy that forks rather than theirs, and that is the whole point: a
 * fork of theirs would leave the shared trip still diverged, and every pull
 * from then on would park the same conflict again.
 */
export function roomBoth() {
  resolveWarning('pendingRoom', w => {
    const mine = state.HD;
    load(w.doc);     // the shared trip_id, now holding their version
    baseOn(w);
    load(asFork(mine)); // my version, as a trip that is nobody else's business
    renderRoom();
  });
}

/** Later: park it again rather than dropping it, so the pill keeps offering
    the decision at a moment the user picks. */
export function roomLater() {
  const waiting = state.pendingRoom;
  state.pendingRoom = null;
  hideWarning();
  state.roomWaiting = waiting;
  renderRoom();
}

/* --- joining ------------------------------------------------------------- */

/**
 * The document a `w1`/`v1` link names, and the record that puts this device in
 * the room. Called by share.js's boot path, which then routes the document
 * through `loadUpload()` exactly as it does an uploaded file — a link is
 * untrusted input whatever it points at.
 *
 * The record is written against the *incoming* document's trip_id rather than
 * after the import decision resolves, which is what makes "Keep both" leave
 * the room for free: the fork gets a new trip_id, and a room record follows a
 * trip_id, not a document.
 */
export async function roomDocument(fragment) {
  const parsed = parseRoom(fragment);
  const creds = parsed.writer
    ? await deriveRoom(parsed.masterKey)
    : { id: parsed.id, encKey: parsed.key };
  const bytes = await getShare(creds.id); // the boot read wants the retry ladder
  const etag = await digest(bytes);
  const doc = parseShareDocument(await decryptShare(bytes, creds.encKey));
  const settled = importKind(doc).doc;
  const existing = readRoom(store, settled.trip_id) || {};
  const record = {
    ...existing,
    id: creds.id,
    enc: creds.encKey,
    created_at: existing.created_at || nowIso(),
    rev_pushed: settled.rev || 1,
    etag,
  };
  // A writer link makes this device a writer; a viewer link never *removes*
  // write access someone already holds for the same trip.
  if (parsed.writer) record.k = parsed.masterKey;
  writeRoom(store, settled.trip_id, record);
  if (parsed.writer) askName();
  return doc;
}

/**
 * Joining as a writer is the moment to ask who you are: `updated_by` already
 * flows through every revision, and without a name "someone changed this" is
 * unattributable. Deferred a beat so the trip is on screen first — the
 * question makes no sense before you can see what you have been handed.
 */
function askName() {
  if (updatedBy()) return;
  setTimeout(() => {
    if (updatedBy()) return;
    const name = window.prompt(
      'You can edit this shared trip. What should your changes be labelled as?', '');
    if (name && name.trim()) setUpdatedBy(name.trim());
  }, 400);
}

/* --- the share sheet ----------------------------------------------------- */

/** The pill is the retry after a failed push and the way into a parked
    decision; with nothing waiting it is just the way into the share sheet. */
export function roomPill() {
  if (state.roomWaiting) { reviewWaiting(); return; }
  shareOpen();
}

export function shareOpen() {
  if (!state.HD) return;
  renderShareSheet();
  document.getElementById('hshare-modal').classList.add('on');
  pullRoom(); // opening the sheet is a good moment to find out if they moved
}

export function shareClose() {
  document.getElementById('hshare-modal').classList.remove('on');
}

/** Send the trip as it stands. The onclick passes a MouseEvent, which must not
    become the options object — hence the separate handler. The sheet stays
    open: the status line in it is the answer to what was just tapped. */
export function roomPush() { return pushRoom(); }

/** The snapshot option, still the default. Closes the sheet, because the link
    is on its way and there is nothing left to decide in here. */
export function sendCopy() {
  shareClose();
  return state.HD ? shareDoc(state.HD) : Promise.resolve();
}


/** Start sharing live, then hand over whichever half of the room the checkbox
    asked for. */
export async function roomStart() {
  const wantsEdit = letThemEdit();
  const room = await startRoom();
  if (!room) { shareToast('Could not start live sharing — sending a copy instead.'); shareDoc(state.HD); return; }
  renderRoom();
  await handOver(room, wantsEdit);
}

/** Copy the link for an existing room, viewer or writer as the box says. */
export async function roomCopy() {
  const room = currentRoom();
  if (room) await handOver(room, letThemEdit());
}

async function handOver(room, wantsEdit) {
  shareClose();
  const url = wantsEdit ? writerUrl(location.href, room.k) : viewerUrl(location.href, room.id, room.enc);
  const name = (state.HD && state.HD.trip && state.HD.trip.name) || 'Itinerary';
  const note = wantsEdit
    ? `Edit link copied. Whoever opens it can change this trip — and so can anyone they forward it to. It works for ${SHARE_TTL_DAYS} days after your last update.`
    : `Live link copied. It shows this trip as you last updated it, and keeps up with later updates for ${SHARE_TTL_DAYS} days after each one.`;
  if (navigator.share) {
    try { await navigator.share({ title: name, text: `${name} — itinerary`, url }); shareToast(note); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  await copyLink(url, false, note);
}

/** Stop sharing: delete the blob **and forget the key**. Forgetting is not
    optional — the id is derived, so a device that kept the key would resurrect
    the room at the same id on its very next push. */
export async function roomStop() {
  const id = tripId();
  const room = readRoom(store, id);
  if (!room) return;
  if (!confirm(canWrite(room)
    ? 'Stop sharing this trip? Every link already sent stops working, and your copy here is unaffected.'
    : 'Stop following the shared copy? Your copy of the trip stays here.')) return;
  if (canWrite(room)) {
    try {
      const { token } = await deriveRoom(room.k);
      await deleteRoom(room.id, token);
    } catch (e) { /* the record goes either way — see below */ }
  }
  // Forgotten locally whatever the network said. A key kept for a blob we
  // believe is gone is the one state that cannot be recovered from: the next
  // push would quietly re-create the room somebody just asked to end.
  forgetRoom(store, id);
  state.roomWaiting = null;
  renderRoom();
  shareToast(canWrite(room) ? 'Sharing stopped.' : 'No longer following that shared copy.');
}

/**
 * Reset sharing — the only revocation there is. There is no per-person
 * identity to revoke, so taking access back means retiring the room and
 * minting another: the old link dies for everyone at once, and you re-send to
 * the people you still want. Blunt, but honest, and cheap because the trip
 * itself never left this browser.
 */
export async function roomReset() {
  if (!confirm('Reset sharing? Every link already sent stops working, and you get a new one to send.')) return;
  const id = tripId();
  const room = readRoom(store, id);
  if (room && canWrite(room)) {
    try {
      const { token } = await deriveRoom(room.k);
      await deleteRoom(room.id, token);
    } catch (e) { /* a blob we cannot delete still becomes unreachable: the new
                     room has a different id, and the old one expires */ }
  }
  forgetRoom(store, id);
  state.roomWaiting = null;
  const fresh = await startRoom();
  renderRoom();
  if (!fresh) { shareToast('Sharing stopped, but a new link could not be created — try again.'); return; }
  await handOver(fresh, letThemEdit());
}

/* --- wiring -------------------------------------------------------------- */

/**
 * Pull on focus and on a slow timer. Both are gated on the tab being visible
 * and on a room existing, so a page sitting open on a trip nobody shared costs
 * the store nothing at all.
 */
export function watchRoom() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullRoom();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') pullRoom();
  }, POLL_MS);
}
