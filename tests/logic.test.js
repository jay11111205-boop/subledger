'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app/src/main/assets/logic.js');

test('monthly renewal clamps to the end of short months', () => {
  assert.equal(L.nextRenewal('2026-01-31', 'monthly', '2026-02-10'), '2026-02-28');
  assert.equal(L.nextRenewal('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  assert.equal(L.nextRenewal('2026-01-31', 'monthly', '2026-04-05'), '2026-04-30');
});

test('a renewal that falls on today counts as today', () => {
  assert.equal(L.nextRenewal('2026-10-07', 'monthly', '2026-11-07'), '2026-11-07');
  assert.equal(L.daysBetween('2026-11-07', '2026-11-07'), 0);
});

test('a future start date is returned unchanged', () => {
  assert.equal(L.nextRenewal('2027-05-01', 'yearly', '2026-11-07'), '2027-05-01');
});

test('weekly renewals step in sevens', () => {
  assert.equal(L.nextRenewal('2026-11-01', 'weekly', '2026-11-07'), '2026-11-08');
  assert.equal(L.nextRenewal('2026-11-01', 'weekly', '2026-11-08'), '2026-11-08');
  assert.equal(L.nextRenewal('2026-11-01', 'weekly', '2026-11-09'), '2026-11-15');
});

test('quarterly renewals step in threes', () => {
  assert.equal(L.nextRenewal('2026-01-15', 'quarterly', '2026-11-07'), '2027-01-15');
  assert.equal(L.nextRenewal('2026-01-15', 'quarterly', '2026-04-16'), '2026-07-15');
});

test('yearly renewal on Feb 29 lands on Feb 28 in common years', () => {
  assert.equal(L.nextRenewal('2024-02-29', 'yearly', '2025-03-01'), '2026-02-28');
  assert.equal(L.nextRenewal('2024-02-29', 'yearly', '2027-12-01'), '2028-02-29');
});

test('nextRenewal rejects bad input', () => {
  assert.equal(L.nextRenewal('nope', 'monthly', '2026-11-07'), null);
  assert.equal(L.nextRenewal('2026-02-30', 'monthly', '2026-11-07'), null);
  assert.equal(L.nextRenewal('2026-01-01', 'hourly', '2026-11-07'), null);
});

test('parseMoney accepts normal prices and rejects junk', () => {
  assert.equal(L.parseMoney('9.99'), 999);
  assert.equal(L.parseMoney('9,99'), 999);
  assert.equal(L.parseMoney('10'), 1000);
  assert.equal(L.parseMoney(' 0.5 '), 50);
  assert.equal(L.parseMoney('0'), 0);
  assert.equal(L.parseMoney(''), null);
  assert.equal(L.parseMoney('abc'), null);
  assert.equal(L.parseMoney('1.234'), null);
  assert.equal(L.parseMoney('-5'), null);
});

test('formatMoney groups thousands and pads cents', () => {
  assert.equal(L.formatMoney(123456, '$'), '$1,234.56');
  assert.equal(L.formatMoney(5, '$'), '$0.05');
  assert.equal(L.formatMoney(0, ''), '0.00');
  assert.equal(L.formatMoney(100000000, 'EUR '), 'EUR 1,000,000.00');
});

test('monthly equivalents', () => {
  assert.equal(L.monthlyCents({ cents: 1200, cycle: 'yearly' }), 100);
  assert.equal(L.monthlyCents({ cents: 300, cycle: 'quarterly' }), 100);
  assert.equal(L.monthlyCents({ cents: 1000, cycle: 'monthly' }), 1000);
  assert.ok(Math.abs(L.monthlyCents({ cents: 1000, cycle: 'weekly' }) - 4333.3333) < 0.001);
});

test('totals ignore paused subscriptions and group by category', () => {
  const subs = [
    { cents: 1000, cycle: 'monthly', active: true, category: 'Streaming' },
    { cents: 1200, cycle: 'yearly', active: true, category: 'Software' },
    { cents: 5000, cycle: 'monthly', active: false, category: 'Streaming' }
  ];
  const t = L.totals(subs);
  assert.equal(t.monthly, 1100);
  assert.equal(t.yearly, 13200);
  assert.equal(t.active, 2);
  assert.deepEqual(t.byCategory, { Streaming: 1000, Software: 100 });
});

test('dueWithin sums real charges, not monthly averages', () => {
  const subs = [
    { cents: 1200, cycle: 'yearly', start: '2026-11-10', active: true },
    { cents: 999, cycle: 'monthly', start: '2026-01-20', active: true },
    { cents: 500, cycle: 'monthly', start: '2026-11-08', active: false }
  ];
  const due = L.dueWithin(subs, '2026-11-07', 7);
  assert.equal(due.count, 1);
  assert.equal(due.cents, 1200);
});

test('describeDays and formatDate', () => {
  assert.equal(L.describeDays(0), 'today');
  assert.equal(L.describeDays(1), 'tomorrow');
  assert.equal(L.describeDays(14), 'in 14 days');
  assert.equal(L.formatDate('2026-11-21', '2026-11-07'), 'Nov 21');
  assert.equal(L.formatDate('2027-01-02', '2026-11-07'), 'Jan 2, 2027');
});

test('sanitizeImport drops bad rows and fixes odd values', () => {
  const out = L.sanitizeImport({
    currency: '  EUR  and more',
    subscriptions: [
      { id: 'a', name: '  Netflix ', cents: 1599, cycle: 'monthly', start: '2026-11-21', category: 'Streaming', active: true },
      { id: 'a', name: 'Duplicate id', cents: 100, cycle: 'bogus', start: '2026-01-01', category: 'Nope' },
      { name: '', cents: 100, start: '2026-01-01' },
      { name: 'Bad date', cents: 100, start: '2026-13-01' },
      { name: 'Bad price', cents: -5, start: '2026-01-01' },
      'not an object',
      null
    ]
  });
  assert.equal(out.subs.length, 2);
  assert.equal(out.skipped, 5);
  assert.equal(out.currency, 'EUR');
  assert.equal(out.subs[0].name, 'Netflix');
  assert.notEqual(out.subs[0].id, out.subs[1].id);
  assert.equal(out.subs[1].cycle, 'monthly');
  assert.equal(out.subs[1].category, 'Other');
});

test('sanitizeImport rejects things that are not backups', () => {
  assert.equal(L.sanitizeImport({ hello: 'world' }), null);
  assert.equal(L.sanitizeImport('text'), null);
  assert.equal(L.sanitizeImport(null), null);
  assert.equal(L.sanitizeImport([]).subs.length, 0);
});

test('export then import round trips', () => {
  const state = {
    currency: '$',
    subs: [{ id: 'x1', name: 'Music', cents: 1099, cycle: 'monthly', start: '2026-12-01', category: 'Music', note: 'family plan', active: true }]
  };
  const back = L.sanitizeImport(JSON.parse(L.buildExport(state)));
  assert.deepEqual(back.subs, state.subs);
  assert.equal(back.currency, '$');
});

test('mergeSubs replaces by id and appends the rest', () => {
  const current = [{ id: '1', name: 'Old' }, { id: '2', name: 'Keep' }];
  const merged = L.mergeSubs(current, [{ id: '1', name: 'New' }, { id: '3', name: 'Added' }]);
  assert.deepEqual(merged.map(s => s.name), ['New', 'Keep', 'Added']);
});
