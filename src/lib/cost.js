// Cost/budget maths (issues #10, #16). Pure functions over segment.cost —
// keep every interpretation of the cost object in this module so the list
// and budget views cannot drift apart.

export function currencySymbol(cur) {
  return cur === 'EUR' ? '€' : '£';
}

/**
 * Summarise a segment's cost for display.
 * Returns null (no cost), {t:'inc'} (included in another segment),
 * {t:'nb'} (not booked), or {t:'amt', tot, sym, cur, st, due?}.
 */
export function costInfo(s, primaryCurrency) {
  const c = s.cost;
  if (!c) return null;
  if (c.included_in) return { t: 'inc' };
  if (c.status === 'not_booked') return { t: 'nb' };
  const cur = c.currency || primaryCurrency, sym = currencySymbol(cur);
  if (c.payments) {
    const tot = c.total || c.payments.reduce((a, p) => a + p.amount, 0);
    const pd = c.payments.filter(p => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
    const pn = c.payments.filter(p => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
    return { t: 'amt', tot, sym, cur, st: pn > 0 ? (pd > 0 ? 'partial' : 'pending') : 'paid' };
  }
  return { t: 'amt', tot: c.amount || c.total || 0, sym, cur, st: c.status, due: c.due };
}

/**
 * Aggregate all segment costs for the budget view.
 * Amounts are bucketed into GBP vs "everything else counted as EUR"
 * (issue #16 tracks making this bucketing currency-correct).
 * Returns {paidGbp, paidEur, pendingGbp, pendingEur, notBooked, upcoming, rows}:
 * - upcoming: pending payments sorted by due date, undated last
 * - rows: one {s, st, amt, sym} per costed segment, in input order
 */
export function budgetSummary(segments, primaryCurrency) {
  let paidGbp = 0, paidEur = 0, pendingGbp = 0, pendingEur = 0;
  const upcoming = [], notBooked = [], rows = [];
  for (const s of segments) {
    const c = s.cost;
    if (!c || c.included_in) continue;
    const cur = c.currency || primaryCurrency, sym = currencySymbol(cur), gbp = cur === 'GBP';
    if (c.status === 'not_booked') { notBooked.push(s); rows.push({ s, st: 'not_booked', amt: null, sym }); continue; }
    if (c.status === 'free') { rows.push({ s, st: 'free', amt: 0, sym }); continue; }
    if (c.payments) {
      const tot = c.total || c.payments.reduce((a, p) => a + p.amount, 0);
      for (const p of c.payments) {
        if (p.status === 'paid') { gbp ? paidGbp += p.amount : paidEur += p.amount; }
        else { gbp ? pendingGbp += p.amount : pendingEur += p.amount; upcoming.push({ n: s.name || s.operator, amt: p.amount, sym, due: p.due }); }
      }
      const pd = c.payments.filter(p => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
      const pn = c.payments.filter(p => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
      rows.push({ s, st: pn > 0 ? (pd > 0 ? 'partial' : 'pending') : 'paid', amt: tot, sym });
    } else {
      const amt = c.amount || c.total || 0;
      if (c.status === 'paid') { gbp ? paidGbp += amt : paidEur += amt; }
      else if (c.status === 'pending') { gbp ? pendingGbp += amt : pendingEur += amt; upcoming.push({ n: s.name || s.operator, amt, sym, due: c.due }); }
      rows.push({ s, st: c.status, amt, sym });
    }
  }
  upcoming.sort((a, b) => new Date(a.due || '9999') - new Date(b.due || '9999'));
  return { paidGbp, paidEur, pendingGbp, pendingEur, notBooked, upcoming, rows };
}
