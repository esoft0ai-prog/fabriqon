// Pure business calculations. No DOM, no IndexedDB: unit-tested in Node.
// Money is handled in minor units (kobo/cents) internally to avoid float drift.

export const toMinor = (amount) => Math.round((Number(amount) || 0) * 100);
export const fromMinor = (minor) => Math.round(minor) / 100;
export const roundMoney = (n) => fromMinor(toMinor(n));

/** Sum of order lines minus discount, never below zero. */
export function orderTotal(items = [], discount = 0) {
  const lines = items.reduce((s, it) => s + toMinor(it.unitPrice) * (Number(it.qty) || 0), 0);
  return fromMinor(Math.max(0, lines - toMinor(discount)));
}

/** Net amount received for an order: payments + deposits − refunds. */
export function amountPaid(payments = []) {
  const minor = payments.reduce((s, p) => {
    const a = toMinor(p.amount);
    return p.type === 'refund' ? s - a : s + a;
  }, 0);
  return fromMinor(minor);
}

/** Balance summary. Positive balance = customer owes; credit = overpaid. */
export function orderBalance(total, payments = []) {
  const paid = amountPaid(payments);
  const diff = toMinor(total) - toMinor(paid);
  return {
    total: roundMoney(total),
    paid,
    balance: fromMinor(Math.max(0, diff)),
    credit: fromMinor(Math.max(0, -diff)),
    paymentStatus: diff <= 0 ? (toMinor(total) === 0 ? 'unpriced' : 'paid') : (toMinor(paid) > 0 ? 'part-paid' : 'unpaid'),
  };
}

/**
 * Validates a new payment against the outstanding balance.
 * Over-payments are rejected unless allowCredit is true.
 */
export function validatePayment({ amount, type = 'payment', balance, paid, allowCredit = false, format = (n) => n.toFixed(2) }) {
  const a = toMinor(amount);
  if (!Number.isFinite(Number(amount)) || a <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
  if (type === 'refund') {
    if (a > toMinor(paid)) return { ok: false, error: 'A refund cannot exceed the amount already paid.' };
    return { ok: true, excess: 0 };
  }
  const excess = a - toMinor(balance);
  if (excess > 0 && !allowCredit) {
    return { ok: false, error: `This is ${format(fromMinor(excess))} more than the outstanding balance. Tick “treat excess as customer credit” to accept it.`, excess: fromMinor(excess) };
  }
  return { ok: true, excess: fromMinor(Math.max(0, excess)) };
}

const inRange = (iso, from, to) => {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
};

/** Cash-basis figures for a period. Revenue is money received, not profit. */
export function financeSummary({ payments = [], expenses = [], from, to }) {
  let rev = 0, refunds = 0, exp = 0;
  for (const p of payments) {
    if (!inRange(p.date, from, to)) continue;
    if (p.type === 'refund') refunds += toMinor(p.amount); else rev += toMinor(p.amount);
  }
  for (const e of expenses) if (inRange(e.date, from, to)) exp += toMinor(e.amount);
  const netRevenue = rev - refunds;
  return {
    received: fromMinor(rev),
    refunds: fromMinor(refunds),
    revenue: fromMinor(netRevenue),
    expenses: fromMinor(exp),
    profit: fromMinor(netRevenue - exp),
  };
}

/** Monthly series (YYYY-MM) for the last n months ending at `end`. */
export function monthlySeries({ payments = [], expenses = [], months = 6, end = new Date() }) {
  const keys = [];
  const d = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  const rev = Object.fromEntries(keys.map(k => [k, 0]));
  const exp = Object.fromEntries(keys.map(k => [k, 0]));
  for (const p of payments) {
    const k = p.date?.slice(0, 7);
    if (k in rev) rev[k] += p.type === 'refund' ? -toMinor(p.amount) : toMinor(p.amount);
  }
  for (const e of expenses) {
    const k = e.date?.slice(0, 7);
    if (k in exp) exp[k] += toMinor(e.amount);
  }
  return keys.map(k => ({ month: k, revenue: fromMinor(rev[k]), expenses: fromMinor(exp[k]), profit: fromMinor(rev[k] - exp[k]) }));
}

/** Inventory valuation at recorded unit cost. */
export function inventoryValue(items = []) {
  return fromMinor(items.reduce((s, i) => s + toMinor(i.unitCost) * Math.max(0, Number(i.quantity) || 0), 0));
}

export const isLowStock = (item) => Number(item.minLevel) > 0 && Number(item.quantity) <= Number(item.minLevel);

/** Applies a stock movement and returns the new quantity, or throws. */
export function applyStockMovement(quantity, type, amount) {
  const q = Number(quantity) || 0;
  const a = Number(amount);
  if (!Number.isFinite(a) || (type !== 'adjust' && a <= 0)) throw new Error('Quantity must be greater than zero.');
  if (type === 'in') return round3(q + a);
  if (type === 'out') {
    if (a > q + 1e-9) throw new Error(`Only ${q} in stock; cannot remove ${a}.`);
    return round3(q - a);
  }
  if (type === 'adjust') {
    if (a < 0) throw new Error('Counted stock cannot be negative.');
    return round3(a);
  }
  throw new Error(`Unknown movement type: ${type}`);
}
const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------- Units ----------
export const CM_PER_INCH = 2.54;
export const CM_PER_YARD = 91.44;

export function convertLength(value, from, to) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (from === to) return v;
  const cm = from === 'in' ? v * CM_PER_INCH : from === 'cm' ? v : from === 'yd' ? v * CM_PER_YARD : from === 'm' ? v * 100 : NaN;
  const out = to === 'in' ? cm / CM_PER_INCH : to === 'cm' ? cm : to === 'yd' ? cm / CM_PER_YARD : to === 'm' ? cm / 100 : NaN;
  return Number.isFinite(out) ? out : null;
}

