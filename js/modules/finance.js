// Payments & finance: payments, refunds, expenses, outstanding balances,
// invoices/receipts and cash-basis profit.
import { html, icon, raw, field, formModal, toast, toastError, table, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog, stat } from '../ui.js';
import { getAll, get } from '../database.js';
import { recordPayment, deletePayment, saveExpense, deleteExpense, loadOrderViews } from '../services.js';
import { financeSummary, monthlySeries } from '../core/calc.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../core/defaults.js';
import { money, fmtDate, todayISO, sum, byId } from '../utils.js';
import { getState } from '../state.js';
import { local } from '../storage.js';
import { renderBarChart } from '../charts.js';

export async function openPaymentForm(orderId = null) {
  const { orders, custs } = await loadOrderViews();
  const open = orders.filter(o => !o.cancelled);
  if (!open.length) { toast('Create an order before recording a payment.', { type: 'warning' }); return null; }
  let current = orderId ? open.find(o => o.id === orderId) : null;
  const res = await formModal({
    title: 'Record payment', submitLabel: 'Save payment',
    body: html`
      ${orderId ? html`<input type="hidden" name="orderId" value="${orderId}">` : field({ label: 'Order', name: 'orderId', type: 'select', required: true, full: true, options: [{ value: '', label: 'Choose order…' }, ...open.sort((a, b) => b.balance - a.balance).map(o => ({ value: o.id, label: `${o.number} · ${o.customerName} · ${o.balance > 0 ? `owes ${money(o.balance)}` : 'paid'}` }))] })}
      <div class="span-2 alert" data-bal ${current ? '' : raw('hidden')}></div>
      ${field({ label: 'Type', name: 'type', type: 'select', value: 'payment', options: [{ value: 'payment', label: 'Payment received' }, { value: 'refund', label: 'Refund to customer' }] })}
      ${field({ label: 'Amount', name: 'amount', type: 'number', required: true, value: current?.balance || '', attrs: 'min="0.01"' })}
      ${field({ label: 'Method', name: 'method', type: 'select', options: PAYMENT_METHODS })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ label: 'Reference', name: 'reference', placeholder: 'Transfer ref, POS slip no.' })}
      ${field({ label: 'Notes', name: 'notes' })}
      ${field({ label: 'Treat any excess as customer credit (advance payment)', name: 'allowCredit', type: 'checkbox', full: true, hint: 'Without this, payments above the outstanding balance are rejected.' })}`,
    onOpen: (form) => {
      const balEl = form.querySelector('[data-bal]');
      const show = () => {
        if (!current) { balEl.hidden = true; return; }
        balEl.hidden = false;
        balEl.innerHTML = String(html`${icon('info', 18)}<div><strong>${current.number} · ${current.customerName}</strong>Total ${money(current.total)} · paid ${money(current.paid)} · <span class="strong">${current.credit > 0 ? `credit ${money(current.credit)}` : `balance ${money(current.balance)}`}</span></div>`);
      };
      show();
      form.addEventListener('change', (e) => {
        if (e.target.name === 'orderId') { current = open.find(o => o.id === e.target.value) || null; show(); if (current) form.amount.value = current.balance || ''; }
        if (e.target.name === 'type' && current) form.amount.value = e.target.value === 'refund' ? '' : current.balance || '';
      });
    },
    onSubmit: (d) => recordPayment({ ...d, orderId: d.orderId || orderId }),
  });
  if (res && res !== true) {
    const o = open.find(x => x.id === res.orderId);
    toast(`${res.type === 'refund' ? 'Refund' : 'Payment'} ${res.receiptNo} saved.`, {
      type: 'success', timeout: 7000,
      action: { label: 'Receipt', fn: async () => (await import('../exports.js')).receiptPdf(res, o, custs.get(o.customerId)) },
    });
  }
  return res;
}

export async function openExpenseForm(existing = null) {
  const suppliers = await getAll('suppliers');
  const res = await formModal({
    title: existing ? 'Edit expense' : 'Record expense', submitLabel: 'Save expense',
    body: html`
      ${field({ label: 'Category', name: 'category', type: 'select', value: existing?.category || EXPENSE_CATEGORIES[0], options: EXPENSE_CATEGORIES, required: true })}
      ${field({ label: 'Amount', name: 'amount', type: 'number', value: existing?.amount, required: true, attrs: 'min="0.01"' })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: existing?.date || todayISO(), required: true })}
      ${field({ label: 'Supplier', name: 'supplierId', type: 'select', value: existing?.supplierId || '', options: [{ value: '', label: '—' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))] })}
      ${field({ label: 'Description', name: 'description', value: existing?.description, full: true, placeholder: 'e.g. Generator fuel, thread restock' })}`,
    onSubmit: (d) => saveExpense({ ...(existing || {}), ...d }),
  });
  if (res && res !== true) toast('Expense saved.', { type: 'success' });
  return res;
}

