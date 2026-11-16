import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orderTotal, amountPaid, orderBalance, validatePayment, financeSummary, monthlySeries, inventoryValue, isLowStock,
  applyStockMovement, convertLength, convertMeasurementValues, compareMeasurements, stageGroup, isOverdue, stageProgress,
  averageCompletionDays, suggestPrice, overlaps, findConflicts,
} from '../js/core/calc.js';
import { DEFAULT_STAGES, STAGE_GROUPS } from '../js/core/defaults.js';

test('order total sums lines and applies discount without floating-point drift', () => {
  assert.equal(orderTotal([{ qty: 3, unitPrice: 0.1 }, { qty: 1, unitPrice: 0.2 }]), 0.5);
  assert.equal(orderTotal([{ qty: 2, unitPrice: 95000 }], 5000), 185000);
  assert.equal(orderTotal([{ qty: 1, unitPrice: 1000 }], 5000), 0, 'never negative');
  assert.equal(orderTotal([]), 0);
});

test('amount paid subtracts refunds', () => {
  assert.equal(amountPaid([{ amount: 20000, type: 'deposit' }, { amount: 15000, type: 'payment' }, { amount: 5000, type: 'refund' }]), 30000);
});

test('order balance distinguishes owing, paid and credit', () => {
  assert.deepEqual(orderBalance(35000, [{ amount: 20000, type: 'deposit' }]), { total: 35000, paid: 20000, balance: 15000, credit: 0, paymentStatus: 'part-paid' });
  assert.equal(orderBalance(35000, [{ amount: 35000, type: 'payment' }]).paymentStatus, 'paid');
  const over = orderBalance(35000, [{ amount: 40000, type: 'payment' }]);
  assert.equal(over.balance, 0);
  assert.equal(over.credit, 5000);
  assert.equal(orderBalance(10000, []).paymentStatus, 'unpaid');
});

