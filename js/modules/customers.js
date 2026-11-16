// Customer management: list, profile, create/edit, archive, safe delete.
import { html, icon, raw, field, formModal, confirmDialog, toast, toastError, table, emptyState, pageHeader, badge, avatar, delegate, skeleton } from '../ui.js';
import { getAll, get, byIndex } from '../database.js';
import { createCustomer, updateCustomer, setCustomerArchived, deleteCustomer, DuplicateError, loadOrderViews } from '../services.js';
import { money, fmtDate, readImage, debounce, waNumber, sum, timeAgo } from '../utils.js';
import { getState, stageLabel } from '../state.js';
import { navigate } from '../router.js';
import { local } from '../storage.js';
import { orderStatusBadge, paymentBadge } from './orders.js';

export async function openCustomerForm(existing = null) {
  let photo = existing?.photo || '';
  const res = await formModal({
    title: existing ? `Edit ${existing.name}` : 'Add customer',
    submitLabel: existing ? 'Save changes' : 'Add customer',
    body: html`
      <div class="field span-2"><label>Photo (optional)</label>
        <div class="row"><div class="photo-strip" data-photo>${photo ? html`<div class="ph"><img src="${photo}" alt="Customer photo"><button type="button" data-rm-photo aria-label="Remove photo">${icon('x', 12)}</button></div>` : ''}</div>
        <label class="upload-tile" style="position:relative">${icon('camera', 18)}<span>Add</span><input type="file" accept="image/*" capture="user" data-photo-input></label></div>
      </div>
      ${field({ label: 'Full name', name: 'name', value: existing?.name, required: true, attrs: 'maxlength="100" autocomplete="off"', full: true })}
      ${field({ label: 'Phone number', name: 'phone', type: 'tel', value: existing?.phone, attrs: 'maxlength="20" pattern="[0-9+()\\s-]{7,20}"', hint: 'Used for calls and WhatsApp messages' })}
      ${field({ label: 'Email', name: 'email', type: 'email', value: existing?.email })}
      ${field({ label: 'Gender (optional)', name: 'gender', type: 'select', value: existing?.gender, options: [{ value: '', label: 'Prefer not to say' }, 'Male', 'Female', 'Child'] })}
      ${field({ label: 'Address', name: 'address', value: existing?.address })}
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, full: true, placeholder: 'Style preferences, fit notes, how they found you…' })}`,
    onOpen: (form) => {
      const strip = form.querySelector('[data-photo]');
      const paint = () => { strip.innerHTML = photo ? String(html`<div class="ph"><img src="${photo}" alt="Customer photo"><button type="button" data-rm-photo aria-label="Remove photo">${icon('x', 12)}</button></div>`) : ''; };
      form.querySelector('[data-photo-input]').addEventListener('change', async (e) => {
        try { photo = await readImage(e.target.files[0], { maxDim: 600 }); paint(); } catch (err) { toastError(err); }
      });
      strip.addEventListener('click', (e) => { if (e.target.closest('[data-rm-photo]')) { photo = ''; paint(); } });
    },
    onSubmit: async (d) => {
      const data = { name: d.name, phone: d.phone, email: d.email, gender: d.gender, address: d.address, notes: d.notes, photo };
      if (existing) return updateCustomer(existing.id, data);
      try {
        return await createCustomer(data);
      } catch (err) {
        if (err instanceof DuplicateError) {
          const go = await confirmDialog({ title: 'Possible duplicate', message: `${err.message}\n\nAdd this as a separate customer anyway?`, confirmLabel: 'Add anyway' });
          if (!go) return false;
          return createCustomer(data, { allowDuplicate: true });
        }
        throw err;
      }
    },
  });
  if (res && res !== true) toast(existing ? 'Customer updated.' : `${res.name} added (${res.code}).`, { type: 'success' });
  return res && res !== true ? res : null;
}

export async function render(el, params, query) {
  if (params.id) return renderProfile(el, params.id, query);
  return renderList(el, query);
}

