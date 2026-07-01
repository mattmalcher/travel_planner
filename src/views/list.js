// Timeline (list) view: day-grouped cards with per-type detail rows.
import { state } from '../state.js';
import { costInfo } from '../lib/cost.js';
import { sortSegments, segDate } from '../lib/sort.js';
import { fmtDayLong, fmtMinutes } from '../lib/dates.js';
import { esc, safeUrl } from '../lib/escape.js';
import { costBadge, proposalBadge, segIcon } from './badges.js';

function renderTransport(s) {
  const seatsLine = s.seats && s.seats.length ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${s.seats.map(x => `${esc(x.traveller.split(' ')[0])}: Coach ${esc(x.coach)}${x.deck ? ' (' + esc(x.deck) + ')' : ''}, Seat ${esc(x.seat)}`).join(' · ')}</div>` : '';
  return `<div style="margin-top:8px;font-size:13px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-weight:500">${esc(s.departs.time)}</span>
      <span style="color:var(--color-text-secondary)">${esc(s.departs.station)}</span>
      <i class="ti ti-arrow-right" style="color:var(--color-text-secondary);font-size:12px" aria-hidden="true"></i>
      <span style="color:var(--color-text-secondary)">${esc(s.arrives.station)}</span>
      <span style="font-weight:500">${esc(s.arrives.time)}</span>
      <span style="color:var(--color-text-secondary);font-size:12px">${fmtMinutes(s.duration_min)}</span>
    </div>
    <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">${esc(s.operator)}${s.service ? ' · ' + esc(s.service) : ''} · ${esc(s.class)} · Ref: <code>${esc(s.ref)}</code></div>
    ${seatsLine}
  </div>`;
}

function renderAccom(s) {
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    <span><i class="ti ti-door-enter" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> In after ${esc(s.checkin.from)} · ${fmtDayLong(s.checkin.date)}</span>
    <span><i class="ti ti-door-exit" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Out by ${esc(s.checkout.by)} · ${fmtDayLong(s.checkout.date)}</span>
    <span>${s.nights} night${s.nights !== 1 ? 's' : ''} · Host: ${esc(s.host)}</span>
    ${s.self_checkin ? '<span><i class="ti ti-key" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> Self check-in</span>' : ''}
    ${s.phone ? `<span><i class="ti ti-phone" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(s.phone)}</span>` : ''}
    <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;width:100%">Ref: <code>${esc(s.ref)}</code></div>
  </div>`;
}

function renderEvent(s) {
  let pr = '';
  if (s.pricing) {
    pr = Object.entries(s.pricing).map(([k, v]) => {
      const l = esc(k.replace(/_/g, ' '));
      const val = v.amount !== undefined ? `€${esc(v.amount)}` : (v.from !== undefined ? `€${esc(v.from)}–€${esc(v.to)}` : '');
      return `${l}: ${val}`;
    }).join(' · ');
  }
  const url = safeUrl(s.url), ticketsUrl = safeUrl(s.tickets_url);
  return `<div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-wrap:wrap;gap:8px">
    ${s.venue ? `<span><i class="ti ti-map-pin" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(s.venue)}</span>` : ''}
    ${s.time ? `<span><i class="ti ti-clock" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(s.time)}</span>` : ''}
    ${pr ? `<span>${pr}</span>` : ''}
    ${url ? `<span><a href="${esc(url)}" style="color:var(--color-text-info)">Website <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>` : ''}
    ${ticketsUrl ? `<span><a href="${esc(ticketsUrl)}" style="color:var(--color-text-info)">Tickets <i class="ti ti-external-link" style="font-size:11px" aria-hidden="true"></i></a></span>` : ''}
  </div>`;
}

// Notes support "***highlighted warning***" spans between plain parts.
function renderNotes(s) {
  if (!s.notes) return '';
  const parts = s.notes.split('***').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return `<div style="margin-top:6px;font-size:11px;color:var(--color-text-tertiary)">${esc(s.notes)}</div>`;
  return parts.map((p, i) => i % 2 === 1
    ? `<div style="margin-top:6px;background:var(--color-background-warning);color:var(--color-text-warning);border-radius:var(--border-radius-md);padding:5px 8px;font-size:12px"><i class="ti ti-alert-triangle" style="font-size:12px;vertical-align:-1px" aria-hidden="true"></i> ${esc(p)}</div>`
    : `<div style="margin-top:6px;font-size:11px;color:var(--color-text-tertiary)">${esc(p)}</div>`
  ).join('');
}

export function renderList() {
  const HD = state.HD;
  const sorted = sortSegments(HD.segments);
  const grp = {};
  sorted.forEach(s => { const d = segDate(s); (grp[d] = grp[d] || []).push(s); });
  document.getElementById('hvlist').innerHTML = Object.entries(grp).map(([date, segs]) => `
    <div style="margin-bottom:1.75rem">
      <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.625rem;display:flex;align-items:center;gap:8px">
        ${fmtDayLong(date)}<span style="flex:1;height:.5px;background:var(--color-border-tertiary);display:block"></span>
      </div>
      ${segs.map(s => {
        const ci = costInfo(s, HD.trip.currency_primary), ic = segIcon(s);
        const title = esc(s.name || s.operator || 'Segment');
        const sub = s.type === 'transport' ? `${esc(s.departs.station)} → ${esc(s.arrives.station)}` : s.type === 'accommodation' ? esc(s.address) : (s.subtype ? esc(s.subtype.charAt(0).toUpperCase() + s.subtype.slice(1)) : '');
        const costStr = ci && ci.t === 'amt' ? `${ci.sym}${ci.tot.toFixed(2)}` : '';
        const detail = s.type === 'transport' ? renderTransport(s) : s.type === 'accommodation' ? renderAccom(s) : renderEvent(s);
        return `<div class="hseg">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0">
              <i class="ti ${ic}" style="font-size:17px;color:var(--color-text-secondary);flex-shrink:0;margin-top:2px" aria-hidden="true"></i>
              <div><div style="font-size:14px;font-weight:500">${title}</div><div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">${sub}</div></div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
              <button class="hedit-btn" onclick="hOpenEdit(${HD.segments.indexOf(s)})" style="font-size:11px;padding:1px 5px;line-height:1.5;color:var(--color-text-secondary)" title="Edit segment"><i class="ti ti-pencil" aria-hidden="true"></i></button>
              ${costStr ? `<span style="font-size:13px;font-weight:500">${costStr}</span>` : ''}
              ${costBadge(ci)}${proposalBadge(s)}
            </div>
          </div>
          ${detail}${renderNotes(s)}
        </div>`;
      }).join('')}
    </div>`).join('');
}
