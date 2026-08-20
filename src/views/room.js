/**
 * Live sharing's two surfaces (issue #124): the status pill in the header, and
 * the body of the share sheet.
 *
 * DOM only, as everything in views/ is — the arithmetic behind "3 changes not
 * shared" is `unpushedCount` in lib/room.js, and every button here calls a
 * `window.hRoom*`/`window.hShare*` handler that src/room.js exports. It is its
 * own module rather than part of room.js so that app.js can repaint the pill
 * after a load without importing the push/pull machinery, which imports app.js
 * straight back.
 */
import { state } from '../state.js';
import { esc } from '../lib/escape.js';
import { readRoom, canWrite, unpushedCount } from '../lib/room.js';
import { hasShareStore, SHARE_TTL_DAYS } from '../share-store.js';

const store = localStorage;

/** The room the open trip is in, or null. Read from the store each time rather
    than cached in `state`: it is a handful of bytes, and a stale copy of a
    record that carries a *key* is the kind of bug that outlives a session. */
export function currentRoom() {
  return readRoom(store, state.HD ? state.HD.trip_id : null);
}

/** Whether live sharing can work in this build at all. With no store the sheet
    offers "Send a copy" alone, rather than a live option that would fail. */
export function canShareLive() { return hasShareStore(); }

/**
 * What the pill says, as data — so the sheet, the pill and the e2e spec agree
 * on the wording instead of each re-deriving it.
 *
 * The unpushed count is the one thing the design owes the user: pushes are
 * manual, so staleness is invisible unless it is said out loud, and it goes in
 * the attention colour for the same reason.
 */
export function roomStatus() {
  const room = currentRoom();
  if (!room) return null;
  if (state.roomWaiting)
    return { tone: 'wait', icon: 'arrows-exchange', text: 'Their changes are waiting' };
  if (!canWrite(room))
    return { tone: 'ok', icon: 'eye', text: 'Shared with you' };
  const n = unpushedCount(state.HD, room);
  if (n > 0)
    return { tone: 'wait', icon: 'cloud-up', text: `${n} change${n === 1 ? '' : 's'} not shared` };
  return { tone: 'ok', icon: 'cloud-check', text: 'Shared copy up to date' };
}

/** Paint the pill, and the sheet too if it happens to be open. Called after
    anything that could move either — a push, a pull, a decision, a load. */
export function renderRoom() {
  const pill = document.getElementById('hroom-pill');
  if (!pill) return;
  const status = roomStatus();
  if (!status) {
    pill.style.display = 'none';
  } else {
    pill.style.display = 'inline-flex';
    pill.className = `hpill${status.tone === 'wait' ? ' hpill-wait' : ''}`;
    pill.innerHTML = `<i class="ti ti-${status.icon}" aria-hidden="true"></i> ${esc(status.text)}`;
  }
  const sheet = document.getElementById('hshare-modal');
  if (sheet && sheet.classList.contains('on')) renderShareSheet();
}

/**
 * The share sheet's body. Two options plus a modifier, never three peer
 * buttons: a frozen copy, or a live room, with **Let them edit** as a checkbox
 * on the *act* of sharing. Deliberately not a toggle — a toggle reads as
 * reversible state, and a writer link cannot be un-issued; the checkbox picks
 * which half of the room is about to be copied, which is a thing you do once.
 */
export function renderShareSheet() {
  const box = document.getElementById('hshare-body');
  if (!box) return;
  // The sheet repaints whenever the room moves — a push, a pull, the poll —
  // and the rebuild would silently untick the box: tick it, tap Update, tap
  // Copy, and the link handed over is the wrong grade. The tick belongs to
  // the user, not the render, so it survives the rebuild.
  const wantedEdit = letThemEdit();
  const room = currentRoom();
  const status = roomStatus();
  const rows = [];

  if (status) {
    rows.push(`<div class="hshare-status${status.tone === 'wait' ? ' hpill-wait' : ''}">`
      + `<i class="ti ti-${status.icon}" aria-hidden="true"></i> ${esc(status.text)}</div>`);
  }

  if (canWrite(room)) {
    rows.push(`<div class="hshare-act">
      <button onclick="hRoomPush()" class="htool" style="font-weight:500"><i class="ti ti-cloud-up" aria-hidden="true"></i> Update shared copy</button>
      <button onclick="hRoomCopy()" class="htool"><i class="ti ti-link" aria-hidden="true"></i> Copy the live link</button>
    </div>`);
    rows.push(editCheckbox());
    // The expiry has to be said where the link is handed over, and said the way
    // round that is true: it costs a link's uptime, never a trip.
    rows.push(`<p class="hshare-note">The shared copy expires ${SHARE_TTL_DAYS} days after the last update. That pauses the link, never the trip — your copy here stays the real one, and one more update brings the same link back to life.</p>`);
    rows.push(`<div class="hshare-act">
      <button onclick="hRoomStop()" class="htool" style="color:var(--color-text-danger)"><i class="ti ti-player-stop" aria-hidden="true"></i> Stop sharing</button>
      <button onclick="hRoomReset()" class="htool"><i class="ti ti-rotate" aria-hidden="true"></i> Reset sharing</button>
    </div>`);
    rows.push('<p class="hshare-note">Resetting is how you take access back: it deletes the shared copy and makes a new link, so every link already sent stops working at once.</p>');
  } else if (room) {
    rows.push('<p class="hshare-note">This trip reached you as a live link, so it updates when they send changes. Your own edits stay here and are not sent back.</p>');
    rows.push(`<div class="hshare-act">
      <button onclick="hRoomStop()" class="htool"><i class="ti ti-link-off" aria-hidden="true"></i> Stop following</button>
    </div>`);
  } else if (canShareLive()) {
    rows.push(`<div class="hshare-act">
      <button onclick="hRoomStart()" class="htool" style="font-weight:500"><i class="ti ti-broadcast" aria-hidden="true"></i> Share live</button>
    </div>`);
    rows.push(editCheckbox());
    rows.push('<p class="hshare-note">A live link stays current: change the trip, tap Update, and everyone’s link shows the new version. It is not automatic — you choose when an update goes out.</p>');
  }

  rows.push(`<div class="hshare-act">
    <button onclick="hShareCopy()" class="htool"><i class="ti ti-share" aria-hidden="true"></i> Send a copy</button>
  </div>`);
  rows.push('<p class="hshare-note">A copy is a snapshot of the trip as it is right now, and never changes again — whatever you do here afterwards.</p>');
  rows.push('<p class="hshare-note">Any of these links is the whole itinerary, booking references included. Whoever holds one can read it; whoever holds an <b>edit</b> link — and anyone they forward it to — can change it. The link is the permission.</p>');
  box.innerHTML = rows.join('');
  const check = document.getElementById('hshare-edit');
  if (check) check.checked = wantedEdit;
}

const editCheckbox = () => '<label class="hshare-check">'
  + '<input type="checkbox" id="hshare-edit"> Let them edit</label>';

/** Whether the sharer ticked "Let them edit" for the link about to go out.
    Read at the moment of the tap, because that is exactly what it modifies. */
export function letThemEdit() {
  const box = document.getElementById('hshare-edit');
  return !!(box && box.checked);
}
