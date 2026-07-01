// Pure geometry for the gantt view: time→pixel scales and accommodation
// coverage gaps. No DOM — everything here is unit-testable.
import { toMs, DEFAULT_CHECKIN_FROM, DEFAULT_CHECKOUT_BY, DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN } from './dates.js';

export const PX_PER_MIN = 0.25; // proportional mode
export const SLOT_PX = 36;      // compact mode: px between consecutive instants
// Minimum rendered block height. Kept small so blocks stay true to their
// duration (the end position is accurate) rather than being inflated; the
// text that used to need the extra height lives in a hover popover.
export const MIN_BLOCK_PX = 4;

/** Proportional scale: every minute is PX_PER_MIN pixels. */
export function linearScale(tripStartMs, tripEndMs, pxPerMin = PX_PER_MIN) {
  return {
    totalPx: (tripEndMs - tripStartMs) / 60000 * pxPerMin,
    toPx: ms => (ms - tripStartMs) / 60000 * pxPerMin,
  };
}

/** All "interesting" instants for the compact scale: trip bounds, midnight of
    each day, and every segment start/end. Returns sorted unique ms values. */
export function compactPoints(trip, segments) {
  const tripStartMs = toMs(trip.start, '00:00');
  const tripEndMs = new Date(trip.end + 'T23:59:59').getTime();
  const numDays = Math.round((toMs(trip.end, '00:00') - tripStartMs) / 86400000) + 1;
  const pts = new Set([tripStartMs, tripEndMs]);
  for (let d = 0; d < numDays; d++) pts.add(tripStartMs + d * 86400000);
  for (const s of segments) {
    if (s.type === 'accommodation') {
      pts.add(toMs(s.checkin.date, s.checkin.from || DEFAULT_CHECKIN_FROM));
      pts.add(toMs(s.checkout.date, s.checkout.by || DEFAULT_CHECKOUT_BY));
    } else if (s.type === 'transport') {
      const dep = toMs(s.date, s.departs.time);
      pts.add(dep); pts.add(dep + s.duration_min * 60000);
    } else if (s.type === 'event') {
      const ev = toMs(s.date, s.time || DEFAULT_EVENT_TIME);
      pts.add(ev); pts.add(ev + (s.duration_min || DEFAULT_EVENT_DURATION_MIN) * 60000);
    }
  }
  return Array.from(pts).sort((a, b) => a - b);
}

/** Compact scale: consecutive interesting instants are SLOT_PX apart, and
    times between two instants interpolate linearly within their slot. */
export function compactScale(sortedPts, slotPx = SLOT_PX) {
  const cmap = new Map(sortedPts.map((t, i) => [t, i * slotPx]));
  return {
    totalPx: (sortedPts.length - 1) * slotPx,
    toPx: ms => {
      if (cmap.has(ms)) return cmap.get(ms);
      for (let i = 0; i < sortedPts.length - 1; i++) {
        if (sortedPts[i] <= ms && ms <= sortedPts[i + 1])
          return i * slotPx + (ms - sortedPts[i]) / (sortedPts[i + 1] - sortedPts[i]) * slotPx;
      }
      return (sortedPts.length - 1) * slotPx;
    },
  };
}

/** Periods of the trip not covered by any accommodation interval.
    intervals: [{startMs, endMs}] — need not be sorted. Returns [{startMs, endMs}]. */
export function coverageGaps(intervals, tripStartMs, tripEndMs) {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const gaps = [];
  let cursorMs = tripStartMs;
  for (const iv of sorted) {
    if (cursorMs < iv.startMs) gaps.push({ startMs: cursorMs, endMs: iv.startMs });
    cursorMs = Math.max(cursorMs, iv.endMs);
  }
  if (cursorMs < tripEndMs) gaps.push({ startMs: cursorMs, endMs: tripEndMs });
  return gaps;
}
