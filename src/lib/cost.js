// Cost/budget maths (issues #10, #16). Pure functions over segment.cost —
// keep every interpretation of the cost object in this module so the list
// and budget views cannot drift apart. Since schema 3.0.0 the one amount
// field is `amount` (the old `total` is gone); when payments[] is present
// an explicit `amount` wins, otherwise the payments are summed.

const fmtCache = {};

/** Format an amount in its currency for display, e.g. "£156.00", "CHF 40.00".
    Falls back to "XYZ 12.00" when the code isn't a real ISO-4217 currency. */
export function fmtCurrency(amount, cur) {
  const code = cur || 'GBP', n = Number(amount) || 0;
  let f = fmtCache[code];
  if (f === undefined) {
    try { f = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }); }
    catch { f = null; }
    fmtCache[code] = f;
  }
  return f ? f.format(n) : code + ' ' + n.toFixed(2);
}

/**
 * What a payments[] schedule totals to: the amount (an explicit `amount` wins
 * over the sum of the instalments), and the status those instalments imply.
 * Both costInfo and budgetSummary need exactly this, and a segment must not
 * read as "paid" in the list and "partial" in the budget.
 *
 * Note this counts only `status: 'pending'` toward pending. budgetSummary's
 * per-currency buckets deliberately bucket *everything not paid* as pending,
 * which is a wider net — so it keeps its own loop and takes only the total and
 * the status from here.
 */
function paymentTotals(c) {
  const sum = st => c.payments.filter(p => p.status === st).reduce((a, p) => a + p.amount, 0);
  const paid = sum('paid'), pending = sum('pending');
  return {
    tot: c.amount ?? c.payments.reduce((a, p) => a + p.amount, 0),
    st: pending > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
  };
}

/**
 * Summarise a segment's cost for display.
 * Returns null (no cost), {t:'inc'} (included in another segment),
 * {t:'nb'} (not booked), or {t:'amt', tot, cur, st, due?}.
 */
export function costInfo(s, primaryCurrency) {
  const c = s.cost;
  if (!c) return null;
  if (c.included_in) return { t: 'inc' };
  if (c.status === 'not_booked') return { t: 'nb' };
  const cur = c.currency || primaryCurrency;
  if (c.payments) {
    const { tot, st } = paymentTotals(c);
    return { t: 'amt', tot, cur, st };
  }
  return { t: 'amt', tot: c.amount || 0, cur, st: c.status, due: c.due };
}

/**
 * Aggregate all segment costs for the budget view, grouped by currency
 * (issue #16). Returns {totals, notBooked, upcoming, rows}:
 * - totals: one {cur, paid, pending} per currency present; the trip's
 *   primary currency always comes first (even when unused)
 * - upcoming: pending payments {n, amt, cur, due} sorted by due date, undated last
 * - rows: one {s, st, amt, cur} per costed segment, in input order
 */
export function budgetSummary(segments, primaryCurrency) {
  const primary = primaryCurrency || 'GBP';
  const byCur = new Map([[primary, { cur: primary, paid: 0, pending: 0 }]]);
  const bucket = cur => {
    if (!byCur.has(cur)) byCur.set(cur, { cur, paid: 0, pending: 0 });
    return byCur.get(cur);
  };
  const upcoming = [], notBooked = [], rows = [];
  for (const s of segments) {
    const c = s.cost;
    if (!c || c.included_in) continue;
    const cur = c.currency || primary;
    if (c.status === 'not_booked') { notBooked.push(s); rows.push({ s, st: 'not_booked', amt: null, cur }); continue; }
    if (c.status === 'free') { rows.push({ s, st: 'free', amt: 0, cur }); continue; }
    const b = bucket(cur);
    if (c.payments) {
      const { tot, st } = paymentTotals(c);
      for (const p of c.payments) {
        if (p.status === 'paid') b.paid += p.amount;
        else { b.pending += p.amount; upcoming.push({ n: s.name || s.operator, amt: p.amount, cur, due: p.due }); }
      }
      rows.push({ s, st, amt: tot, cur });
    } else {
      const amt = c.amount || 0;
      if (c.status === 'paid') b.paid += amt;
      else if (c.status === 'pending') { b.pending += amt; upcoming.push({ n: s.name || s.operator, amt, cur, due: c.due }); }
      rows.push({ s, st: c.status, amt, cur });
    }
  }
  upcoming.sort((a, b) => new Date(a.due || '9999') - new Date(b.due || '9999'));
  return { totals: [...byCur.values()], notBooked, upcoming, rows };
}
