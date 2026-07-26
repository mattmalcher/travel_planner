// Small shared HTML fragments: status/proposal badges and segment icons.
import { esc } from '../lib/escape.js';

/* `st` is a status straight out of the itinerary document. The schema pins it
   to an enum, but ajv is advisory here — it degrades to "ok" when esm.sh is
   unreachable, and "Load anyway" waives it outright — so a status that never
   met the schema does reach this function, in both the class attribute and the
   label. Escape it (issue #9): everything from a file, a share link or an AI
   reply goes through esc() before it is interpolated into HTML. */
export function badge(st, txt) {
  return `<span class="hbadge ${esc(st)}">${esc(txt || st)}</span>`;
}

/** Badge for a costInfo() result (see lib/cost.js). */
export function costBadge(ci) {
  if (!ci) return '';
  if (ci.t === 'inc') return badge('included', 'Included');
  if (ci.t === 'nb') return badge('not_booked', 'Not booked');
  return badge(ci.st, { paid: 'Paid', pending: 'Due', partial: 'Part paid', free: 'Free' }[ci.st] || ci.st);
}

/** Badge for a segment's proposal status, if it has one. */
export function proposalBadge(s) {
  if (!s.proposal) return '';
  const lbl = { draft: 'Draft', suggested: 'Suggested', considering: 'Considering', confirmed: 'Confirmed', rejected: 'Rejected' };
  return badge(s.proposal.status, lbl[s.proposal.status]);
}

/** Tabler icon class for a segment. */
export function segIcon(s) {
  if (s.type === 'transport') return { train: 'ti-train', bus: 'ti-bus', ferry: 'ti-sailboat', flight: 'ti-plane', taxi: 'ti-car' }[s.mode] || 'ti-route';
  if (s.type === 'accommodation') return 'ti-home';
  return { festival: 'ti-music', gig: 'ti-microphone-2', walk: 'ti-walk', tour: 'ti-flag-2', activity: 'ti-activity', other: 'ti-calendar-event' }[s.subtype] || 'ti-calendar-event';
}