export async function pickOrderForInvoice() {
  const { orders, custs } = await loadOrderViews();
  const list = orders.filter(o => !o.cancelled);
  if (!list.length) { toast('No orders to invoice yet.', { type: 'warning' }); return; }
  await formModal({
    title: 'Generate invoice', submitLabel: 'Download PDF',
    body: field({ label: 'Order', name: 'orderId', type: 'select', required: true, full: true, options: list.map(o => ({ value: o.id, label: `${o.number} · ${o.customerName} · ${money(o.total)}` })) }),
    onSubmit: async (d) => {
      const o = list.find(x => x.id === d.orderId);
      await (await import('../exports.js')).invoicePdf(o, custs.get(o.customerId));
    },
  });
}

const PERIODS = {
  month: () => { const t = todayISO(); return [`${t.slice(0, 7)}-01`, t]; },
  last: () => { const d = new Date(); d.setDate(0); const e = d.toISOString().slice(0, 10); return [`${e.slice(0, 7)}-01`, e]; },
  year: () => [`${todayISO().slice(0, 4)}-01-01`, todayISO()],
  all: () => ['', ''],
};

export async function render(el, params, query) {
  el.innerHTML = String(html`${pageHeader({ title: 'Payments & Finance' })}${skeleton(6)}`);
  const [{ orders, payments, custs }, expenses, suppliers] = await Promise.all([loadOrderViews(), getAll('expenses'), getAll('suppliers')]);
  const ordersById = byId(orders);
  const supById = byId(suppliers);
  const tab = query.tab || 'overview';
  const period = local.get('finPeriod', 'month');
  const [from, to] = (PERIODS[period] || PERIODS.month)();
  const s = financeSummary({ payments, expenses, from, to });
  const outstanding = orders.filter(o => !o.cancelled && o.balance > 0);
  const outTotal = sum(outstanding, o => o.balance);

  const tabs = [['overview', 'Overview'], ['payments', 'Payments', payments.length], ['expenses', 'Expenses', expenses.length], ['outstanding', 'Outstanding', outstanding.length], ['invoices', 'Invoices']];
  el.innerHTML = String(html`
    ${pageHeader({ title: 'Payments & Finance', subtitle: 'Cash received, money spent, and what customers still owe',
      actions: html`<button class="btn btn-secondary" data-act="expense">${icon('receipt', 16)} Add expense</button><button class="btn btn-primary" data-act="pay">${icon('banknote', 16)} Record payment</button>` })}
    <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => html`<a class="tab" role="tab" href="#/finance?tab=${k}" aria-selected="${tab === k}">${l}${n !== undefined ? html`<span class="count">${n}</span>` : ''}</a>`)}</div>
    <section id="fin-body">${tab === 'overview' ? overview() : tab === 'payments' ? paymentsTab() : tab === 'expenses' ? expensesTab() : tab === 'outstanding' ? outstandingTab() : invoicesTab()}</section>`);

  function overview() {
    return html`
      <div class="toolbar"><label class="small muted" for="fin-period">Period</label><select id="fin-period" class="input">
        ${[['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => html`<option value="${k}" ${k === period ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="stats">
        ${stat({ label: 'Revenue received', value: money(s.revenue), icon: 'trending-up', tone: 'green', sub: s.refunds ? `after ${money(s.refunds)} refunds` : 'cash collected' })}
        ${stat({ label: 'Expenses', value: money(s.expenses), icon: 'trending-down', tone: 'amber' })}
        ${stat({ label: 'Estimated profit', value: money(s.profit), icon: 'circle-dollar-sign', tone: s.profit >= 0 ? 'navy' : 'red', sub: 'revenue − expenses' })}
        ${stat({ label: 'Outstanding', value: money(outTotal), icon: 'wallet', tone: 'red', sub: `${outstanding.length} order(s)`, href: '#/finance?tab=outstanding' })}
      </div>
      <div class="alert mb-4">${icon('info', 18)}<div>Revenue is money actually received (cash basis). Profit here is an estimate: revenue minus recorded expenses. It does not include your own time or unrecorded costs.</div></div>
      <div class="card"><div class="card-header"><h2 class="card-title">${icon('chart-column', 18)} Last 6 months</h2></div><div class="card-body"><div class="chart-box"><canvas id="fin-chart" aria-label="Revenue and expenses by month" role="img"></canvas></div></div></div>`;
  }

  function paymentsTab() {
    const rows = [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    if (!rows.length) return html`<div class="card">${emptyState({ icon: 'banknote', title: 'No payments yet', text: 'Deposits and payments you record on orders appear here.' })}</div>`;
    return html`<div class="row mb-3"><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-act="export-payments">${icon('download', 14)} Export</button></div><div class="card">${table({
      columns: [
        { label: 'Receipt', cell: p => html`<div class="cell-main"><div><strong>${p.receiptNo}</strong><small>${fmtDate(p.date)}</small></div></div>` },
        { label: 'Customer', cell: p => custs.get(p.customerId)?.name || '—' },
        { label: 'Order', cell: p => ordersById.get(p.orderId) ? html`<a href="#/orders/${p.orderId}">${ordersById.get(p.orderId).number}</a>` : '—' },
        { label: 'Type', cell: p => badge(p.type === 'refund' ? 'Refund' : p.type === 'deposit' ? 'Deposit' : 'Payment', p.type === 'refund' ? 'danger' : 'success') },
        { label: 'Method', cell: p => p.method },
        { label: 'Amount', cls: 'right', cell: p => html`<span class="num strong ${p.type === 'refund' ? 'text-danger' : ''}">${p.type === 'refund' ? '−' : ''}${money(p.amount)}</span>` },
        { label: '', cls: 'actions', cell: p => html`<button class="icon-btn sm" data-receipt="${p.id}" aria-label="Receipt PDF" title="Receipt">${icon('download', 16)}</button><button class="icon-btn sm" data-del-pay="${p.id}" aria-label="Delete payment" title="Delete">${icon('trash-2', 16)}</button>` },
      ], rows,
    })}</div>`;
  }

  function expensesTab() {
    const rows = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
    if (!rows.length) return html`<div class="card">${emptyState({ icon: 'receipt', title: 'No expenses recorded', text: 'Track rent, wages, fuel and material purchases so your profit estimate is realistic.', action: html`<button class="btn btn-primary" data-act="expense">Add expense</button>` })}</div>`;
    return html`<div class="row mb-3"><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-act="export-expenses">${icon('download', 14)} Export</button></div><div class="card">${table({
      columns: [
        { label: 'Expense', cell: e => html`<div class="cell-main"><div><strong>${e.description || e.category}</strong><small>${fmtDate(e.date)}</small></div></div>` },
        { label: 'Category', cell: e => badge(e.category, 'neutral') },
        { label: 'Supplier', cell: e => supById.get(e.supplierId)?.name || '—' },
        { label: 'Amount', cls: 'right', cell: e => html`<span class="num strong">${money(e.amount)}</span>` },
        { label: '', cls: 'actions', cell: e => html`<button class="icon-btn sm" data-edit-exp="${e.id}" aria-label="Edit expense">${icon('pencil', 16)}</button><button class="icon-btn sm" data-del-exp="${e.id}" aria-label="Delete expense">${icon('trash-2', 16)}</button>` },
      ], rows,
    })}</div>`;
  }

  function outstandingTab() {
    if (!outstanding.length) return html`<div class="card">${emptyState({ icon: 'circle-check', title: 'Nobody owes you money', text: 'All active orders are fully paid.' })}</div>`;
    return html`<div class="card">${table({
      columns: [
        { label: 'Order', cell: o => html`<div class="cell-main"><div><strong>${o.customerName}</strong><small>${o.number} · ${o.title}</small></div></div>` },
        { label: 'Total', cls: 'right', cell: o => html`<span class="num">${money(o.total)}</span>` },
        { label: 'Paid', cls: 'right', cell: o => html`<span class="num text-success">${money(o.paid)}</span>` },
        { label: 'Balance', cls: 'right', cell: o => html`<span class="num strong text-danger">${money(o.balance)}</span>` },
        { label: '', cls: 'actions', cell: o => html`<button class="btn btn-ghost btn-sm" data-remind="${o.id}">${icon('message-square', 14)} Remind</button><button class="btn btn-secondary btn-sm" data-pay-order="${o.id}">${icon('banknote', 14)} Pay</button>` },
      ], rows: outstanding.sort((a, b) => b.balance - a.balance),
    })}<div class="card-foot between"><span class="muted small">${outstanding.length} order(s)</span><strong class="num">${money(outTotal)}</strong></div></div>`;
  }

  function invoicesTab() {
    const rows = orders.filter(o => !o.cancelled);
    if (!rows.length) return html`<div class="card">${emptyState({ icon: 'file-text', title: 'No orders to invoice' })}</div>`;
    return html`<div class="card">${table({
      columns: [
        { label: 'Invoice', cell: o => html`<div class="cell-main"><div><strong>INV-${o.number.replace('ORD-', '')}</strong><small>${fmtDate(o.orderDate)}</small></div></div>` },
        { label: 'Customer', cell: o => o.customerName },
        { label: 'Total', cls: 'right', cell: o => html`<span class="num">${money(o.total)}</span>` },
        { label: 'Status', cell: o => o.balance > 0 ? badge(o.paid > 0 ? 'Part-paid' : 'Unpaid', o.paid > 0 ? 'warning' : 'danger') : badge('Paid', 'success') },
        { label: '', cls: 'actions', cell: o => html`<button class="btn btn-secondary btn-sm" data-invoice="${o.id}">${icon('download', 14)} PDF</button>` },
      ], rows,
    })}</div>`;
  }

  if (tab === 'overview') {
    const series = monthlySeries({ payments, expenses, months: 6 });
    renderBarChart(el.querySelector('#fin-chart'), {
      labels: series.map(r => new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })),
      datasets: [{ label: 'Revenue', data: series.map(r => r.revenue), color: 2 }, { label: 'Expenses', data: series.map(r => r.expenses), color: 1 }, { label: 'Profit', data: series.map(r => r.profit), color: 0, type: 'line' }],
      money: true,
    });
  }

  const reload = () => render(el, params, query);
  const ex = () => import('../exports.js');
  const offPeriod = delegate(el, 'change', '#fin-period', (e, s) => { local.set('finPeriod', s.value); reload(); });
  const offClick = delegate(el, 'click', '[data-act],[data-receipt],[data-del-pay],[data-edit-exp],[data-del-exp],[data-pay-order],[data-remind],[data-invoice]', async (e, b) => {
    try {
      const d = b.dataset;
      if (d.act === 'pay') { if (await openPaymentForm()) reload(); }
      else if (d.act === 'expense') { if (await openExpenseForm()) reload(); }
      else if (d.act === 'export-payments') (await ex()).exportRows('payments', payments.map(p => ({ Receipt: p.receiptNo, Date: p.date, Customer: custs.get(p.customerId)?.name || '', Order: ordersById.get(p.orderId)?.number || '', Type: p.type, Method: p.method, Amount: p.type === 'refund' ? -p.amount : p.amount, Reference: p.reference })));
      else if (d.act === 'export-expenses') (await ex()).exportRows('expenses', expenses.map(x => ({ Date: x.date, Category: x.category, Description: x.description, Supplier: supById.get(x.supplierId)?.name || '', Amount: x.amount })));
      else if (d.receipt) { const p = payments.find(x => x.id === d.receipt); const o = ordersById.get(p.orderId); (await ex()).receiptPdf(p, o, custs.get(p.customerId)); }
      else if (d.delPay) {
        const p = payments.find(x => x.id === d.delPay);
        if (!(await confirmDialog({ title: `Delete ${p.receiptNo}?`, message: `This removes a ${money(p.amount)} ${p.type} from your records and changes the order balance. To return money to a customer, record a refund instead.`, confirmLabel: 'Delete payment', danger: true, requireText: 'DELETE' }))) return;
        await deletePayment(p.id); toast('Payment deleted.', { type: 'success' }); reload();
      }
      else if (d.editExp) { if (await openExpenseForm(expenses.find(x => x.id === d.editExp))) reload(); }
      else if (d.delExp) {
        if (!(await confirmDialog({ title: 'Delete expense?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        await deleteExpense(d.delExp); toast('Expense deleted.', { type: 'success' }); reload();
      }
      else if (d.payOrder) { if (await openPaymentForm(d.payOrder)) reload(); }
      else if (d.remind) { const o = ordersById.get(d.remind); (await import('./notifications.js')).composeMessage({ order: o, templateKey: 'payment_reminder' }); }
      else if (d.invoice) { const o = ordersById.get(d.invoice); (await ex()).invoicePdf(o, custs.get(o.customerId)); }
    } catch (err) { toastError(err); }
  });
  return () => { offPeriod(); offClick(); };
}
