// Gantt view: three lanes (accommodation / travel / events) on a shared
// vertical time axis, in proportional or compact mode. Geometry comes from
// lib/gantt-layout.js; this file builds blocks and renders them.
import { state } from '../state.js';
import { esc } from '../lib/escape.js';
import { toMs, msToIso, fmtMinutes, DEFAULT_CHECKIN_FROM, DEFAULT_CHECKOUT_BY, DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN } from '../lib/dates.js';
import { PX_PER_MIN, MIN_BLOCK_PX, linearScale, compactPoints, compactScale, coverageGaps } from '../lib/gantt-layout.js';

const TRANSPORT_COLOR = { train: '#f59e0b', bus: '#10b981', ferry: '#06b6d4', flight: '#8b5cf6' };
const EVENT_COLOR = { festival: '#ec4899', gig: '#f97316', walk: '#22c55e', tour: '#6366f1', activity: '#14b8a6', other: '#64748b' };
const ACCOM_COLOR = '#3b82f6';

export function toggleGanttMode() {
  state.ganttCompact = !state.ganttCompact;
  renderGantt();
}

export function renderGantt() {
  const HD = state.HD;
  if (!HD) return;
  state.ganttBlocks = [];
  const tripStartMs = toMs(HD.trip.start, '00:00');
  const tripEndMs = new Date(HD.trip.end + 'T23:59:59').getTime();
  const tripStartDate = new Date(HD.trip.start + 'T00:00:00');
  const numDays = Math.round((toMs(HD.trip.end, '00:00') - tripStartDate.getTime()) / 86400000) + 1;
  const scale = state.ganttCompact
    ? compactScale(compactPoints(HD.trip, HD.segments))
    : linearScale(tripStartMs, tripEndMs);
  const totalPx = scale.totalPx;
  const toPx = (dateStr, timeStr) => scale.toPx(toMs(dateStr, timeStr));

  const accomBlocks = [], travelBlocks = [], eventBlocks = [];
  for (const s of HD.segments) {
    if (s.type === 'accommodation') {
      const top = toPx(s.checkin.date, s.checkin.from || DEFAULT_CHECKIN_FROM);
      const bot = toPx(s.checkout.date, s.checkout.by || DEFAULT_CHECKOUT_BY);
      accomBlocks.push({ top, h: Math.max(bot - top, MIN_BLOCK_PX), color: ACCOM_COLOR, label: s.name, sub: `${s.checkin.from || '?'} → ${s.checkout.by || '?'}` });
    } else if (s.type === 'transport') {
      const depMs = toMs(s.date, s.departs.time);
      const arr = msToIso(depMs + s.duration_min * 60000);
      const top = toPx(s.date, s.departs.time);
      const bot = toPx(arr.date, arr.time);
      travelBlocks.push({ top, h: Math.max(bot - top, MIN_BLOCK_PX), color: TRANSPORT_COLOR[s.mode] || '#64748b',
        label: s.operator + (s.service ? ' · ' + s.service : ''),
        times: `${s.departs.time} → ${arr.time} (${fmtMinutes(s.duration_min)})`,
        sub: `${s.departs.station} → ${s.arrives.station}` });
    } else if (s.type === 'event') {
      const evMs = toMs(s.date, s.time || DEFAULT_EVENT_TIME);
      const end = msToIso(evMs + (s.duration_min || DEFAULT_EVENT_DURATION_MIN) * 60000);
      const top = toPx(s.date, s.time || DEFAULT_EVENT_TIME);
      const bot = toPx(end.date, end.time);
      eventBlocks.push({ top, h: Math.max(bot - top, MIN_BLOCK_PX), color: EVENT_COLOR[s.subtype] || EVENT_COLOR.other, label: s.name, times: `${s.time || DEFAULT_EVENT_TIME} → ${end.time} (${fmtMinutes(s.duration_min || DEFAULT_EVENT_DURATION_MIN)})`, sub: s.subtype || 'event' });
    }
  }

  const coveredIntervals = HD.segments.filter(s => s.type === 'accommodation').map(s => ({
    startMs: toMs(s.checkin.date, s.checkin.from || DEFAULT_CHECKIN_FROM),
    endMs: toMs(s.checkout.date, s.checkout.by || DEFAULT_CHECKOUT_BY),
  }));
  const gapBlocks = coverageGaps(coveredIntervals, tripStartMs, tripEndMs).map(g => {
    const a = msToIso(g.startMs), b = msToIso(g.endMs);
    return { top: toPx(a.date, a.time), bot: toPx(b.date, b.time) };
  });

  let axisHtml = '', bodyLines = '';
  for (let d = 0; d < numDays; d++) {
    const dayDate = new Date(tripStartDate.getTime() + d * 86400000);
    const dayIso = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
    const dayPx = toPx(dayIso, '00:00');
    const dayLabel = dayDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    bodyLines += `<div class="hgt-day" style="top:${dayPx.toFixed(1)}px"></div>`;
    axisHtml += `<div class="hgt-day-lbl" style="top:${(dayPx + 2).toFixed(1)}px">${dayLabel}</div>`;
    if (!state.ganttCompact) {
      for (const hr of [6, 12, 18]) {
        const tickPx = d * 1440 * PX_PER_MIN + hr * 60 * PX_PER_MIN;
        bodyLines += `<div class="hgt-tick" style="top:${tickPx}px"></div>`;
        axisHtml += `<div class="hgt-tick-lbl" style="top:${tickPx + 2}px">${String(hr).padStart(2, '0')}:00</div>`;
      }
    }
  }

  // Blocks render at their true height. Inline text is shown progressively as
  // the block grows tall enough to fit each line (glanceability); the full
  // detail always lives in the hover popover, keyed by the block's index into
  // state.ganttBlocks (see setupPopover), which also covers blocks too short
  // for any text at all.
  function blkHtml(blocks) {
    return blocks.map(b => {
      const bi = state.ganttBlocks.push(b) - 1;
      let inner = '';
      if (b.h >= 18) inner += `<div class="hgt-blk-t">${esc(b.label)}</div>`;
      if (b.times && b.h >= 32) inner += `<div class="hgt-blk-t sm">${esc(b.times)}</div>`;
      if (b.sub && b.h >= 46) inner += `<div class="hgt-blk-t sm dim">${esc(b.sub)}</div>`;
      return `<div class="hgt-blk" data-bi="${bi}" style="top:${b.top.toFixed(1)}px;height:${b.h.toFixed(1)}px;background:${b.color}">${inner}</div>`;
    }).join('');
  }
  const gapHtml = gapBlocks.map(g => `<div class="hgt-gap" style="top:${g.top.toFixed(1)}px;height:${Math.max(g.bot - g.top, 4).toFixed(1)}px" title="No accommodation booked"></div>`).join('');
  const toggleBtn = `<button onclick="hGanttToggle()" style="font-size:10px;padding:2px 6px;line-height:1.4" title="${state.ganttCompact ? 'Switch to proportional time' : 'Switch to compact view'}">${state.ganttCompact ? '<i class="ti ti-clock" aria-hidden="true"></i> Time' : '<i class="ti ti-layout-list" aria-hidden="true"></i> Compact'}</button>`;
  document.getElementById('hvgantt').innerHTML = `
    <div class="hgt-wrap">
      <div class="hgt-head">
        <div class="hgt-head-axis" style="display:flex;align-items:flex-end;padding-bottom:4px">${toggleBtn}</div>
        <div class="hgt-col-hd"><i class="ti ti-home" aria-hidden="true"></i> Accommodation</div>
        <div class="hgt-col-hd"><i class="ti ti-train" aria-hidden="true"></i> Travel</div>
        <div class="hgt-col-hd"><i class="ti ti-calendar-event" aria-hidden="true"></i> Events</div>
      </div>
      <div class="hgt-scroll">
        <div class="hgt-axis" style="height:${totalPx.toFixed(0)}px">${axisHtml}</div>
        <div class="hgt-body" style="height:${totalPx.toFixed(0)}px">
          ${bodyLines}
          <div class="hgt-col">${gapHtml}${blkHtml(accomBlocks)}</div>
          <div class="hgt-col">${blkHtml(travelBlocks)}</div>
          <div class="hgt-col">${blkHtml(eventBlocks)}</div>
        </div>
      </div>
    </div>`;
  setupPopover();
}