test('payments above the balance are rejected unless treated as credit', () => {
  assert.equal(validatePayment({ amount: 5000, balance: 15000, paid: 20000 }).ok, true);
  const bad = validatePayment({ amount: 20000, balance: 15000, paid: 20000 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /credit/);
  const credit = validatePayment({ amount: 20000, balance: 15000, paid: 20000, allowCredit: true });
  assert.equal(credit.ok, true);
  assert.equal(credit.excess, 5000);
  assert.equal(validatePayment({ amount: 0, balance: 100, paid: 0 }).ok, false);
  assert.equal(validatePayment({ amount: -5, balance: 100, paid: 0 }).ok, false);
});

test('refunds cannot exceed what was paid', () => {
  assert.equal(validatePayment({ amount: 30000, type: 'refund', balance: 0, paid: 20000 }).ok, false);
  assert.equal(validatePayment({ amount: 20000, type: 'refund', balance: 0, paid: 20000 }).ok, true);
});

test('finance summary is cash-basis and keeps revenue separate from profit', () => {
  const payments = [
    { amount: 50000, type: 'deposit', date: '2026-10-02' }, { amount: 30000, type: 'payment', date: '2026-10-20' },
    { amount: 10000, type: 'refund', date: '2026-10-21' }, { amount: 99999, type: 'payment', date: '2026-09-30' },
  ];
  const expenses = [{ amount: 25000, date: '2026-10-05' }, { amount: 1000, date: '2026-11-01' }];
  const s = financeSummary({ payments, expenses, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(s, { received: 80000, refunds: 10000, revenue: 70000, expenses: 25000, profit: 45000 });
});

test('monthly series covers the requested months in order', () => {
  const s = monthlySeries({ payments: [{ amount: 100, type: 'payment', date: '2026-11-03' }], expenses: [{ amount: 40, date: '2026-10-10' }], months: 3, end: new Date(2026, 10, 16) });
  assert.deepEqual(s.map(r => r.month), ['2026-09', '2026-10', '2026-11']);
  assert.equal(s[1].profit, -40);
  assert.equal(s[2].revenue, 100);
});

test('inventory valuation and low stock', () => {
  assert.equal(inventoryValue([{ unitCost: 4500, quantity: 18 }, { unitCost: 0.5, quantity: 3 }, { unitCost: 100, quantity: -2 }]), 81001.5);
  assert.equal(isLowStock({ quantity: 4, minLevel: 5 }), true);
  assert.equal(isLowStock({ quantity: 5, minLevel: 5 }), true);
  assert.equal(isLowStock({ quantity: 6, minLevel: 5 }), false);
  assert.equal(isLowStock({ quantity: 0, minLevel: 0 }), false, 'no minimum set → never low');
});

test('stock movements never go negative', () => {
  assert.equal(applyStockMovement(10, 'in', 2.5), 12.5);
  assert.equal(applyStockMovement(10, 'out', 4), 6);
  assert.throws(() => applyStockMovement(3, 'out', 4), /Only 3 in stock/);
  assert.equal(applyStockMovement(10, 'adjust', 7), 7);
  assert.throws(() => applyStockMovement(10, 'adjust', -1));
  assert.throws(() => applyStockMovement(10, 'in', 0));
});

test('unit conversion between cm, inches, yards and metres', () => {
  assert.equal(convertLength(2.54, 'cm', 'in'), 1);
  assert.equal(convertLength(36, 'in', 'yd'), 1);
  assert.equal(convertLength(1, 'yd', 'm'), 0.9144);
  assert.equal(convertLength(5, 'cm', 'cm'), 5);
  assert.equal(convertLength('x', 'cm', 'in'), null);
  assert.deepEqual(convertMeasurementValues({ chest: 101.6, age: 8 }, 'cm', 'in'), { chest: 40, age: 8 }, 'age is never converted');
});

test('measurement comparison reports deltas', () => {
  const d = compareMeasurements({ chest: 104, waist: 90 }, { chest: 102, hip: 100 });
  assert.deepEqual(d.find(x => x.key === 'chest'), { key: 'chest', current: 104, previous: 102, delta: 2 });
  assert.equal(d.find(x => x.key === 'hip').current, null);
  assert.equal(d.find(x => x.key === 'waist').delta, null);
});

test('stage grouping, progress and overdue detection', () => {
  assert.equal(stageGroup('sourcing', DEFAULT_STAGES, STAGE_GROUPS), 'awaiting');
  assert.equal(stageGroup('sewing', DEFAULT_STAGES, STAGE_GROUPS), 'sewing');
  assert.equal(stageGroup('ready', DEFAULT_STAGES, STAGE_GROUPS), 'ready');
  assert.equal(stageGroup('delivered', DEFAULT_STAGES, STAGE_GROUPS), 'done');
  const custom = [...DEFAULT_STAGES.slice(0, 5), { key: 'custom_embroidery', label: 'Embroidery' }, ...DEFAULT_STAGES.slice(5)];
  assert.equal(stageGroup('custom_embroidery', custom, STAGE_GROUPS), 'sewing');
  assert.equal(stageProgress('received', DEFAULT_STAGES), 0);
  assert.equal(stageProgress('delivered', DEFAULT_STAGES), 100);
  assert.equal(isOverdue({ dueDate: '2026-11-10', status: 'sewing' }, '2026-11-16'), true);
  assert.equal(isOverdue({ dueDate: '2026-11-10', status: 'delivered' }, '2026-11-16'), false);
  assert.equal(isOverdue({ dueDate: '2026-11-10', status: 'sewing', cancelled: true }, '2026-11-16'), false);
  assert.equal(isOverdue({ dueDate: '2026-11-16', status: 'sewing' }, '2026-11-16'), false, 'due today is not overdue');
});

test('average completion time', () => {
  assert.equal(averageCompletionDays([]), null);
  assert.equal(averageCompletionDays([{ orderDate: '2026-01-01', deliveredAt: '2026-01-11T00:00:00' }, { orderDate: '2026-01-01', deliveredAt: '2026-01-05T00:00:00' }]), 7);
});

test('pricing helper adds overheads then margin', () => {
  assert.deepEqual(suggestPrice({ materials: 10000, labourHours: 4, hourlyRate: 2500, overheadPct: 10, marginPct: 20 }), { cost: 22000, price: 26400, profit: 4400 });
});

test('appointment overlap detection', () => {
  const a = { id: 'a', start: '2026-11-16T10:00:00Z', end: '2026-11-16T10:30:00Z' };
  const b = { id: 'b', start: '2026-11-16T10:15:00Z', end: '2026-11-16T11:00:00Z' };
  const c = { id: 'c', start: '2026-11-16T10:30:00Z', end: '2026-11-16T11:00:00Z' };
  assert.equal(overlaps(a, b), true);
  assert.equal(overlaps(a, c), false, 'back-to-back is not an overlap');
  assert.deepEqual(findConflicts(a, [a, b, c, { ...b, id: 'x', status: 'cancelled' }]).map(x => x.id), ['b']);
});
