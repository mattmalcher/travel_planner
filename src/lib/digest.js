// One-line-per-segment itinerary digest for the AI system prompt (issue #31).
// The prompt embeds this instead of the full itinerary JSON, so context cost
// scales with the edit rather than the trip; the model fetches full segment
// JSON on demand via the get_segment tool. Pure: no DOM, no state.
import { sortSegments } from './sort.js';
import { costInfo } from './cost.js';

function money(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Compact cost summary for a digest line, or null when the segment has no
    cost object. Reuses costInfo so digest and views interpret cost alike. */
export function costLine(s, primaryCurrency) {
  const c = costInfo(s, primaryCurrency);
  if (!c) return null;
  if (c.t === 'inc') return 'cost included in ' + s.cost.included_in;
  if (c.t === 'nb') return 'not_booked';
  return c.st + ' ' + c.cur + ' ' + money(c.tot) + (c.due ? ' due ' + c.due : '');
}

function when(s) {
  if (s.type === 'transport')
    return `${s.date} ${s.departs.time} ${s.departs.place} → ${s.arrives.time} ${s.arrives.place}`;
  if (s.type === 'accommodation')
    return `${s.checkin.date}, ${s.nights} night${s.nights === 1 ? '' : 's'}`;
  let w = s.date + (s.time ? ' ' + s.time : '');
  if (s.end_date || s.end_time)
    w += ' → ' + [s.end_date, s.end_time].filter(Boolean).join(' ');
  if (s.all_day) w += ' all-day';
  return w;
}

function who(s) {
  if (s.type === 'transport')
    return [s.operator, s.service, s.ref && 'ref ' + s.ref, s.pass_id && 'pass ' + s.pass_id].filter(Boolean).join(' ');
  if (s.type === 'accommodation')
    return s.name + (s.ref ? ' ref ' + s.ref : '');
  return s.name + (s.artist ? ' — ' + s.artist : '') + (s.venue ? ' @ ' + s.venue : '');
}

/** One digest line for a segment: id | kind | when/where | name | cost,
    then flags for detail the line omits (proposal state, notes, warnings)
    so the model knows there is more to fetch before editing. */
export function segmentLine(s, primaryCurrency) {
  const kind = s.type === 'transport' ? 'transport/' + s.mode
    : s.type === 'event' ? 'event/' + s.subtype
    : s.type;
  const parts = [s.id, kind, when(s), who(s)];
  const cost = costLine(s, primaryCurrency);
  if (cost) parts.push(cost);
  if (s.proposal) parts.push('proposal:' + s.proposal.status);
  if (s.notes) parts.push('+notes');
  if (s.warnings && s.warnings.length) parts.push(`+warnings(${s.warnings.length})`);
  return parts.join(' | ');
}

/** Digest of a whole HolidayItinerary document: a trip header line followed
    by one chronologically sorted line per segment. */
export function itineraryDigest(doc) {
  const t = doc.trip || {};
  const head = `trip: ${t.name} | ${(t.travellers || []).join(', ')} | ${t.start} → ${t.end} | ${t.currency_primary}`;
  const lines = sortSegments(doc.segments || []).map(s => segmentLine(s, t.currency_primary));
  return [head, ...lines].join('\n');
}
