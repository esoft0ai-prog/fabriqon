// Reports & analytics with date-range filtering and PDF / Excel / CSV export.
import { html, icon, raw, emptyState, pageHeader, delegate, skeleton, stat, table, toastError } from '../ui.js';
import { getAll } from '../database.js';
import { loadOrderViews } from '../services.js';
import { financeSummary, monthlySeries, averageCompletionDays, inventoryValue } from '../core/calc.js';
import { money, fmtDate, todayISO, fmtNum, sum, groupBy, byId, download } from '../utils.js';
import { getState } from '../state.js';
import { local } from '../storage.js';
import { renderBarChart, renderDoughnut, chartColors } from '../charts.js';

const PRESETS = {
  '30d': () => { const d = new Date(); d.setDate(d.getDate() - 29); return [d.toISOString().slice(0, 10), todayISO()]; },
  month: () => [`${todayISO().slice(0, 7)}-01`, todayISO()],
  quarter: () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3; return [`${d.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`, todayISO()]; },
  year: () => [`${todayISO().slice(0, 4)}-01-01`, todayISO()],
  '12m': () => { const d = new Date(); d.setMonth(d.getMonth() - 11, 1); return [d.toISOString().slice(0, 7) + '-01', todayISO()]; },
};
const within = (d, from, to) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
const monthsBetween = (from, to) => {
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`);
  return Math.min(24, Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1));
};

export async function render(el) {
  el.innerHTML = String(html`${pageHeader({ title: 'Reports' })}${skeleton(8)}`);
  const [{ orders, payments, custs }, expenses, inventory, moves] = await Promise.all([loadOrderViews(), getAll('expenses'), getAll('inventory'), getAll('inventoryTransactions')]);
  const saved = local.get('reportRange', { preset: '12m' });
  let [from, to] = saved.preset && PRESETS[saved.preset] ? PRESETS[saved.preset]() : [saved.from, saved.to];
  let preset = saved.preset || '';
  const last = getState().stages.at(-1).key;
  const items = byId(inventory);

  const compute = () => {
    const fin = financeSummary({ payments, expenses, from, to });
    const inRange = orders.filter(o => within(o.orderDate, from, to));
    const live = inRange.filter(o => !o.cancelled);
    const cats = Object.entries(groupBy(live, o => o.garmentCategory || 'Uncategorised')).map(([k, v]) => ({ category: k, orders: v.length, value: sum(v, o => o.total) })).sort((a, b) => b.orders - a.orders || b.value - a.value);
    const topCustomers = Object.entries(groupBy(live, o => o.customerId)).map(([id, v]) => ({ name: custs.get(id)?.name || 'Unknown', orders: v.length, value: sum(v, o => o.total), paid: sum(v, o => o.paid) })).sort((a, b) => b.orders - a.orders || b.value - a.value).slice(0, 10);
    const completed = orders.filter(o => !o.cancelled && o.status === last && within(o.deliveredAt, from, to));
    const cancelled = orders.filter(o => o.cancelled && within(o.cancelledAt || o.updatedAt, from, to));
    const outstanding = orders.filter(o => !o.cancelled && o.balance > 0).sort((a, b) => b.balance - a.balance);
    const consumption = Object.entries(groupBy(moves.filter(m => m.type === 'out' && within(m.date, from, to)), m => m.itemId))
      .map(([id, v]) => ({ item: items.get(id)?.name || 'Deleted item', unit: items.get(id)?.unit || '', qty: sum(v, m => m.quantity), cost: sum(v, m => m.quantity * (m.unitCost || items.get(id)?.unitCost || 0)) })).sort((a, b) => b.cost - a.cost);
    const expByCat = Object.entries(groupBy(expenses.filter(e => within(e.date, from, to)), e => e.category)).map(([k, v]) => ({ category: k, amount: sum(v, e => e.amount) })).sort((a, b) => b.amount - a.amount);
    return { fin, inRange, live, cats, topCustomers, completed, cancelled, outstanding, consumption, expByCat, avgDays: averageCompletionDays(completed), invValue: inventoryValue(inventory), series: monthlySeries({ payments, expenses, months: monthsBetween(from, to), end: new Date(`${to}T00:00:00`) }) };
  };

  const paint = () => {
    const r = compute();
    el.innerHTML = String(html`
      ${pageHeader({ title: 'Reports', subtitle: `${fmtDate(from)} – ${fmtDate(to)}`, actions: html`<button class="btn btn-secondary" data-exp="csv">${icon('file-text', 16)} CSV</button><button class="btn btn-secondary" data-exp="xlsx">${icon('file-spreadsheet', 16)} Excel</button><button class="btn btn-primary" data-exp="pdf">${icon('printer', 16)} PDF</button>` })}
      <div class="toolbar">
        <div class="row-wrap" role="group" aria-label="Date range presets">${[['30d', '30 days'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['12m', '12 months']].map(([k, l]) => html`<button class="chip" data-preset="${k}" aria-pressed="${preset === k}">${l}</button>`)}</div>
        <span class="spacer"></span>
        <label class="small muted" for="r-from">From</label><input id="r-from" class="input" type="date" value="${from}" max="${to}">
        <label class="small muted" for="r-to">To</label><input id="r-to" class="input" type="date" value="${to}" min="${from}">
      </div>
      <div class="stats">
        ${stat({ label: 'Revenue', value: money(r.fin.revenue), icon: 'trending-up', tone: 'green', sub: r.fin.refunds ? `${money(r.fin.refunds)} refunded` : 'money received' })}
        ${stat({ label: 'Expenses', value: money(r.fin.expenses), icon: 'trending-down', tone: 'amber' })}
        ${stat({ label: 'Estimated profit', value: money(r.fin.profit), icon: 'circle-dollar-sign', tone: r.fin.profit >= 0 ? 'navy' : 'red' })}
        ${stat({ label: 'Outstanding (now)', value: money(sum(r.outstanding, o => o.balance)), icon: 'wallet', tone: 'red', sub: `${r.outstanding.length} order(s)` })}
        ${stat({ label: 'Orders taken', value: r.live.length, icon: 'clipboard-list', tone: 'blue', sub: `${money(sum(r.live, o => o.total))} booked` })}
        ${stat({ label: 'Completed', value: r.completed.length, icon: 'circle-check', tone: 'green', sub: `${r.cancelled.length} cancelled` })}
        ${stat({ label: 'Avg. completion', value: r.avgDays === null ? '—' : `${r.avgDays} days`, icon: 'clock', tone: 'gold', sub: 'order date → delivery' })}
        ${stat({ label: 'Inventory value', value: money(r.invValue), icon: 'package', tone: 'navy', sub: 'current, at cost' })}
      </div>
      <div class="dash-grid">
        <div class="card span-12"><div class="card-header"><h2 class="card-title">${icon('chart-column', 18)} Monthly revenue, expenses &amp; profit</h2></div><div class="card-body"><div class="chart-box"><canvas id="r-month" role="img" aria-label="Monthly revenue, expenses and profit"></canvas></div></div></div>
        <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('shirt', 18)} Best-selling categories</h2></div><div class="card-body">${r.cats.length ? html`<div class="chart-box sm"><canvas id="r-cats" role="img" aria-label="Orders by garment category"></canvas></div>` : emptyState({ icon: 'shirt', title: 'No orders in this period' })}</div></div>
        <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('receipt', 18)} Expenses by category</h2></div><div class="card-body">${r.expByCat.length ? html`<div class="row" style="gap:20px;align-items:center;flex-wrap:wrap"><div class="chart-box sm" style="flex:1;min-width:180px"><canvas id="r-exp" role="img" aria-label="Expenses by category"></canvas></div><ul class="legend-list" id="r-exp-legend" style="flex:1;min-width:180px"></ul></div>` : emptyState({ icon: 'receipt', title: 'No expenses in this period' })}</div></div>
        <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('star', 18)} Most frequent customers</h2></div>${r.topCustomers.length ? table({ columns: [
          { label: 'Customer', cell: c => html`<strong>${c.name}</strong>` }, { label: 'Orders', cls: 'right', cell: c => c.orders }, { label: 'Booked', cls: 'right', cell: c => html`<span class="num">${money(c.value)}</span>` }, { label: 'Paid', cls: 'right', cell: c => html`<span class="num">${money(c.paid)}</span>` },
        ], rows: r.topCustomers }) : emptyState({ icon: 'users', title: 'No customers in this period' })}</div>
        <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('wallet', 18)} Outstanding payments</h2></div>${r.outstanding.length ? table({ columns: [
          { label: 'Order', cell: o => html`<a href="#/orders/${o.id}"><strong>${o.customerName}</strong></a><br><small class="subtle">${o.number}</small>` }, { label: 'Total', cls: 'right', cell: o => html`<span class="num">${money(o.total)}</span>` }, { label: 'Balance', cls: 'right', cell: o => html`<span class="num strong text-danger">${money(o.balance)}</span>` },
        ], rows: r.outstanding.slice(0, 10) }) : emptyState({ icon: 'circle-check', title: 'Nothing outstanding' })}</div>
        <div class="card span-12"><div class="card-header"><h2 class="card-title">${icon('scissors', 18)} Material consumption</h2></div>${r.consumption.length ? table({ columns: [
          { label: 'Item', cell: c => html`<strong>${c.item}</strong>` }, { label: 'Used', cls: 'right', cell: c => `${fmtNum(c.qty)} ${c.unit}` }, { label: 'Cost at purchase price', cls: 'right', cell: c => html`<span class="num">${money(c.cost)}</span>` },
        ], rows: r.consumption }) : emptyState({ icon: 'package', title: 'No stock used in this period', text: 'Use stock from inventory or deduct fabric from an order to track consumption.' })}</div>
      </div>`);

    renderBarChart(el.querySelector('#r-month'), {
      labels: r.series.map(s => new Date(`${s.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })),
      datasets: [{ label: 'Revenue', data: r.series.map(s => s.revenue), color: 0 }, { label: 'Expenses', data: r.series.map(s => s.expenses), color: 1 }, { label: 'Profit', data: r.series.map(s => s.profit), color: 3, type: 'line' }], money: true,
    });
    if (r.cats.length) renderBarChart(el.querySelector('#r-cats'), { labels: r.cats.slice(0, 8).map(c => c.category), datasets: [{ label: 'Orders', data: r.cats.slice(0, 8).map(c => c.orders), color: 0 }], horizontal: true });
    if (r.expByCat.length) {
      renderDoughnut(el.querySelector('#r-exp'), { labels: r.expByCat.map(e => e.category), data: r.expByCat.map(e => e.amount) });
      const pal = chartColors();
      el.querySelector('#r-exp-legend').innerHTML = String(html`${r.expByCat.map((e, i) => html`<li><span class="sw" style="background:${pal[i % pal.length]}"></span>${e.category}<span class="v">${money(e.amount)}</span></li>`)}`);
    }
    return r;
  };

  let current = paint();

  const exportReport = async (kind) => {
    const r = current;
    const ex = await import('../exports.js');
    const period = `${fmtDate(from)} - ${fmtDate(to)}`;
    const summary = [
      ['Revenue received', money(r.fin.revenue)], ['Refunds', money(r.fin.refunds)], ['Expenses', money(r.fin.expenses)], ['Estimated profit', money(r.fin.profit)],
      ['Orders taken', String(r.live.length)], ['Completed orders', String(r.completed.length)], ['Cancelled orders', String(r.cancelled.length)],
      ['Average completion time', r.avgDays === null ? '-' : `${r.avgDays} days`], ['Outstanding (now)', money(sum(r.outstanding, o => o.balance))], ['Inventory value (now)', money(r.invValue)],
    ];
    const plain = (n) => Math.round(n * 100) / 100;
    if (kind === 'pdf') {
      await ex.reportPdf('Business Report', period, [
        { title: 'Summary', kv: summary.map(([k, v]) => [k, v.replace('₦', 'NGN ')]) },
        { title: 'Monthly figures', head: ['Month', 'Revenue', 'Expenses', 'Profit'], body: r.series.map(s => [s.month, fmtNum(s.revenue), fmtNum(s.expenses), fmtNum(s.profit)]) },
        { title: 'Best-selling categories', head: ['Category', 'Orders', 'Booked value'], body: r.cats.map(c => [c.category, String(c.orders), fmtNum(c.value)]) },
        { title: 'Most frequent customers', head: ['Customer', 'Orders', 'Booked', 'Paid'], body: r.topCustomers.map(c => [c.name, String(c.orders), fmtNum(c.value), fmtNum(c.paid)]) },
        { title: 'Outstanding payments', head: ['Order', 'Customer', 'Balance'], body: r.outstanding.map(o => [o.number, o.customerName, fmtNum(o.balance)]) },
        { title: 'Expenses by category', head: ['Category', 'Amount'], body: r.expByCat.map(e => [e.category, fmtNum(e.amount)]) },
        { title: 'Material consumption', head: ['Item', 'Used', 'Cost'], body: r.consumption.map(c => [c.item, `${fmtNum(c.qty)} ${c.unit}`, fmtNum(c.cost)]) },
      ]);
    } else if (kind === 'xlsx') {
      await ex.exportWorkbook('fabriqon-report', {
        Summary: [{ Metric: 'Period', Value: period }, ...summary.map(([k, v]) => ({ Metric: k, Value: v }))],
        Monthly: r.series.map(s => ({ Month: s.month, Revenue: plain(s.revenue), Expenses: plain(s.expenses), Profit: plain(s.profit) })),
        Categories: r.cats.map(c => ({ Category: c.category, Orders: c.orders, 'Booked value': plain(c.value) })),
        Customers: r.topCustomers.map(c => ({ Customer: c.name, Orders: c.orders, Booked: plain(c.value), Paid: plain(c.paid) })),
        Outstanding: r.outstanding.map(o => ({ Order: o.number, Customer: o.customerName, Total: o.total, Paid: o.paid, Balance: o.balance })),
        Expenses: r.expByCat.map(e => ({ Category: e.category, Amount: plain(e.amount) })),
        Materials: r.consumption.map(c => ({ Item: c.item, Used: c.qty, Unit: c.unit, Cost: plain(c.cost) })),
        Orders: r.inRange.map(o => ({ Number: o.number, Date: o.orderDate, Customer: o.customerName, Garment: o.title, Category: o.garmentCategory, Total: o.total, Paid: o.paid, Balance: o.balance, Status: o.cancelled ? 'Cancelled' : o.status })),
      });
    } else {
      download(`﻿${ex.toCsv(r.series.map(s => ({ Month: s.month, Revenue: plain(s.revenue), Expenses: plain(s.expenses), Profit: plain(s.profit) })))}`, `fabriqon-monthly-${from}-to-${to}.csv`, 'text/csv;charset=utf-8');
    }
  };

  el.addEventListener('change', onRange);
  const off = delegate(el, 'click', '[data-preset],[data-exp]', async (e, b) => {
    if (b.dataset.preset) { preset = b.dataset.preset; [from, to] = PRESETS[preset](); local.set('reportRange', { preset }); current = paint(); }
    else { try { await exportReport(b.dataset.exp); } catch (err) { toastError(err); } }
  });
  return () => { off(); el.removeEventListener('change', onRange); };

  function onRange(e) {
    if (e.target.id !== 'r-from' && e.target.id !== 'r-to') return;
    const f = el.querySelector('#r-from').value, t = el.querySelector('#r-to').value;
    if (!f || !t || f > t) return;
    from = f; to = t; preset = '';
    local.set('reportRange', { from, to });
    current = paint();
  }
}

