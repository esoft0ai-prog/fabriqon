// Dashboard: every figure is computed from IndexedDB records.
import { html, icon, raw, emptyState, delegate, stat, skeleton } from '../ui.js';
import { getAll, latest } from '../database.js';
import { loadOrderViews } from '../services.js';
import { financeSummary, monthlySeries, stageGroup, isLowStock } from '../core/calc.js';
import { STAGE_GROUPS } from '../core/defaults.js';
import { money, fmtDate, relDays, todayISO, addDays, timeAgo, sum, byId } from '../utils.js';
import { getState, stageLabel } from '../state.js';
import { renderBarChart, renderDoughnut, chartColors } from '../charts.js';
import { QUICK_ACTIONS, runQuickAction } from '../quick.js';
import { local } from '../storage.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export async function render(el) {
  el.innerHTML = String(html`<div class="skeleton skeleton-card" style="height:120px;margin-bottom:20px"></div><div class="stats">${Array.from({ length: 4 }, () => html`<div class="skeleton skeleton-card"></div>`)}</div>${skeleton(6)}`);
  const [{ orders, payments, custs }, customers, expenses, inventory, appts, activity] = await Promise.all([
    loadOrderViews(), getAll('customers'), getAll('expenses'), getAll('inventory'), getAll('appointments'), latest('activityLogs', 'at', 8),
  ]);
  const b = getState().business || {};
  const stages = getState().stages;
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = financeSummary({ payments, expenses, from: monthStart, to: today });
  const allTime = financeSummary({ payments, expenses });
  const live = orders.filter(o => !o.cancelled);
  const groups = { awaiting: 0, sewing: 0, ready: 0, done: 0 };
  for (const o of live) groups[stageGroup(o.status, stages, STAGE_GROUPS)]++;
  const active = live.filter(o => o.status !== stages.at(-1).key);
  const outstanding = sum(live, o => o.balance);
  const low = inventory.filter(isLowStock);
  const deadlines = active.filter(o => o.dueDate && o.dueDate <= addDays(today, 7)).sort((a, c) => a.dueDate.localeCompare(c.dueDate)).slice(0, 7);
  const upcomingAppts = appts.filter(a => a.status === 'scheduled' && a.start >= new Date().toISOString()).sort((a, c) => a.start.localeCompare(c.start)).slice(0, 4);
  const recentPays = [...payments].sort((a, c) => c.date.localeCompare(a.date) || c.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const ordersById = byId(orders);
  const fresh = !customers.length && !orders.length;
  const lastBackup = local.get('lastBackupAt');

  el.innerHTML = String(html`
    <section class="hero" aria-label="Summary">
      <div style="position:relative;z-index:1"><h1>${greeting()}${b.owner ? `, ${b.owner.split(' ')[0]}` : ''}</h1>
        <p>${b.name || 'Your workshop'} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div class="hero-figures">
        <div><small>Revenue this month</small><strong class="gold">${money(month.revenue)}</strong></div>
        <div><small>Outstanding</small><strong>${money(outstanding)}</strong></div>
        <div><small>Active orders</small><strong>${active.length}</strong></div>
      </div>
    </section>

    <nav class="quick-actions" aria-label="Quick actions">
      ${QUICK_ACTIONS.slice(0, 6).map(a => html`<button class="qa card card-link" data-qa="${a.key}"><span class="qa-icon">${icon(a.icon, 20)}</span>${a.label}</button>`)}
    </nav>

    ${fresh ? html`<div class="card card-pad mb-4"><h2 class="card-title mb-3">${icon('sparkles', 18)} Get started</h2>
      <ol class="stack-sm" style="margin:0;padding-left:20px">
        <li><a class="strong" href="#/customers" data-qa-link="customer">Add your first customer</a> <span class="muted small">— name and phone are enough</span></li>
        <li><a class="strong" href="#/measurements/new">Take their measurements</a> <span class="muted small">— one field at a time on your phone</span></li>
        <li><a class="strong" href="#/orders/new">Create an order</a> <span class="muted small">— price, deposit and delivery date</span></li>
        <li><a class="strong" href="#/inventory">Record your fabrics and accessories</a></li>
        <li><a class="strong" href="#/settings?tab=data">Download a backup</a> <span class="muted small">— your data lives only on this device</span></li>
      </ol></div>` : ''}

    <div class="stats">
      ${stat({ label: 'Customers', value: customers.filter(c => !c.archived).length, icon: 'users', tone: 'navy', href: '#/customers', sub: `${customers.filter(c => c.createdAt.slice(0, 7) === today.slice(0, 7)).length} new this month` })}
      ${stat({ label: 'Active orders', value: active.length, icon: 'clipboard-list', tone: 'blue', href: '#/orders', sub: `${active.filter(o => o.overdue).length} overdue` })}
      ${stat({ label: 'Awaiting production', value: groups.awaiting, icon: 'clock', tone: 'amber', href: '#/production' })}
      ${stat({ label: 'Being sewn', value: groups.sewing, icon: 'scissors', tone: 'gold', href: '#/production' })}
      ${stat({ label: 'Awaiting collection', value: groups.ready, icon: 'shopping-bag', tone: 'green', href: '#/orders?view=ready' })}
      ${stat({ label: 'Completed', value: groups.done, icon: 'circle-check', tone: 'navy', href: '#/orders?view=delivered', sub: 'delivered orders' })}
      ${stat({ label: 'Expenses this month', value: money(month.expenses), icon: 'receipt', tone: 'amber', href: '#/finance?tab=expenses' })}
      ${stat({ label: 'Est. profit this month', value: money(month.profit), icon: 'trending-up', tone: month.profit >= 0 ? 'green' : 'red', href: '#/finance', sub: `All-time revenue ${money(allTime.revenue)}` })}
    </div>

    <div class="dash-grid">
      <div class="card span-8"><div class="card-header"><h2 class="card-title">${icon('chart-column', 18)} Revenue vs expenses</h2><a class="btn btn-ghost btn-sm" href="#/reports">Reports ${icon('arrow-right', 14)}</a></div>
        <div class="card-body">${payments.length || expenses.length ? html`<div class="chart-box"><canvas id="d-rev" role="img" aria-label="Revenue and expenses over the last 6 months"></canvas></div>` : emptyState({ icon: 'chart-column', title: 'No money recorded yet', text: 'Payments and expenses will chart here.' })}</div></div>
      <div class="card span-4"><div class="card-header"><h2 class="card-title">${icon('square-kanban', 18)} Orders by stage</h2></div>
        <div class="card-body">${active.length ? html`<div class="chart-box sm"><canvas id="d-status" role="img" aria-label="Active orders by stage"></canvas></div><ul class="legend-list mt-4" id="d-legend"></ul>` : emptyState({ icon: 'clipboard-list', title: 'No active orders' })}</div></div>

      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('flag', 18)} Upcoming deadlines</h2><a class="btn btn-ghost btn-sm" href="#/calendar">Calendar ${icon('arrow-right', 14)}</a></div>
        ${deadlines.length || upcomingAppts.length ? html`<ul class="list">
          ${deadlines.map(o => html`<li><a class="list-item" href="#/orders/${o.id}"><span class="list-icon" style="${o.overdue ? 'color:var(--danger);background:var(--danger-soft)' : ''}">${icon(o.overdue ? 'triangle-alert' : 'clock', 16)}</span>
            <span class="list-main"><strong>${o.title}</strong><small>${o.customerName} · ${stageLabel(o.status)}</small></span>
            <span class="small ${o.overdue ? 'text-danger strong' : 'muted'} nowrap">${o.overdue ? `${relDays(o.dueDate)}` : relDays(o.dueDate)}</span></a></li>`)}
          ${upcomingAppts.map(a => html`<li><a class="list-item" href="#/calendar"><span class="list-icon">${icon('calendar', 16)}</span><span class="list-main"><strong>${a.title}</strong><small>${custs.get(a.customerId)?.name || 'Appointment'}</small></span><span class="small muted nowrap">${fmtDate(a.start, { weekday: 'short', day: 'numeric' })} ${new Date(a.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></a></li>`)}
        </ul>` : emptyState({ icon: 'calendar', title: 'Nothing due this week' })}</div>

      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('banknote', 18)} Recent transactions</h2><a class="btn btn-ghost btn-sm" href="#/finance?tab=payments">All ${icon('arrow-right', 14)}</a></div>
        ${recentPays.length ? html`<ul class="list">${recentPays.map(p => html`<li><a class="list-item" href="#/orders/${p.orderId}"><span class="list-icon" style="color:${p.type === 'refund' ? 'var(--danger)' : 'var(--success)'}">${icon(p.type === 'refund' ? 'undo-2' : 'banknote', 16)}</span>
          <span class="list-main"><strong>${custs.get(p.customerId)?.name || 'Customer'}</strong><small>${p.receiptNo} · ${ordersById.get(p.orderId)?.number || ''} · ${fmtDate(p.date)}</small></span>
          <span class="num strong ${p.type === 'refund' ? 'text-danger' : 'text-success'}">${p.type === 'refund' ? '−' : '+'}${money(p.amount)}</span></a></li>`)}</ul>` : emptyState({ icon: 'banknote', title: 'No payments yet' })}</div>

      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('history', 18)} Recent activity</h2></div>
        ${activity.length ? html`<ul class="list">${activity.map(a => html`<li class="list-item"><span class="list-icon">${icon(a.entity === 'customer' ? 'user' : a.entity === 'order' ? 'clipboard-list' : a.entity === 'payment' ? 'banknote' : a.entity === 'measurement' ? 'ruler' : a.entity === 'inventory' ? 'package' : 'history', 16)}</span><span class="list-main"><strong>${a.summary}</strong><small>${timeAgo(a.at)}</small></span></li>`)}</ul>` : emptyState({ icon: 'history', title: 'No activity yet' })}</div>

      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('package-minus', 18)} Low stock</h2><a class="btn btn-ghost btn-sm" href="#/inventory">Inventory ${icon('arrow-right', 14)}</a></div>
        ${low.length ? html`<ul class="list">${low.slice(0, 6).map(i => html`<li><a class="list-item" href="#/inventory/${i.id}"><span class="list-icon" style="color:var(--warning);background:var(--warning-soft)">${icon('package', 16)}</span><span class="list-main"><strong>${i.name}</strong><small>${i.category} · minimum ${i.minLevel} ${i.unit}</small></span><span class="num strong text-danger">${i.quantity} ${i.unit}</span></a></li>`)}</ul>`
          : html`${emptyState({ icon: 'package', title: inventory.length ? 'Stock levels are healthy' : 'No inventory tracked', text: inventory.length ? '' : 'Add fabrics and accessories to get low-stock alerts.' })}`}
        <div class="card-foot small ${lastBackup ? 'muted' : 'text-warning'}">${icon('hard-drive', 14)} ${lastBackup ? `Last backup ${timeAgo(lastBackup)}` : 'No backup downloaded yet'} · <a class="strong" href="#/settings?tab=data">Backup now</a></div>
      </div>
    </div>`);

  if (el.querySelector('#d-rev')) {
    const s = monthlySeries({ payments, expenses, months: 6 });
    renderBarChart(el.querySelector('#d-rev'), {
      labels: s.map(r => new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })),
      datasets: [{ label: 'Revenue', data: s.map(r => r.revenue), color: 0 }, { label: 'Expenses', data: s.map(r => r.expenses), color: 1 }, { label: 'Profit', data: s.map(r => r.profit), color: 3, type: 'line' }],
      money: true,
    });
  }
  if (el.querySelector('#d-status')) {
    const st = stages.filter(s => s.key !== stages.at(-1).key).map(s => ({ label: s.label, n: active.filter(o => o.status === s.key).length })).filter(x => x.n);
    await renderDoughnut(el.querySelector('#d-status'), { labels: st.map(x => x.label), data: st.map(x => x.n) });
    const pal = chartColors();
    el.querySelector('#d-legend').innerHTML = String(html`${st.map((x, i) => html`<li><span class="sw" style="background:${pal[i % pal.length]}"></span>${x.label}<span class="v">${x.n}</span></li>`)}`);
  }

  return delegate(el, 'click', '[data-qa]', (e, b) => runQuickAction(b.dataset.qa));
}

