// Referential-integrity checks the JSON Schema can't express (issue #17):
// id uniqueness, dangling cross-references, traveller-name typos, payment
// sums and the accommodation date alias. Pure — takes a HolidayItinerary
// document, returns an array of human-readable warning strings. These are
// advisory (a warned document still loads); run them after schema validation.

/** Two-decimal tolerance for comparing payment sums to a declared total. */
const SUM_TOLERANCE = 0.005;

export function lintItinerary(doc) {
  const warnings = [];
  if (!doc || !Array.isArray(doc.segments)) return warnings;
  const segments = doc.segments;
  const travellers = new Set((doc.trip && doc.trip.travellers) || []);

  const ids = new Set();
  for (const seg of segments) {
    if (!seg || !seg.id) continue;
    if (ids.has(seg.id)) warnings.push(`duplicate segment id "${seg.id}" — edits by id will only ever reach the first match`);
    ids.add(seg.id);
  }

  // Only meaningful when the trip actually lists travellers; an empty list
  // would just flag every name.
  const checkName = (name, where) => {
    if (name && travellers.size && !travellers.has(name))
      warnings.push(`${where} "${name}" is not in trip.travellers`);
  };

  segments.forEach((seg, i) => {
    if (!seg) return;
    const label = seg.id ? `segment "${seg.id}"` : `segment ${i + 1}`;

    if (seg.parent_event_id) {
      if (seg.parent_event_id === seg.id) warnings.push(`${label}: parent_event_id refers to itself`);
      else if (!ids.has(seg.parent_event_id)) warnings.push(`${label}: parent_event_id "${seg.parent_event_id}" does not match any segment id`);
    }

    const cost = seg.cost;
    if (cost) {
      if (cost.included_in) {
        if (cost.included_in === seg.id) warnings.push(`${label}: cost.included_in refers to itself`);
        else if (!ids.has(cost.included_in)) warnings.push(`${label}: cost.included_in "${cost.included_in}" does not match any segment id`);
      }
      checkName(cost.paid_by, `${label}: cost.paid_by`);
      if (Array.isArray(cost.payments)) {
        cost.payments.forEach((p, j) => checkName(p && p.paid_by, `${label}: payments[${j}].paid_by`));
        if (typeof cost.total === 'number' && cost.payments.length) {
          const sum = cost.payments.reduce((acc, p) => acc + ((p && typeof p.amount === 'number') ? p.amount : 0), 0);
          if (Math.abs(sum - cost.total) > SUM_TOLERANCE)
            warnings.push(`${label}: payments sum to ${sum.toFixed(2)} but cost.total is ${cost.total.toFixed(2)}`);
        }
      }
    }

    if (Array.isArray(seg.seats))
      seg.seats.forEach((s, j) => checkName(s && s.traveller, `${label}: seats[${j}].traveller`));
    if (seg.proposal) checkName(seg.proposal.proposed_by, `${label}: proposal.proposed_by`);

    // The alias exists for uniform sorting; a mismatch means the segment
    // sorts to a different day than it checks in (see issue #12).
    if (seg.type === 'accommodation' && seg.date && seg.checkin && seg.checkin.date && seg.date !== seg.checkin.date)
      warnings.push(`${label}: date "${seg.date}" does not match checkin.date "${seg.checkin.date}"`);
  });

  return warnings;
}
