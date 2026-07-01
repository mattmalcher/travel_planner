// Budget view: summary cards, upcoming payments, and a per-segment table.
// All the maths lives in lib/cost.js (budgetSummary); this file only renders.
import { state } from '../state.js';
import { budgetSummary } from '../lib/cost.js';
import { fmtDate } from '../lib/dates.js';
import { badge } from './badges.js';

export function renderBudget() {
  const HD = state.HD;
  const { paidGbp, paidEur, pendingGbp, pendingEur, notBooked, upcoming, rows } = budgetSummary(HD.segments, HD.trip.currency_primary);
  const f = n => n.toFixed(2), lbl = { paid: 'Paid', pending: 'Due', partial: 'Part paid', not_booked: 'Not booked', free: 'Free' };
  document.getElementById('hvbudget').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:1.5rem">
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Paid</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-success)">£${f(paidGbp)}</div>
        ${paidEur > 0 ? `<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(paidEur)}</div>` : ''}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Pending</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-warning)">£${f(pendingGbp)}</div>
        ${pendingEur > 0 ? `<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(pendingEur)}</div>` : ''}
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Not booked</div>
        <div style="font-size:21px;font-weight:500;color:var(--color-text-secondary)">${notBooked.length} item${notBooked.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="hsmc"><div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">Total confirmed</div>
        <div style="font-size:21px;font-weight:500">£${f(paidGbp + pendingGbp)}</div>
        ${(paidEur + pendingEur) > 0 ? `<div style="font-size:11px;color:var(--color-text-secondary)">+ €${f(paidEur + pendingEur)}</div>` : ''}
      </div>
    </div>
    ${upcoming.length ? `<div style="font-size:13px;font-weight:500;margin-bottom:.5rem">Upcoming payments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem;margin-bottom:1.5rem">
      ${upcoming.map(p => `<div class="hrow"><span>${p.n}</span><div style="display:flex;gap:10px;align-items:center">${p.due ? `<span style="font-size:12px;color:var(--color-text-secondary)">${fmtDate(p.due)}</span>` : ''}<span style="font-weight:500;color:var(--color-text-warning)">${p.sym}${p.amt.toFixed(2)}</span></div></div>`).join('')}
    </div>` : ''}
    <div style="font-size:13px;font-weight:500;margin-bottom:.5rem">All segments</div>
    <div style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:0 1rem">
      ${rows.map(r => `<div class="hrow">
        <div><div style="font-weight:500">${r.s.name || r.s.operator || 'Segment'}</div>
        <div style="font-size:11px;color:var(--color-text-secondary)">${r.s.type}${r.s.mode ? ' · ' + r.s.mode : ''}${r.s.subtype ? ' · ' + r.s.subtype : ''}</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${badge(r.st, lbl[r.st] || r.st)}
          <span style="font-weight:500;min-width:60px;text-align:right">${r.amt !== null ? r.sym + r.amt.toFixed(2) : '—'}</span>
        </div>
      </div>`).join('')}
    </div>`;
}
