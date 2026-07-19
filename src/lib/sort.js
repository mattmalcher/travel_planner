// Shared chronological ordering of segments (issue #18): the timeline and
// map views must agree on segment order, so both use sortSegments.
import { DEFAULT_EVENT_TIME } from './dates.js';

/** The date a segment sorts under (accommodation sorts by its check-in date). */
export function segDate(s) {
  return s.type === 'accommodation' ? s.checkin.date : s.date;
}

/** The time-of-day key a segment sorts by within its date.
    Accommodation is pinned to end-of-day so a stay always sorts after the
    transport/events that lead to it, regardless of its check-in window.
    All-day events sort to the start of their day; untimed events fall back
    to DEFAULT_EVENT_TIME, the same default the gantt renders them with
    (issue #13). */
export function segTime(s) {
  return s.type === 'transport' ? s.departs.time
    : s.type === 'accommodation' ? '23:59'
    : s.all_day ? '00:00'
    : (s.time || DEFAULT_EVENT_TIME);
}

export function compareSegments(a, b) {
  return segDate(a).localeCompare(segDate(b)) || segTime(a).localeCompare(segTime(b));
}

/** Non-mutating chronological sort of a segments array. */
export function sortSegments(segments) {
  return [...segments].sort(compareSegments);
}
