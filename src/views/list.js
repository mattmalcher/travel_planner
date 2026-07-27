// Itinerary (list) view: day-grouped cards with per-type detail rows. The tab
// is labelled "Itinerary" (issue #71); the internal name stays `list`.
import { state } from '../state.js';
import { costInfo, fmtCurrency } from '../lib/cost.js';
import { sortSegments, segDate } from '../lib/sort.js';
import { fmtDayLong, fmtDayShort, fmtMinutes, nightsBetween, DEFAULT_CHECKIN_FROM, DEFAULT_CHECKOUT_BY } from '../lib/dates.js';
import { currentDayChip } from '../lib/now.js';
import { SEGMENT_KINDS } from '../lib/drafts.js';
import { esc, safeUrl } from '../lib/escape.js';
import { costBadge, proposalBadge, segIcon } from './badges.js';
import { jumpTo, bindJumpSpy, updateActiveChip } from './jump-nav.js';

function renderTransport(s, trip) {
  const seatsLine = s.seats && s.seats.length ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${s.seats.map(x => `${esc(x.traveller.split(' ')[0])}: Coach ${esc(x.coach)}${x.deck ? ' (' + esc(x.deck) + ')' : ''}, Seat ${esc(x.seat)}`).join(' · ')}</div>` : '';
  // ref is optional since schema 3.0.0 (issue #11): absent means "no booking
  // reference", so the line simply omits it.
  const pass = s.pass_id ? ((trip && trip.passes) || []).find(p => p.id === s.pass_id) : null;
  const meta = [
    esc(s.operator) + (s.service ? ' · ' + esc(s.service) : ''),
    s.ref ? `Ref: <code>${esc(s.ref)}</code>` : '',
    s.pass_id ? `Pass: ${pass ? esc(pass.name) + ' ' : ''}<code>${esc(s.pass_id)}</code>` : '',
  ].filter(Boolean).join(' · ');
  return `<div style="margin-top:8px;font-size:13px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-weight:500">${esc(s.departs.time)}</span>
      <span style="color:var(--color-text-secondary)">${esc(s.departs.place)}</span>
      <!-- The arrow is the only thing relating the two places, and it is
           aria-hidden (correctly — it is decoration to a reader). Without the
           sr-only word the row is announced as four unrelated values in a row
           (issue #92). -->
      <i class="ti ti-arrow-right" style="color:var(--color-text-secondary);font-size:12px" aria-hidden="true"></i><span class="sr-only">to</span>
      <span style="color:var(--color-text-secondary)">${esc(s.arrives.place)}</span>
      <span style="font-weight:500">${esc(s.arrives.time)}</span>
      <span style="color:var(--color-text-secondary);font-size:12px">${fmtMinutes(s.duration_min)}</span>
    </div>
    <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">${meta}</div>
    ${seatsLine}
  </div>`;
}

function renderAccom(s) {
  // nights was dropped from the schema (3.0.0): derive it from the dates.
  // host and ref are optional since 3.2.0 (a stay you have only just decided
  // on has neither), so their lines are omitted rather than shown empty.
  const nights = nightsBetween(s.checkin.date, s.checkout.date);
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    <span><i class="ti ti-door-enter" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> In after ${esc(s.checkin.from || DEFAULT_CHECKIN_FROM)} · ${fmtDayLong(s.checkin.date)}</span>
    <span><i class="ti ti-door-exit" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Out by ${esc(s.checkout.by || DEFAULT_CHECKOUT_BY)} · ${fmtDayLong(s.checkout.date)}</span>
    <span>${nights} night${nights !== 1 ? 's' : ''}${s.host ? ` · Host: ${esc(s.host)}` : ''}</span>
    ${s.self_checkin ? '<span><i class="ti ti-key" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Self check-in</span>' : ''}
    ${s.phone ? `<span><i class="ti ti-phone" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> <span class="sr-only">Phone:</span> ${esc(s.phone)}</span>` : ''}
    ${s.ref ? `<div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;width:100%">Ref: <code>${esc(s.ref)}</code></div>` : ''}
  </div>`;
}

function renderEvent(s, primaryCurrency) {
  let pr = '';
  if (s.pricing) {
    pr = Object.entries(s.pricing).map(([k, v]) => {
      const l = esc(k.replace(/_/g, ' '));
      // Each pricing tier can carry its own currency (issue #16).
      const cur = v.currency || primaryCurrency;
      const val = v.amount !== undefined ? esc(fmtCurrency(v.amount, cur)) : (v.from !== undefined ? `${esc(fmtCurrency(v.from, cur))}–${esc(fmtCurrency(v.to, cur))}` : '');
      return `${l}: ${val}`;
    }).join(' · ');
  }
  const url = safeUrl(s.url), ticketsUrl = safeUrl(s.tickets_url);
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    ${s.venue ? `<span><i class="ti ti-map-pin" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(s.venue)}</span>` : ''}
    ${s.all_day ? `<span><i class="ti ti-clock" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> All day</span>` : ''}
    ${s.time ? `<span><i class="ti ti-clock" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(s.time)}${s.end_time ? '–' + esc(s.end_time) : ''}</span>` : ''}
    ${s.end_date ? `<span><i class="ti ti-calendar-due" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Until ${fmtDayLong(s.end_date)}</span>` : ''}
    ${pr ? `<span>${pr}</span>` : ''}
    ${url ? `<span><a href="${esc(url)}" style="color:var(--color-text-info)">Website <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>` : ''}
    ${ticketsUrl ? `<span><a href="${esc(ticketsUrl)}" style="color:var(--color-text-info)">Tickets <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>` : ''}
  </div>`;
}

