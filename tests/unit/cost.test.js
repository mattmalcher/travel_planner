import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costInfo, budgetSummary, currencySymbol } from '../../src/lib/cost.js';

test('currencySymbol maps EUR to € and everything else to £', () => {
  assert.equal(currencySymbol('EUR'), '€');
  assert.equal(currencySymbol('GBP'), '£');
  assert.equal(currencySymbol(undefined), '£');
});

test('costInfo returns null when a segment has no cost', () => {
  assert.equal(costInfo({ type: 'event' }, 'GBP'), null);
});

test('costInfo flags included and not-booked costs', () => {
  assert.deepEqual(costInfo({ cost: { included_in: 'seg-1' } }, 'GBP'), { t: 'inc' });
  assert.deepEqual(costInfo({ cost: { status: 'not_booked' } }, 'GBP'), { t: 'nb' });
});

test('costInfo reads amount, falls back to total, and defaults currency to the trip primary', () => {
  const byAmount = costInfo({ cost: { amount: 87.24, status: 'paid' } }, 'GBP');
  assert.equal(byAmount.tot, 87.24);
  assert.equal(byAmount.cur, 'GBP');
  assert.equal(byAmount.sym, '£');
  // Issue #10: segments costed with "total" instead of "amount" must not read as 0.
  const byTotal = costInfo({ cost: { total: 156, status: 'paid', currency: 'EUR' } }, 'GBP');
  assert.equal(byTotal.tot, 156);
  assert.equal(byTotal.sym, '€');
});

test('costInfo derives paid/pending/partial status from payments', () => {
  const seg = st => ({ cost: { payments: [
    { amount: 100, status: 'paid' },
    { amount: 50, status: st },
  ] } });
  assert.equal(costInfo(seg('paid'), 'GBP').st, 'paid');
  assert.equal(costInfo(seg('pending'), 'GBP').st, 'partial');
  assert.equal(costInfo({ cost: { payments: [{ amount: 50, status: 'pending' }] } }, 'GBP').st, 'pending');
  // Sum of payments unless an explicit total is given.
  assert.equal(costInfo(seg('pending'), 'GBP').tot, 150);
  assert.equal(costInfo({ cost: { total: 200, payments: [{ amount: 100, status: 'paid' }] } }, 'GBP').tot, 200);
});

const segments = [
  { name: 'Train', cost: { total: 156, currency: 'GBP', status: 'paid' } },
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

test('budgetSummary buckets paid/pending by currency', () => {
  const b = budgetSummary(segments, 'GBP');
  assert.equal(b.paidGbp, 156 + 87.24);
  assert.equal(b.paidEur, 30);
  assert.equal(b.pendingGbp, 0);
  assert.equal(b.pendingEur, 40 + 70);
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
});