export const round = (n, dp = 1) => Math.round(Number(n) * 10 ** dp) / 10 ** dp;

/** Converts every numeric value of a measurement map between cm and in. */
export function convertMeasurementValues(values = {}, from, to, ageKey = 'age') {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = k === ageKey ? Number(v) : round(convertLength(v, from, to), 2);
  }
  return out;
}

/** Field-by-field differences between two measurement records (same unit). */
export function compareMeasurements(current = {}, previous = {}) {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...keys].map(key => {
    const a = current[key], b = previous[key];
    const has = (x) => x !== undefined && x !== null && x !== '';
    return { key, current: has(a) ? Number(a) : null, previous: has(b) ? Number(b) : null, delta: has(a) && has(b) ? round(Number(a) - Number(b), 2) : null };
  });
}

// ---------- Orders ----------
export function stageGroup(stageKey, stages, groups) {
  for (const [g, keys] of Object.entries(groups)) if (keys.includes(stageKey)) return g;
  // Custom stage: classify by position relative to "ready".
  const idx = stages.findIndex(s => s.key === stageKey);
  const readyIdx = stages.findIndex(s => s.key === 'ready');
  if (idx < 0) return 'awaiting';
  if (readyIdx >= 0 && idx >= readyIdx) return idx === stages.length - 1 ? 'done' : 'ready';
  return idx <= 2 ? 'awaiting' : 'sewing';
}

export function isOverdue(order, today = new Date().toISOString().slice(0, 10)) {
  return !!order.dueDate && order.dueDate < today && !['delivered'].includes(order.status) && !order.cancelled;
}

export function stageProgress(stageKey, stages) {
  const idx = stages.findIndex(s => s.key === stageKey);
  if (idx < 0 || stages.length < 2) return 0;
  return Math.round((idx / (stages.length - 1)) * 100);
}

/** Average days from order date to delivery for delivered orders. */
export function averageCompletionDays(orders = []) {
  const done = orders.filter(o => o.deliveredAt && o.orderDate);
  if (!done.length) return null;
  const total = done.reduce((s, o) => s + (new Date(o.deliveredAt) - new Date(o.orderDate)) / 86400000, 0);
  return round(total / done.length, 1);
}

/** Simple pricing helper for quotations. */
export function suggestPrice({ materials = 0, labourHours = 0, hourlyRate = 0, overheadPct = 0, marginPct = 0 }) {
  const base = toMinor(materials) + Math.round(toMinor(hourlyRate) * Number(labourHours || 0));
  const withOverhead = Math.round(base * (1 + Number(overheadPct || 0) / 100));
  const price = Math.round(withOverhead * (1 + Number(marginPct || 0) / 100));
  return { cost: fromMinor(withOverhead), price: fromMinor(price), profit: fromMinor(price - withOverhead) };
}

/** Two appointments overlap if their time ranges intersect. */
export function overlaps(a, b) {
  const as = new Date(a.start).getTime(), ae = new Date(a.end || a.start).getTime();
  const bs = new Date(b.start).getTime(), be = new Date(b.end || b.start).getTime();
  return as < be && bs < ae;
}

export function findConflicts(appt, others = []) {
  return others.filter(o => o.id !== appt.id && o.status !== 'cancelled' && overlaps(appt, o));
}