// Alert banners come from the structured warnings[] field; notes are plain
// prose. The old "***warning***" notes convention is retired (issue #14).
//
// The banner reads as bare prose without the sr-only prefix — the triangle and
// the amber fill are the only thing marking it as a warning, and neither
// reaches a screen reader (issue #92). role="alert" would be wrong: these are
// static content rendered with the card, not live announcements.
function renderWarnings(s) {
  if (!s.warnings || !s.warnings.length) return '';
  return s.warnings.map(w =>
    `<div class="hwarn" role="note" style="margin-top:6px;background:var(--color-background-warning);color:var(--color-text-warning);border-radius:var(--border-radius-md);padding:5px 8px;font-size:12px"><i class="ti ti-alert-triangle" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> <span class="sr-only">Warning:</span> ${esc(w)}</div>`
  ).join('');
}

function renderNotes(s) {
  if (!s.notes) return '';
  return `<div style="margin-top:6px;font-size:11px;color:var(--color-text-tertiary)">${esc(s.notes)}</div>`;
}

/** Scroll the itinerary to a day's section (date strip chips, issue #21) —
    the shared jump strip from views/jump-nav.js keyed by date. */
export function jumpToDay(date, behavior = 'smooth') {
  jumpTo('hvlist', date, behavior);
}

/* One button per addable segment type (issue #76). Like the Lists view's
   quick-add these are always on rather than gated on edit mode: an itinerary
   with nothing in it would otherwise hide the only way to start it. */
const addBar = `<div class="hadd">
  <span class="hadd-lbl">Add to the itinerary</span>
  ${SEGMENT_KINDS.map(k => `<button class="hli-chip" onclick="hAddSegment('${k.type}')"><i class="ti ${segIcon({ type: k.type })}" aria-hidden="true"></i> ${k.label}</button>`).join('')}
</div>`;

const emptyState = `<div style="font-size:13px;color:var(--color-text-secondary);padding:1rem 0">
  Nothing planned yet. Add travel, a stay or something to do below — or ask the AI assistant,
  or load a <code>HolidayItinerary</code> file. Ideas that aren't plans yet belong on the Lists tab.
</div>`;

