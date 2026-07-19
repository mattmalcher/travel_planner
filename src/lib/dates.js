// Date/time formatting and conversion helpers, plus the single home for
// default times (issue #13): any fallback time or duration used when a
// segment omits one must be defined here, not inline in a view.

// Accommodation check-in/out windows when the segment doesn't specify them.
export const DEFAULT_CHECKIN_FROM = '14:00';
export const DEFAULT_CHECKOUT_BY = '11:00';
// Events without a time/duration on the gantt.
export const DEFAULT_EVENT_TIME = '10:00';
export const DEFAULT_EVENT_DURATION_MIN = 120;

/** "2026-09-18" → "18 Sept 2026" */
export function fmtDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "2026-09-18" → "Fri 18 September" */
export function fmtDayLong(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
}

/** "2026-09-18" → "Fri 18" (timeline date-strip chips, issue #21) */
export function fmtDayShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

/** 138 → "2h 18m", 120 → "2h" */
export function fmtMinutes(m) {
  const h = Math.floor(m / 60), mn = m % 60;
  return mn ? `${h}h ${mn}m` : `${h}h`;
}

/** Local-time ms timestamp for a "YYYY-MM-DD" date and optional "HH:MM" time. */
export function toMs(dateStr, timeStr) {
  return new Date(dateStr + 'T' + (timeStr || '00:00') + ':00').getTime();
}

/**
 * The {startMs, endMs} span an event occupies (issue #13), resolving
 * end_date / end_time / all_day in ONE place so sorting, the proportional
 * gantt and the compact gantt cannot drift apart:
 * - all_day (or a multi-day event with no start time) spans 00:00 on date
 *   to 23:59 on end_date (or date);
 * - a timed event starts at time (or DEFAULT_EVENT_TIME) and ends at
 *   end_time on its last day, at 23:59 of end_date when only end_date is
 *   given, else duration_min (or DEFAULT_EVENT_DURATION_MIN) after start.
 * The end is clamped to at least one minute after the start.
 */
export function eventInterval(s) {
  const endDate = s.end_date || s.date;
  if (s.all_day || (!s.time && s.end_date))
    return { startMs: toMs(s.date, '00:00'), endMs: toMs(endDate, '23:59') };
  const startMs = toMs(s.date, s.time || DEFAULT_EVENT_TIME);
  const endMs = s.end_time ? toMs(endDate, s.end_time)
    : s.end_date ? toMs(endDate, '23:59')
    : startMs + (s.duration_min || DEFAULT_EVENT_DURATION_MIN) * 60000;
  return { startMs, endMs: Math.max(endMs, startMs + 60000) };
}

/** Whole nights between two "YYYY-MM-DD" dates (checkin → checkout). Noon
    anchors keep the difference DST-proof. Never below zero. */
export function nightsBetween(fromIso, toIso) {
  return Math.max(0, Math.round((toMs(toIso, '12:00') - toMs(fromIso, '12:00')) / 86400000));
}

/** Inverse of toMs: ms timestamp → {date:"YYYY-MM-DD", time:"HH:MM"} in local time. */
export function msToIso(ms) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}
