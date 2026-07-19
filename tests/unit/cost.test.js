import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costInfo, budgetSummary, fmtCurrency } from '../../src/lib/cost.js';

// Compare against Intl's own output so tests don't assume the host locale.
const intl = (n, cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);

test('fmtCurrency formats any ISO-4217 code via Intl, not just GBP/EUR', () => {
  assert.equal(fmtCurrency(156, 'GBP'), intl(156, 'GBP'));
  assert.equal(fmtCurrency(40, 'EUR'), intl(40, 'EUR'));
  assert.equal(fmtCurrency(99.5, 'CHF'), intl(99.5, 'CHF'));
  assert.equal(fmtCurrency(1234.56, 'JPY'), intl(1234.56, 'JPY'));
});

test('fmtCurrency survives junk currency codes and amounts', () => {
  assert.equal(fmtCurrency(12, 'XYZ'), intl(12, 'XYZ')); // valid-shaped but unassigned: Intl accepts it
  assert.equal(fmtCurrency(12, 'nope'), 'nope 12.00');
  assert.equal(fmtCurrency('7', 'nope'), 'nope 7.00');
  assert.equal(fmtCurrency(3.5, undefined), intl(3.5, 'GBP'));
});

test('costInfo returns null when a segment has no cost', () => {
  assert.equal(costInfo({ type: 'event' }, 'GBP'), null);
});

test('costInfo flags included and not-booked costs', () => {
  assert.deepEqual(costInfo({ cost: { included_in: 'seg-1' } }, 'GBP'), { t: 'inc' });
  assert.deepEqual(costInfo({ cost: { status: 'not_booked' } }, 'GBP'), { t: 'nb' });
});

test('costInfo reads amount and defaults currency to the trip primary', () => {
  const byAmount = costInfo({ cost: { amount: 87.24, status: 'paid' } }, 'GBP');
  assert.equal(byAmount.tot, 87.24);
  assert.equal(byAmount.cur, 'GBP');
  const withCur = costInfo({ cost: { amount: 156, status: 'paid', currency: 'EUR' } }, 'GBP');
  assert.equal(withCur.tot, 156);
  assert.equal(withCur.cur, 'EUR');
});

test('costInfo derives paid/pending/partial status from payments', () => {
  const seg = st => ({ cost: { payments: [
    { amount: 100, status: 'paid' },
    { amount: 50, status: st },
  ] } });
  assert.equal(costInfo(seg('paid'), 'GBP').st, 'paid');
  assert.equal(costInfo(seg('pending'), 'GBP').st, 'partial');
  assert.equal(costInfo({ cost: { payments: [{ amount: 50, status: 'pending' }] } }, 'GBP').st, 'pending');
  // Sum of payments unless an explicit amount is given.
  assert.equal(costInfo(seg('pending'), 'GBP').tot, 150);
  assert.equal(costInfo({ cost: { amount: 200, payments: [{ amount: 100, status: 'paid' }] } }, 'GBP').tot, 200);
});

const segments = [
  { name: 'Train', cost: { amount: 156, currency: 'GBP', status: 'paid' } },
  { name: 'Hotel', cost: { amount: 87.24, currency: 'GBP', status: 'paid' } },
  { name: 'Festival', cost: { amount: 40, currency: 'EUR', status: 'pending', due: '2026-09-16' } },
  { name: 'Deposit stay', cost: { currency: 'EUR', payments: [
    { amount: 30, status: 'paid' },
    { amount: 70, status: 'pending', due: '2026-06-01' },
  ] } },
  { name: 'Walk', cost: { status: 'free' } },
  { name: 'Later', cost: { status: 'not_booked' } },
  { name: 'Included', cost: { included_in: 'seg-1' } },
  { name: 'Uncosted' },
];

test('budgetSummary groups paid/pending by currency, primary first', () => {
  const b = budgetSummary(segments, 'GBP');
  assert.deepEqual(b.totals, [
    { cur: 'GBP', paid: 156 + 87.24, pending: 0 },
    { cur: 'EUR', paid: 30, pending: 40 + 70 },
  ]);
});

test('budgetSummary keeps a third currency in its own bucket (issue #16)', () => {
  const three = [...segments,
    { name: 'Cable car', cost: { amount: 62, currency: 'CHF', status: 'paid' } },
    { name: 'Fondue night', cost: { amount: 55, currency: 'CHF', status: 'pending' } },
  ];
  const b = budgetSummary(three, 'GBP');
  assert.deepEqual(b.totals.map(t => t.cur), ['GBP', 'EUR', 'CHF']);
  assert.deepEqual(b.totals[2], { cur: 'CHF', paid: 62, pending: 55 });
  // EUR totals are unchanged — nothing foreign leaks into the € bucket.
  assert.deepEqual(b.totals[1], { cur: 'EUR', paid: 30, pending: 110 });
  assert.equal(b.upcoming.find(p => p.n === 'Fondue night').cur, 'CHF');
});

test('budgetSummary always lists the primary currency first, even when unused', () => {
  const b = budgetSummary([{ name: 'Museum', cost: { amount: 15, currency: 'EUR', status: 'paid' } }], 'GBP');
  assert.deepEqual(b.totals, [
    { cur: 'GBP', paid: 0, pending: 0 },
    { cur: 'EUR', paid: 15, pending: 0 },
  ]);
});

test('budgetSummary sorts upcoming payments by due date, undated last', () => {
  const b = budgetSummary([...segments, { name: 'No due', cost: { amount: 5, currency: 'GBP', status: 'pending' } }], 'GBP');
  assert.deepEqual(b.upcoming.map(p => p.n), ['Deposit stay', 'Festival', 'No due']);
});

test('budgetSummary emits one row per costed segment and skips included/uncosted', () => {
  const b = budgetSummary(segments, 'GBP');
  assert.deepEqual(b.rows.map(r => r.st), ['paid', 'paid', 'pending', 'partial', 'free', 'not_booked']);
  assert.equal(b.notBooked.length, 1);
  // not_booked rows have no amount; free rows are zero.
  assert.equal(b.rows.find(r => r.st === 'not_booked').amt, null);
  assert.equal(b.rows.find(r => r.st === 'free').amt, 0);
  // Rows carry the resolved currency for display.
  assert.equal(b.rows.find(r => r.s.name === 'Festival').cur, 'EUR');
  assert.equal(b.rows.find(r => r.s.name === 'Train').cur, 'GBP');
});