export function renderList() {
  const HD = state.HD;
  const sorted = sortSegments(HD.segments);
  const grp = {};
  sorted.forEach(s => { const d = segDate(s); (grp[d] = grp[d] || []).push(s); });
  const days = Object.keys(grp);
  // During the trip the strip gets a Today shortcut and today's chip a marker,
  // and the first render lands on the current day (issue #35).
  const today = currentDayChip(days, HD.trip, Date.now());
  const todayBtn = today ? `<button class="hjump-chip hday-today" data-k="${esc(today)}" onclick="hJumpDay(this.dataset.k)"><i class="ti ti-calendar-pin" aria-hidden="true"></i> Today</button>` : '';
  const nav = days.length > 1 ? `<nav class="hjump-nav" aria-label="Jump to day">${todayBtn}${days.map(d =>
    `<button class="hjump-chip${d === today ? ' is-today' : ''}" data-k="${esc(d)}" onclick="hJumpDay(this.dataset.k)">${fmtDayShort(d)}</button>`).join('')}</nav>` : '';
  // Each day is a section headed by an <h2>, holding a <ul> of segment cards
  // whose titles are <h3>s (issue #92): the outline is what a screen reader
  // skims by, and "list, 8 items… item 3 of 8" is most of what makes a long
  // day navigable without seeing it. The heading carries the text only — the
  // rule that fills the rest of the row stays a sibling span.
  document.getElementById('hvlist').innerHTML = nav + (days.length ? '' : emptyState) + Object.entries(grp).map(([date, segs]) => `
    <section class="hjump-a" data-k="${esc(date)}" style="margin-bottom:1.75rem">
      <div style="margin-bottom:.625rem;display:flex;align-items:center;gap:8px">
        <h2 style="margin:0;font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em">${fmtDayLong(date)}</h2>
        <span style="flex:1;height:.5px;background:var(--color-border-tertiary);display:block"></span>
      </div>
      <ul class="hplain-list">${segs.map(s => {
        const ci = costInfo(s, HD.trip.currency_primary), ic = segIcon(s);
        const title = esc(s.name || s.operator || 'Segment');
        const sub = s.type === 'transport' ? `${esc(s.departs.place)} → ${esc(s.arrives.place)}` : s.type === 'accommodation' ? esc(s.address) : (s.subtype ? esc(s.subtype.charAt(0).toUpperCase() + s.subtype.slice(1)) : '');
        const costStr = ci && ci.t === 'amt' ? esc(fmtCurrency(ci.tot, ci.cur)) : '';
        const detail = s.type === 'transport' ? renderTransport(s, HD.trip) : s.type === 'accommodation' ? renderAccom(s) : renderEvent(s, HD.trip.currency_primary);
        // There is one pencil per card, so a bare "Edit segment" would give a
        // day full of identically named buttons — the name says which one
        // (issue #92). `title` is already esc()d above.
        return `<li class="hseg" data-seg="${HD.segments.indexOf(s)}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0">
              <i class="ti ${ic}" style="font-size:17px;color:var(--color-text-secondary);flex-shrink:0;margin-top:2px" aria-hidden="true"></i>
              <div><h3 style="margin:0;font-size:14px;font-weight:500">${title}</h3><div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">${sub}</div></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
              <button class="hpencil hedit-btn" onclick="hOpenEdit(${HD.segments.indexOf(s)})" title="Edit segment" aria-label="Edit ${title}"><i class="ti ti-pencil" aria-hidden="true"></i></button>
              ${costStr ? `<span style="font-size:13px;font-weight:500">${costStr}</span>` : ''}
              ${costBadge(ci)}${proposalBadge(s)}
            </div>
          </div>
          ${detail}${renderWarnings(s)}${renderNotes(s)}
        </li>`;
      }).join('')}</ul>
    </section>`).join('') + addBar;
  bindJumpSpy('hvlist');
  updateActiveChip('hvlist');
  // Open at the current day once per page load; later re-renders (edits, AI
  // changes) must not yank the scroll position away from the user.
  if (today && !renderList._jumped) {
    renderList._jumped = true;
    jumpToDay(today, 'auto');
  }
}
