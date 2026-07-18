// Budget view: summary cards, upcoming payments, and a per-segment table.
// All the maths lives in lib/cost.js (budgetSummary); this file only renders.
import { state } from '../state.js';
import { budgetSummary, fmtCurrency } from '../lib/cost.js';
import { fmtDate } from '../lib/dates.js';
import { esc } from '../lib/escape.js';
import { badge } from './badges.js';

export function renderBudget() {
  const HD = state.HD;
  const { totals, notBooked, upcoming, rows } = budgetSummary(HD.segments, HD.trip.currency_primary);
  // budgetSummary puts the trip's primary currency first; the card shows it
  // large with one small "+" line per other currency present (issue #16).
  const [prim, ...others] = totals;
  const extras = get => others.filter(t => get(t) > 0)
    .map(t => `<div style="font-size:11px;color:var(--color-text-secondary)">+ ${esc(fmtCurrency(get(t), t.cur))}</div>`).join('');
  const lbl = { paid: 'Paid', pending: 'Due', partial: 'Part paid', not_booked: 'Not booked', free: 'Free' };
  document.getElementById('hvbudget').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:1.5rem">
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Paid</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-success)">${esc(fmtCurrency(prim.paid, prim.cur))}</div>
        ${extras(t => t.paid)}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Pending</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-warning)">${esc(fmtCurrency(prim.pending, prim.cur))}</div>
        ${extras(t => t.pending)}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Not booked</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-secondary)">${notBooked.length} item${notBooked.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Total confirmed</div>
        <div style="font-size:21px;font-weight:500">${esc(fmtCurrency(prim.paid + prim.pending, prim.cur))}</div>
        ${extras(t => t.paid + t.pending)}
      </div>
    </div>
    ${upcoming.length ? `<div style="font-size:13px;font-weight:500;margin-bottom:.5rem">Upcoming payments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem;margin-bottom:1.5rem">
      ${upcoming.map(p => `<div class="hrow"><span>${esc(p.n)}</span><div style="display:flex;gap:10px;align-items:center">${p.due ? `<span style="font-size:12px;color:var(--color-text-secondary)">${fmtDate(p.due)}</span>` : ''}<span style="font-weight:500;color:var(--color-text-warning)">${esc(fmtCurrency(p.amt, p.cur))}</span></div></div>`).join('')}
    </div>` : ''}
    <div style="font-size:13px;font-weight:500;margin-bottom:.5rem">All segments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem">
      ${rows.map(r => `<div class="hrow">
        <div><div style="font-weight:500">${esc(r.s.name || r.s.operator || 'Segment')}</div>
        <div style="font-size:11px;color:var(--color-text-secondary)">${esc(r.s.type)}${r.s.mode ? ' · ' + esc(r.s.mode) : ''}${r.s.subtype ? ' · ' + esc(r.s.subtype) : ''}</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${badge(r.st, lbl[r.st] || r.st)}
          <span style="font-weight:500;min-width:60px;text-align:right">${r.amt !== null ? esc(fmtCurrency(r.amt, r.cur)) : '—'}</span>
        </div>
      </div>`).join('')}
    </div>`;
}