async function renderList(el) {
  el.innerHTML = String(html`${pageHeader({ title: 'Customers', subtitle: 'Everyone you sew for, with their history and balances' })}<div class="card">${skeleton(6)}</div>`);
  const [customers, { orders }] = await Promise.all([getAll('customers'), loadOrderViews()]);
  const stats = new Map();
  for (const o of orders) {
    const s = stats.get(o.customerId) || { orders: 0, active: 0, balance: 0, spent: 0, last: '' };
    s.orders++;
    if (!o.cancelled && o.status !== getState().stages.at(-1).key) s.active++;
    if (!o.cancelled) s.balance += o.balance;
    s.spent += o.paid;
    if (o.orderDate > s.last) s.last = o.orderDate;
    stats.set(o.customerId, s);
  }
  const ui = { q: '', filter: local.get('custFilter', 'active'), sort: local.get('custSort', 'recent') };

  el.innerHTML = String(html`
    ${pageHeader({
      title: 'Customers', subtitle: `${customers.filter(c => !c.archived).length} active customer${customers.length === 1 ? '' : 's'}`,
      actions: html`<button class="btn btn-secondary" data-act="export">${icon('download', 16)} Export</button><button class="btn btn-primary" data-act="add">${icon('user-plus', 16)} Add customer</button>`,
    })}
    <div class="toolbar">
      <div class="search">${icon('search', 16)}<label class="sr-only" for="c-q">Search customers</label><input id="c-q" class="input" type="search" placeholder="Name, phone or code"></div>
      <label class="sr-only" for="c-filter">Filter</label>
      <select id="c-filter" class="input">
        <option value="active">Active</option><option value="balance">Owing money</option><option value="archived">Archived</option><option value="all">All</option>
      </select>
      <label class="sr-only" for="c-sort">Sort</label>
      <select id="c-sort" class="input"><option value="recent">Newest first</option><option value="name">Name A–Z</option><option value="orders">Most orders</option><option value="balance">Highest balance</option></select>
    </div>
    <div class="card" id="c-list"></div>`);

  const listEl = el.querySelector('#c-list');
  el.querySelector('#c-filter').value = ui.filter;
  el.querySelector('#c-sort').value = ui.sort;

  const paint = () => {
    const q = ui.q.toLowerCase();
    const digits = q.replace(/\D/g, '');
    let rows = customers.filter(c => {
      const s = stats.get(c.id);
      if (ui.filter === 'active' && c.archived) return false;
      if (ui.filter === 'archived' && !c.archived) return false;
      if (ui.filter === 'balance' && !(s?.balance > 0)) return false;
      if (!q) return true;
      return c.nameLower.includes(q) || c.code.toLowerCase().includes(q) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)) || (c.email || '').toLowerCase().includes(q);
    });
    const st = (c) => stats.get(c.id) || { orders: 0, balance: 0, spent: 0, active: 0, last: '' };
    rows.sort(ui.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : ui.sort === 'orders' ? (a, b) => st(b).orders - st(a).orders
        : ui.sort === 'balance' ? (a, b) => st(b).balance - st(a).balance
          : (a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!customers.length) {
      listEl.innerHTML = String(emptyState({ icon: 'users', title: 'No customers yet', text: 'Add your first customer to start recording measurements and orders.', action: html`<button class="btn btn-primary" data-act="add">${icon('user-plus', 16)} Add customer</button>` }));
      return;
    }
    if (!rows.length) { listEl.innerHTML = String(emptyState({ icon: 'search', title: 'No matching customers', text: 'Try a different name, phone number or filter.' })); return; }
    listEl.innerHTML = String(table({
      columns: [
        { label: 'Customer', cell: c => html`<div class="cell-main">${avatar(c.name, c.photo, 36)}<div class="truncate"><strong>${c.name}</strong><small>${c.code}${c.archived ? ' · archived' : ''}</small></div></div>` },
        { label: 'Phone', cell: c => c.phone || html`<span class="subtle">—</span>` },
        { label: 'Orders', cls: 'right', cell: c => html`<span class="num">${st(c).orders}</span>${st(c).active ? html` <span class="badge badge-info">${st(c).active} active</span>` : ''}` },
        { label: 'Balance', cls: 'right', cell: c => st(c).balance > 0 ? html`<span class="num text-danger strong">${money(st(c).balance)}</span>` : html`<span class="subtle">—</span>` },
        { label: 'Last order', cell: c => st(c).last ? fmtDate(st(c).last) : html`<span class="subtle">None</span>` },
        { label: '', cls: 'actions', cell: c => html`<a class="btn btn-ghost btn-sm" href="#/customers/${c.id}">View ${icon('chevron-right', 14)}</a>` },
      ],
      rows,
      rowAttrs: c => `data-href="#/customers/${c.id}"`,
    }));
  };
  paint();

  const offs = [
    delegate(el, 'click', '[data-act]', async (e, b) => {
      if (b.dataset.act === 'add') { const r = await openCustomerForm(); if (r) navigate(`/customers/${r.id}`); }
      if (b.dataset.act === 'export') {
        const { exportRows } = await import('../exports.js');
        exportRows('customers', customers.map(c => ({ Code: c.code, Name: c.name, Phone: c.phone, Email: c.email, Gender: c.gender, Address: c.address, Orders: stats.get(c.id)?.orders || 0, Balance: stats.get(c.id)?.balance || 0, Archived: c.archived ? 'Yes' : 'No', Added: c.createdAt.slice(0, 10), Notes: c.notes })));
      }
    }),
    delegate(el, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; }),
  ];
  el.querySelector('#c-q').addEventListener('input', debounce((e) => { ui.q = e.target.value.trim(); paint(); }, 120));
  el.querySelector('#c-filter').addEventListener('change', (e) => { ui.filter = e.target.value; local.set('custFilter', ui.filter); paint(); });
  el.querySelector('#c-sort').addEventListener('change', (e) => { ui.sort = e.target.value; local.set('custSort', ui.sort); paint(); });
  return () => offs.forEach(f => f());
}