// Lazily wire up the timeline popover. A single shared element is positioned
// next to whichever block is hovered (or tapped); content is read from
// state.ganttBlocks so nothing needs to be escaped into markup.
function setupPopover() {
  if (setupPopover._done) return;
  setupPopover._done = true;
  const host = document.getElementById('hvgantt');
  const pop = document.createElement('div');
  pop.className = 'hgt-pop';
  document.body.appendChild(pop);
  function show(blk) {
    const b = state.ganttBlocks[+blk.dataset.bi];
    if (!b) return;
    pop.textContent = '';
    const ttl = document.createElement('div'); ttl.className = 'hgt-pop-ttl';
    const dot = document.createElement('span'); dot.className = 'hgt-pop-dot'; dot.style.background = b.color;
    ttl.appendChild(dot); ttl.appendChild(document.createTextNode(b.label || ''));
    pop.appendChild(ttl);
    if (b.times) { const r = document.createElement('div'); r.className = 'hgt-pop-row'; r.textContent = b.times; pop.appendChild(r); }
    if (b.sub) { const r = document.createElement('div'); r.className = 'hgt-pop-row'; r.textContent = b.sub; pop.appendChild(r); }
    pop.style.display = 'block';
    const rc = blk.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    let left = rc.right + 8;
    if (left + pr.width > window.innerWidth - 8) left = rc.left - pr.width - 8;
    if (left < 8) left = 8;
    let top = rc.top;
    if (top + pr.height > window.innerHeight - 8) top = window.innerHeight - pr.height - 8;
    if (top < 8) top = 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function hide() { pop.style.display = 'none'; }
  host.addEventListener('mouseover', e => { const blk = e.target.closest('.hgt-blk'); if (blk) show(blk); });
  host.addEventListener('mouseout', e => { const blk = e.target.closest('.hgt-blk'); if (!blk) return; const to = e.relatedTarget; if (to && to.closest && to.closest('.hgt-blk')) return; hide(); });
  host.addEventListener('click', e => { const blk = e.target.closest('.hgt-blk'); blk ? show(blk) : hide(); });
  host.addEventListener('scroll', hide, true);
}
