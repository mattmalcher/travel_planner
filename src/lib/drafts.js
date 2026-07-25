/**
 * Starting points for the things you can add by hand (issue #76): a new
 * segment on the itinerary, and a whole new itinerary from scratch.
 *
 * The policy here is deliberate: prefill only what has a defensible default
 * (identity, type, the dates and times from lib/dates.js, an unbooked cost)
 * and leave every *required* piece of content — a name, an operator, a stop —
 * absent. The edit modal validates before it saves, so an untouched draft is
 * refused with the schema's own "must have required property" message and the
 * form's required markers point at what to fill in. Inventing "Untitled" or
 * an empty-string operator would save junk instead.
 *
 * Pure: no DOM, no state. app.js supplies the document and opens the modal.
 */
import { newId } from './ids.js';
import {
  DEFAULT_EVENT_TIME, DEFAULT_EVENT_DURATION_MIN,
  DEFAULT_TRANSPORT_TIME, DEFAULT_TRANSPORT_DURATION_MIN,
  DEFAULT_CHECKIN_FROM, DEFAULT_CHECKOUT_BY,
} from './dates.js';

/** The segment types that can be added by hand, in the order the Itinerary
    view offers them. `label` is the user's word for the type, not the schema's
    (the same translation the tab labels make — issue #71). */
export const SEGMENT_KINDS = [
  { type: 'transport', label: 'Travel' },
  { type: 'accommodation', label: 'Stay' },
  { type: 'event', label: 'Event' },
];

/** The currency a from-scratch trip opens with — the same fallback lib/cost.js
    formats with when a document names none. */
export const DEFAULT_CURRENCY = 'GBP';

/**
 * A prefilled draft segment of `type` for `doc`, with a fresh id that no
 * segment in the document already uses. Dates default to the trip's start
 * (and, for a stay, its end), so the draft lands inside the trip window
 * instead of somewhere the schedule can't show it.
 */
export function newSegmentDraft(type, doc) {
  const segments = (doc && Array.isArray(doc.segments)) ? doc.segments : [];
  const trip = (doc && doc.trip) || {};
  const base = {
    id: newId('seg-', new Set(segments.map(s => s && s.id))),
    type,
    cost: { status: 'not_booked' },
  };
  if (type === 'transport')
    return {
      ...base,
      mode: 'train',
      date: trip.start,
      departs: { time: DEFAULT_TRANSPORT_TIME },
      arrives: { time: DEFAULT_TRANSPORT_TIME },
      duration_min: DEFAULT_TRANSPORT_DURATION_MIN,
    };
  if (type === 'accommodation')
    return {
      ...base,
      checkin: { date: trip.start, from: DEFAULT_CHECKIN_FROM },
      checkout: { date: trip.end || trip.start, by: DEFAULT_CHECKOUT_BY },
    };
  if (type === 'event')
    return {
      ...base,
      subtype: 'activity',
      date: trip.start,
      time: DEFAULT_EVENT_TIME,
      duration_min: DEFAULT_EVENT_DURATION_MIN,
    };
  return null;
}

/**
 * A draft trip for an itinerary started from scratch. The dates open on
 * `todayIso` ("YYYY-MM-DD") so the schedule has a window to draw; the name and
 * travellers are the user's to supply, and validation insists on them.
 */
export function newTripDraft(todayIso) {
  return { start: todayIso, end: todayIso, currency_primary: DEFAULT_CURRENCY };
}

/** The document a from-scratch trip starts life as: nothing planned yet. */
export function blankItinerary(trip) {
  return { trip, segments: [], lists: [] };
}
