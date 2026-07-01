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

/** Inverse of toMs: ms timestamp → {date:"YYYY-MM-DD", time:"HH:MM"} in local time. */
export function msToIso(ms) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}