async function renderProfile(el, id, query) {
  el.innerHTML = String(skeleton(8));
  const c = await get('customers', id);
  if (!c) {
    el.innerHTML = String(html`${pageHeader({ title: 'Customer not found', back: '#/customers' })}<div class="card">${emptyState({ icon: 'user', title: 'This customer does not exist', text: 'It may have been deleted, or the link is wrong.', action: html`<a class="btn btn-primary" href="#/customers">All customers</a>` })}</div>`);
    return;
  }
  const [measurements, { orders }, payments, appointments] = await Promise.all([
    byIndex('measurements', 'customerId', id), loadOrderViews(), byIndex('payments', 'customerId', id), byIndex('appointments', 'customerId', id),
  ]);
  const myOrders = orders.filter(o => o.customerId === id);
  measurements.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  payments.sort((a, b) => b.date.localeCompare(a.date));
  const balance = sum(myOrders.filter(o => !o.cancelled), o => o.balance);
  const credit = sum(myOrders, o => o.credit);
  const paid = sum(myOrders, o => o.paid);
  const tab = query.tab || 'overview';
  const orderMap = new Map(orders.map(o => [o.id, o]));
  const wa = c.phone ? `https://wa.me/${waNumber(c.phone, getState().business?.countryCode || '234')}` : '';

  el.innerHTML = String(html`
    <a class="back-link" href="#/customers">${icon('arrow-left', 16)} Customers</a>
    <div class="card card-pad mb-4">
      <div class="between" style="flex-wrap:wrap;align-items:flex-start">
        <div class="row" style="gap:16px;align-items:flex-start">
          ${avatar(c.name, c.photo, 64)}
          <div>
            <h1 class="page-title" style="font-size:1.4rem">${c.name} ${c.archived ? badge('Archived', 'neutral') : ''}</h1>
            <p class="muted small">${c.code} · customer since ${fmtDate(c.createdAt)}</p>
            <div class="row-wrap mt-2">
              ${c.phone ? html`<a class="btn btn-secondary btn-sm" href="tel:${c.phone}">${icon('phone', 14)} ${c.phone}</a>` : ''}
              ${wa ? html`<a class="btn btn-secondary btn-sm" href="${wa}" target="_blank" rel="noopener">${icon('message-square', 14)} WhatsApp</a>` : ''}
              ${c.email ? html`<a class="btn btn-secondary btn-sm" href="mailto:${c.email}">${icon('mail', 14)} Email</a>` : ''}
            </div>
          </div>
        </div>
        <div class="row-wrap">
          <a class="btn btn-secondary" href="#/measurements/new?customer=${c.id}">${icon('ruler', 16)} Measure</a>
          <a class="btn btn-primary" href="#/orders/new?customer=${c.id}">${icon('plus', 16)} New order</a>
          <button class="icon-btn" data-act="edit" aria-label="Edit customer">${icon('pencil', 18)}</button>
          <button class="icon-btn" data-act="archive" aria-label="${c.archived ? 'Restore customer' : 'Archive customer'}" title="${c.archived ? 'Restore' : 'Archive'}">${icon(c.archived ? 'archive-restore' : 'archive', 18)}</button>
          <button class="icon-btn" data-act="delete" aria-label="Delete customer" title="Delete">${icon('trash-2', 18)}</button>
        </div>
      </div>
    </div>
    <div class="stats">
      <div class="stat card"><div class="stat-icon tone-navy">${icon('clipboard-list', 20)}</div><div class="stat-body"><div class="stat-label">Orders</div><div class="stat-value">${myOrders.length}</div></div></div>
      <div class="stat card"><div class="stat-icon tone-green">${icon('banknote', 20)}</div><div class="stat-body"><div class="stat-label">Total paid</div><div class="stat-value">${money(paid)}</div></div></div>
      <div class="stat card"><div class="stat-icon tone-red">${icon('wallet', 20)}</div><div class="stat-body"><div class="stat-label">Outstanding</div><div class="stat-value">${money(balance)}</div>${credit > 0 ? html`<div class="stat-sub">Credit held: ${money(credit)}</div>` : ''}</div></div>
      <div class="stat card"><div class="stat-icon tone-gold">${icon('ruler', 20)}</div><div class="stat-body"><div class="stat-label">Measurements</div><div class="stat-value">${measurements.length}</div><div class="stat-sub">${measurements[0] ? `Last ${timeAgo(measurements[0].takenAt)}` : 'None yet'}</div></div></div>
    </div>
    <div class="tabs" role="tablist">
      ${[['overview', 'Overview'], ['measurements', 'Measurements', measurements.length], ['orders', 'Orders', myOrders.length], ['payments', 'Payments', payments.length]].map(([k, l, n]) =>
        html`<a class="tab" role="tab" aria-selected="${tab === k}" href="#/customers/${id}?tab=${k}">${l}${n !== undefined ? html`<span class="count">${n}</span>` : ''}</a>`)}
    </div>
    <section>${tab === 'overview' ? overview() : tab === 'measurements' ? measurementsTab() : tab === 'orders' ? ordersTab() : paymentsTab()}</section>`);

  function overview() {
    const upcoming = appointments.filter(a => a.start >= new Date().toISOString() && a.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start));
    return html`<div class="dash-grid">
      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('user', 18)} Details</h2></div><div class="card-body">
        <dl class="kv">
          <dt>Phone</dt><dd>${c.phone || '—'}</dd><dt>Email</dt><dd>${c.email || '—'}</dd>
          <dt>Gender</dt><dd>${c.gender || '—'}</dd><dt>Address</dt><dd>${c.address || '—'}</dd>
          <dt>Notes</dt><dd style="white-space:pre-wrap">${c.notes || '—'}</dd>
        </dl></div></div>
      <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('clipboard-list', 18)} Active orders</h2></div>
        ${myOrders.filter(o => !o.cancelled && o.status !== getState().stages.at(-1).key).length
          ? html`<ul class="list">${myOrders.filter(o => !o.cancelled && o.status !== getState().stages.at(-1).key).map(o => html`<li><a class="list-item" href="#/orders/${o.id}"><span class="list-icon">${icon('shirt', 16)}</span><span class="list-main"><strong>${o.title}</strong><small>${o.number} · due ${fmtDate(o.dueDate)}</small></span>${orderStatusBadge(o)}</a></li>`)}</ul>`
          : emptyState({ icon: 'clipboard-list', title: 'No active orders', action: html`<a class="btn btn-primary btn-sm" href="#/orders/new?customer=${c.id}">Create order</a>` })}
      </div>
      ${upcoming.length ? html`<div class="card span-12"><div class="card-header"><h2 class="card-title">${icon('calendar', 18)} Upcoming appointments</h2></div><ul class="list">${upcoming.map(a => html`<li class="list-item"><span class="list-icon">${icon('clock', 16)}</span><span class="list-main"><strong>${a.title}</strong><small>${new Date(a.start).toLocaleString()}</small></span></li>`)}</ul></div>` : ''}
    </div>`;
  }

  function measurementsTab() {
    if (!measurements.length) return html`<div class="card">${emptyState({ icon: 'ruler', title: 'No measurements yet', text: 'Take measurements with a phone-friendly, one-field-at-a-time screen.', action: html`<a class="btn btn-primary" href="#/measurements/new?customer=${c.id}">Take measurements</a>` })}</div>`;
    return html`<div class="card"><ul class="list">${measurements.map(mm => html`<li><a class="list-item" href="#/measurements/${mm.id}">
      <span class="list-icon">${icon('ruler', 16)}</span>
      <span class="list-main"><strong>${mm.templateName} · version ${mm.version}</strong><small>${fmtDate(mm.takenAt)} · ${Object.keys(mm.values).length + mm.custom.length} measurements (${mm.unit})${mm.orderId && orderMap.get(mm.orderId) ? ` · for ${orderMap.get(mm.orderId).number}` : ''}</small></span>
      ${mm === measurements.find(x => x.templateId === mm.templateId) ? badge('Latest', 'success') : badge('History', 'neutral')}
      ${icon('chevron-right', 16)}</a></li>`)}</ul></div>`;
  }

  function ordersTab() {
    if (!myOrders.length) return html`<div class="card">${emptyState({ icon: 'clipboard-list', title: 'No orders yet', action: html`<a class="btn btn-primary" href="#/orders/new?customer=${c.id}">Create order</a>` })}</div>`;
    return html`<div class="card">${table({
      columns: [
        { label: 'Order', cell: o => html`<div class="cell-main"><div><strong>${o.title}</strong><small>${o.number} · ${fmtDate(o.orderDate)}</small></div></div>` },
        { label: 'Status', cell: o => orderStatusBadge(o) },
        { label: 'Due', cell: o => o.dueDate ? html`<span class="${o.overdue ? 'text-danger strong' : ''}">${fmtDate(o.dueDate)}</span>` : '—' },
        { label: 'Total', cls: 'right', cell: o => html`<span class="num">${money(o.total)}</span>` },
        { label: 'Balance', cls: 'right', cell: o => paymentBadge(o) },
      ],
      rows: myOrders, rowAttrs: o => `data-href="#/orders/${o.id}" class="${o.overdue ? 'overdue-row' : ''}"`,
    })}</div>`;
  }

  function paymentsTab() {
    if (!payments.length) return html`<div class="card">${emptyState({ icon: 'banknote', title: 'No payments recorded' })}</div>`;
    return html`<div class="card">${table({
      columns: [
        { label: 'Receipt', cell: p => html`<strong>${p.receiptNo}</strong>` },
        { label: 'Date', cell: p => fmtDate(p.date) },
        { label: 'Order', cell: p => orderMap.get(p.orderId)?.number || '—' },
        { label: 'Type', cell: p => badge(p.type === 'refund' ? 'Refund' : p.type === 'deposit' ? 'Deposit' : 'Payment', p.type === 'refund' ? 'danger' : 'success') },
        { label: 'Method', cell: p => p.method },
        { label: 'Amount', cls: 'right', cell: p => html`<span class="num strong ${p.type === 'refund' ? 'text-danger' : ''}">${p.type === 'refund' ? '−' : ''}${money(p.amount)}</span>` },
      ],
      rows: payments,
    })}</div>`;
  }

  const off = delegate(el, 'click', '[data-act], tr[data-href]', async (e, b) => {
    if (b.matches('tr[data-href]')) { location.hash = b.dataset.href; return; }
    try {
      if (b.dataset.act === 'edit') { if (await openCustomerForm(c)) render(el, { id }, query); }
      if (b.dataset.act === 'archive') {
        await setCustomerArchived(id, !c.archived);
        toast(c.archived ? 'Customer restored.' : 'Customer archived. Their history is kept.', { type: 'success' });
        render(el, { id }, query);
      }
      if (b.dataset.act === 'delete') {
        if (myOrders.length || payments.length) {
          await confirmDialog({ title: 'Cannot delete this customer', message: `${c.name} has ${myOrders.length} order(s) and ${payments.length} payment(s). Deleting would break your financial records.\n\nArchive the customer instead — they will be hidden from lists but their history stays.`, confirmLabel: 'OK' });
          return;
        }
        const ok = await confirmDialog({ title: `Delete ${c.name}?`, message: `This permanently removes the customer and their ${measurements.length} measurement record(s). This cannot be undone.`, confirmLabel: 'Delete permanently', danger: true, requireText: 'DELETE' });
        if (!ok) return;
        await deleteCustomer(id);
        toast('Customer deleted.', { type: 'success' });
        navigate('/customers');
      }
    } catch (err) { toastError(err); }
  });
  return off;
}

