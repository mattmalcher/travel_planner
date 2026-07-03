// A shared "sense of now" (issue #35): pure helpers deciding whether the
// viewer is being used mid-trip and which itinerary day counts as today.
// Callers pass nowMs (i.e. Date.now()) so everything here stays deterministic
// and unit-testable.
import { toMs, msToIso } from './dates.js';

/** True when nowMs falls inside the trip: from 00:00 local time on trip.start
    up to (but not including) midnight after trip.end. */
export function isDuringTrip(trip, nowMs) {
  return nowMs >= toMs(trip.start, '00:00') && nowMs < toMs(trip.end, '00:00') + 86400000;
}

/** The day-group the timeline should treat as "today". `days` are the sorted
    "YYYY-MM-DD" keys of days that actually have segments; today may not be
    one of them (e.g. a rest day mid-stay), so the latest listed day not after
    today is returned instead. Null when now is outside the trip or before the
    first listed day. */
export function currentDayChip(days, trip, nowMs) {
  if (!isDuringTrip(trip, nowMs)) return null;
  const today = msToIso(nowMs).date;
  let cur = null;
  for (const d of days) if (d <= today) cur = d;
  return cur;
}
