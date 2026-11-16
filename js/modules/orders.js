// Orders: list with filters, full create/edit form, and detail with
// production stages, payments, fabric and photos.
import { html, icon, raw, field, toast, toastError, table, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog, formModal, validateForm, readForm, openModal } from '../ui.js';
import { getAll, get, byIndex } from '../database.js';
import { createOrder, updateOrder, changeStage, setOrderCancelled, deleteOrder, loadOrderViews, moveStock, addProductionNote, logFabricUsage } from '../services.js';
import { orderTotal, stageProgress, round } from '../core/calc.js';
import { estimateFabric } from '../core/fabric-engine.js';
import { GARMENT_CATEGORIES, FABRIC_TYPES } from '../core/defaults.js';
import { money, fmtDate, fmtDateTime, todayISO, addDays, debounce, readImage, relDays, timeAgo } from '../utils.js';
import { getState, stageLabel, stageIndex, staffName } from '../state.js';
import { navigate } from '../router.js';
import { local } from '../storage.js';

// ---------- Shared badges ----------
export function orderStatusBadge(o) {
  if (o.cancelled) return badge('Cancelled', 'neutral');
  const last = getState().stages.at(-1).key;
  if (o.status === last) return badge(stageLabel(o.status), 'success');
  if (o.status === 'ready') return badge(stageLabel(o.status), 'gold');
  if (o.overdue) return badge(`${stageLabel(o.status)} · overdue`, 'danger');
  return badge(stageLabel(o.status), 'info');
}
export function paymentBadge(o) {
  if (o.credit > 0) return html`<span class="badge badge-info">Credit ${money(o.credit)}</span>`;
  if (o.balance <= 0) return o.total > 0 ? badge('Paid', 'success') : badge('No price', 'neutral');
  return html`<span class="num strong text-danger">${money(o.balance)}</span>`;
}

export async function render(el, params, query) {
  const h = location.hash;
  if (h.startsWith('#/orders/new')) return renderForm(el, null, query);
  if (params.id && h.includes('/edit')) return renderForm(el, params.id, query);
  if (params.id) return renderDetail(el, params.id);
  return renderList(el, query);
}

// ---------- List ----------
async function renderList(el, query) {
  el.innerHTML = String(html`${pageHeader({ title: 'Orders' })}<div class="card">${skeleton(6)}</div>`);
  const { orders } = await loadOrderViews();
  const last = getState().stages.at(-1).key;
  const ui = { view: query.view || local.get('orderView', 'active'), q: '', worker: '', from: '', to: '' };
  const counts = {
    active: orders.filter(o => !o.cancelled && o.status !== last).length,
    overdue: orders.filter(o => o.overdue).length,
    ready: orders.filter(o => !o.cancelled && o.status === 'ready').length,
    unpaid: orders.filter(o => !o.cancelled && o.balance > 0).length,
    delivered: orders.filter(o => !o.cancelled && o.status === last).length,
    cancelled: orders.filter(o => o.cancelled).length,
    all: orders.length,
  };
  const views = [['active', 'Active'], ['overdue', 'Overdue'], ['ready', 'Ready'], ['unpaid', 'Owing'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']];
  el.innerHTML = String(html`
    ${pageHeader({ title: 'Orders', subtitle: `${counts.active} active · ${counts.overdue} overdue`, actions: html`<button class="btn btn-secondary" data-act="export">${icon('download', 16)} Export</button><a class="btn btn-primary" href="#/orders/new">${icon('plus', 16)} New order</a>` })}
    <div class="tabs" role="tablist">${views.map(([k, l]) => html`<button class="tab" role="tab" data-view="${k}" aria-selected="${ui.view === k}">${l}<span class="count">${counts[k]}</span></button>`)}</div>
    <div class="toolbar">
      <div class="search">${icon('search', 16)}<label class="sr-only" for="o-q">Search orders</label><input id="o-q" class="input" type="search" placeholder="Order no., garment or customer"></div>
      ${getState().staff.length ? html`<label class="sr-only" for="o-w">Assigned to</label><select id="o-w" class="input"><option value="">Everyone</option>${getState().staff.map(s => html`<option value="${s.id}">${s.name}</option>`)}<option value="none">Unassigned</option></select>` : ''}
      <label class="small muted" for="o-from">From</label><input id="o-from" class="input" type="date">
      <label class="small muted" for="o-to">To</label><input id="o-to" class="input" type="date">
    </div>
    <div class="card" id="o-list"></div>`);
  const listEl = el.querySelector('#o-list');
  const paint = () => {
    const q = ui.q.toLowerCase();
    const rows = orders.filter(o => {
      const v = ui.view;
      if (v === 'active' && (o.cancelled || o.status === last)) return false;
      if (v === 'overdue' && !o.overdue) return false;
      if (v === 'ready' && (o.cancelled || o.status !== 'ready')) return false;
      if (v === 'unpaid' && (o.cancelled || !(o.balance > 0))) return false;
      if (v === 'delivered' && (o.cancelled || o.status !== last)) return false;
      if (v === 'cancelled' && !o.cancelled) return false;
      if (ui.worker === 'none' && o.assignedTo) return false;
      if (ui.worker && ui.worker !== 'none' && o.assignedTo !== ui.worker) return false;
      if (ui.from && o.orderDate < ui.from) return false;
      if (ui.to && o.orderDate > ui.to) return false;
      return !q || o.number.toLowerCase().includes(q) || o.title.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q);
    });
    if (ui.view === 'active' || ui.view === 'overdue') rows.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    if (!orders.length) { listEl.innerHTML = String(emptyState({ icon: 'clipboard-list', title: 'No orders yet', text: 'Create an order to track production, payments and delivery.', action: html`<a class="btn btn-primary" href="#/orders/new">${icon('plus', 16)} New order</a>` })); return; }
    if (!rows.length) { listEl.innerHTML = String(emptyState({ icon: 'search', title: 'No orders match', text: 'Try another tab or clear the filters.' })); return; }
    const stages = getState().stages;
    listEl.innerHTML = String(table({
      columns: [
        { label: 'Order', cell: o => html`<div class="cell-main"><div class="truncate"><strong>${o.title}</strong><small>${o.number} · ${o.customerName}</small></div></div>` },
        { label: 'Status', cell: o => html`<div class="stack-sm" style="min-width:140px">${orderStatusBadge(o)}<div class="progress" aria-hidden="true"><span style="width:${o.cancelled ? 0 : stageProgress(o.status, stages)}%"></span></div></div>` },
        { label: 'Due', cell: o => o.dueDate ? html`<span class="${o.overdue ? 'text-danger strong' : ''}">${fmtDate(o.dueDate)}</span><br><small class="subtle">${o.status === last || o.cancelled ? '' : relDays(o.dueDate)}</small>` : html`<span class="subtle">—</span>` },
        { label: 'Assigned', cell: o => staffName(o.assignedTo) || html`<span class="subtle">—</span>` },
        { label: 'Total', cls: 'right', cell: o => html`<span class="num">${money(o.total)}</span>` },
        { label: 'Balance', cls: 'right', cell: o => paymentBadge(o) },
      ],
      rows, rowAttrs: o => `data-href="#/orders/${o.id}" class="${o.overdue ? 'overdue-row' : ''}"`,
    }));
  };
  paint();
  const bind = (sel, key, ev = 'input') => el.querySelector(sel)?.addEventListener(ev, debounce((e) => { ui[key] = e.target.value; paint(); }, 100));
  bind('#o-q', 'q'); bind('#o-w', 'worker', 'change'); bind('#o-from', 'from', 'change'); bind('#o-to', 'to', 'change');
  return delegate(el, 'click', '[data-view], tr[data-href], [data-act]', async (e, b) => {
    if (b.dataset.view) {
      ui.view = b.dataset.view; local.set('orderView', ui.view);
      el.querySelectorAll('[data-view]').forEach(t => t.setAttribute('aria-selected', t.dataset.view === ui.view));
      paint();
    } else if (b.dataset.href && !e.target.closest('a')) location.hash = b.dataset.href;
    else if (b.dataset.act === 'export') {
      const { exportRows } = await import('../exports.js');
      exportRows('orders', orders.map(o => ({ Number: o.number, Customer: o.customerName, Garment: o.title, Category: o.garmentCategory, Status: o.cancelled ? 'Cancelled' : stageLabel(o.status), 'Order date': o.orderDate, 'Due date': o.dueDate, 'Assigned to': staffName(o.assignedTo), Total: o.total, Paid: o.paid, Balance: o.balance, Overdue: o.overdue ? 'Yes' : 'No' })));
    }
  });
}

// ---------- Create / edit ----------
async function renderForm(el, id, query) {
  el.innerHTML = String(skeleton(8));
  const [customers, designs, inventory, existing] = await Promise.all([getAll('customers'), getAll('designs'), getAll('inventory'), id ? get('orders', id) : null]);
  if (id && !existing) { el.innerHTML = String(emptyState({ icon: 'clipboard-list', title: 'Order not found' })); return; }
  const items = existing ? await byIndex('orderItems', 'orderId', id) : [];
  const active = customers.filter(c => !c.archived || c.id === existing?.customerId).sort((a, b) => a.name.localeCompare(b.name));
  const fabrics = inventory.filter(i => i.category === 'Fabric');
  const stages = getState().stages;
  const biz = getState().business || {};
  const st = {
    customerId: existing?.customerId || query.customer || '',
    items: items.length ? items.map(i => ({ description: i.description, qty: i.qty, unitPrice: i.unitPrice })) : [{ description: '', qty: 1, unitPrice: '' }],
    photos: existing?.photos ? [...existing.photos] : [],
    measurements: [],
  };
  const design = query.design ? designs.find(d => d.id === query.design) : null;
  if (design && !items.length) st.items[0].description = design.name;

  const loadMeasurements = async () => {
    st.measurements = st.customerId ? (await byIndex('measurements', 'customerId', st.customerId)).sort((a, b) => b.takenAt.localeCompare(a.takenAt)) : [];
  };
  await loadMeasurements();

  const v = (k, d = '') => existing?.[k] ?? d;
  el.innerHTML = String(html`
    ${pageHeader({ title: existing ? `Edit ${existing.number}` : 'New order', back: existing ? `#/orders/${id}` : '#/orders' })}
    <form id="oform" class="stack-lg" novalidate>
      <div class="form-alert" role="alert" hidden></div>
      <div class="card"><div class="card-header"><h2 class="card-title">${icon('user', 18)} Customer &amp; garment</h2></div><div class="card-body"><div class="form">
        <div class="field span-2">
          <label for="o-cust">Customer<span class="req">*</span></label>
          <div class="row"><select id="o-cust" name="customerId" class="input" required ${existing ? raw('disabled') : ''}>
            <option value="">Choose a customer…</option>${active.map(c => html`<option value="${c.id}" ${c.id === st.customerId ? raw('selected') : ''}>${c.name}${c.phone ? ` · ${c.phone}` : ''}</option>`)}</select>
            ${existing ? '' : html`<button type="button" class="btn btn-secondary" data-act="new-customer" aria-label="New customer">${icon('user-plus', 16)}<span class="hide-sm">New</span></button>`}
          </div><p class="field-error"></p>
        </div>
        ${field({ label: 'Garment category', name: 'garmentCategory', type: 'select', value: v('garmentCategory', design?.category || ''), options: [{ value: '', label: 'Choose…' }, ...GARMENT_CATEGORIES] })}
        ${field({ label: 'Design / style', name: 'designId', type: 'select', value: v('designId', design?.id || ''), options: [{ value: '', label: 'No saved design' }, ...designs.map(d => ({ value: d.id, label: `${d.name} (${d.category})` }))] })}
        ${field({ label: 'Order title', name: 'title', value: v('title', design?.name || ''), required: true, placeholder: 'e.g. Senator 2-piece for wedding', attrs: 'maxlength="120"', full: true })}
        <div class="field span-2" id="meas-field"></div>
      </div></div></div>

      <div class="card"><div class="card-header"><h2 class="card-title">${icon('receipt', 18)} Items &amp; price</h2></div><div class="card-body">
        <div class="items-editor" id="items"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="add-item">${icon('plus', 14)} Add item</button>
        <div class="form mt-4">
          ${field({ label: 'Discount', name: 'discount', type: 'number', value: v('discount', ''), attrs: 'min="0"' })}
          ${existing ? '' : html`${field({ label: 'Deposit received now', name: 'deposit', type: 'number', attrs: 'min="0"', hint: 'Recorded as a payment with a receipt' })}
            ${field({ label: 'Deposit method', name: 'depositMethod', type: 'select', options: ['Cash', 'Bank transfer', 'Card / POS', 'Other'] })}`}
        </div>
        <div class="items-total" id="totals"></div>
      </div></div>

      <div class="card"><div class="card-header"><h2 class="card-title">${icon('calendar', 18)} Schedule &amp; workflow</h2></div><div class="card-body"><div class="form">
        ${field({ label: 'Order date', name: 'orderDate', type: 'date', value: v('orderDate', todayISO()), required: true })}
        ${field({ label: 'Expected delivery date', name: 'dueDate', type: 'date', value: v('dueDate', design?.productionDays ? addDays(todayISO(), design.productionDays) : addDays(todayISO(), 14)), required: true })}
        ${field({ label: 'Assigned tailor', name: 'assignedTo', type: 'select', value: v('assignedTo', ''), options: [{ value: '', label: 'Unassigned' }, ...getState().staff.filter(s => s.active !== false).map(s => ({ value: s.id, label: s.name }))], hint: getState().staff.length ? '' : 'Add workers in Settings → Staff' })}
        ${existing ? '' : field({ label: 'Starting stage', name: 'status', type: 'select', value: stages[0].key, options: stages.map(s => ({ value: s.key, label: s.label })) })}
      </div></div></div>

      <div class="card"><div class="card-header"><h2 class="card-title">${icon('layers', 18)} Fabric</h2></div><div class="card-body"><div class="form">
        ${field({ label: 'Fabric type', name: 'fabricType', type: 'select', value: v('fabricType', ''), options: [{ value: '', label: 'Not specified' }, ...FABRIC_TYPES] })}
        ${field({ label: 'Use fabric from inventory', name: 'fabricItemId', type: 'select', value: v('fabricItemId', ''), options: [{ value: '', label: 'Customer brings fabric / not tracked' }, ...fabrics.map(f => ({ value: f.id, label: `${f.name} (${f.quantity} ${f.unit} in stock)` }))] })}
        ${field({ label: 'Fabric quantity', name: 'fabricQty', type: 'number', value: v('fabricQty', ''), attrs: 'min="0"' })}
        ${field({ label: 'Unit', name: 'fabricUnit', type: 'select', value: v('fabricUnit', biz.fabricUnit || 'yards'), options: ['yards', 'metres'] })}
        <div class="span-2 row-wrap"><label class="sr-only" for="est-rule">Estimate rule</label><select id="est-rule" class="input" style="max-width:280px"><option value="">Estimate from measurements…</option>${getState().fabricRules.map(r => html`<option value="${r.id}">${r.garment}</option>`)}</select><span class="small muted" id="est-out"></span></div>
      </div></div></div>

      <div class="card"><div class="card-header"><h2 class="card-title">${icon('image', 18)} Reference photos &amp; notes</h2></div><div class="card-body stack">
        <div class="row-wrap"><div class="photo-strip" id="photos"></div><label class="upload-tile" style="position:relative">${icon('camera', 18)}<span>Add photo</span><input type="file" accept="image/*" multiple data-photo-input></label></div>
        ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: v('notes', ''), placeholder: 'Style details, embroidery, lining, buttons, fitting dates…' })}
      </div></div>

      <div class="row" style="justify-content:flex-end;gap:8px"><a class="btn btn-ghost" href="${existing ? `#/orders/${id}` : '#/orders'}">Cancel</a><button type="submit" class="btn btn-primary btn-lg">${icon('save', 18)} ${existing ? 'Save changes' : 'Create order'}</button></div>
    </form>`);

  const form = el.querySelector('#oform');
  const paintItems = () => {
    el.querySelector('#items').innerHTML = String(html`${st.items.map((it, i) => html`<div class="item-row" data-i="${i}">
      <label class="sr-only" for="it-d-${i}">Description</label><input id="it-d-${i}" class="input" data-f="description" placeholder="e.g. Agbada sewing" value="${it.description}" ${i === 0 ? raw('required') : ''}>
      <label class="sr-only" for="it-q-${i}">Quantity</label><input id="it-q-${i}" class="input" data-f="qty" type="number" min="1" step="1" inputmode="numeric" value="${it.qty}" title="Quantity">
      <label class="sr-only" for="it-p-${i}">Unit price</label><input id="it-p-${i}" class="input price" data-f="unitPrice" type="number" min="0" step="any" inputmode="decimal" placeholder="Price" value="${it.unitPrice}">
      <button type="button" class="icon-btn" data-rm-item aria-label="Remove item" ${st.items.length === 1 ? raw('disabled') : ''}>${icon('trash-2', 16)}</button></div>`)}`);
    paintTotals();
  };
  const paintTotals = () => {
    const disc = Number(form.discount.value) || 0;
    const total = orderTotal(st.items.map(i => ({ qty: Number(i.qty) || 0, unitPrice: Number(i.unitPrice) || 0 })), disc);
    const dep = form.deposit ? Number(form.deposit.value) || 0 : 0;
    el.querySelector('#totals').innerHTML = String(html`<span class="muted">Total <strong class="num" style="color:var(--text)">${money(total)}</strong></span>${form.deposit ? html`<span class="muted">Balance after deposit <strong class="num ${total - dep < 0 ? 'text-danger' : ''}" style="color:var(--text)">${money(total - dep)}</strong></span>` : ''}`);
  };
  const paintPhotos = () => {
    el.querySelector('#photos').innerHTML = String(html`${st.photos.map((p, i) => html`<div class="ph"><img src="${p}" alt="Reference ${i + 1}"><button type="button" data-rm-photo="${i}" aria-label="Remove photo">${icon('x', 12)}</button></div>`)}`);
  };
  const paintMeasurements = () => {
    const sel = existing?.measurementId || query.measurement || st.measurements[0]?.id || '';
    el.querySelector('#meas-field').innerHTML = String(st.customerId ? html`<label for="o-meas">Measurements</label>
      <div class="row"><select id="o-meas" name="measurementId" class="input"><option value="">None</option>${st.measurements.map(m => html`<option value="${m.id}" ${m.id === sel ? raw('selected') : ''}>${m.templateName} v${m.version} · ${fmtDate(m.takenAt)}</option>`)}</select>
      <a class="btn btn-secondary" href="#/measurements/new?customer=${st.customerId}">${icon('ruler', 16)}<span class="hide-sm">Measure</span></a></div>
      ${st.measurements.length ? '' : html`<p class="field-hint">No measurements for this customer yet.</p>`}` : '');
  };
  const syncItems = () => {
    el.querySelectorAll('.item-row').forEach(row => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-f]').forEach(inp => { st.items[i][inp.dataset.f] = inp.value; });
    });
  };
  paintItems(); paintPhotos(); paintMeasurements();

  const onInput = (e) => {
    if (e.target.closest('.item-row') || e.target.name === 'discount' || e.target.name === 'deposit') { syncItems(); paintTotals(); }
  };
  const onChange = async (e) => {
    if (e.target.name === 'customerId') { st.customerId = e.target.value; await loadMeasurements(); paintMeasurements(); }
    if (e.target.name === 'designId' && e.target.value) {
      const d = designs.find(x => x.id === e.target.value);
      if (d) {
        if (!form.title.value) form.title.value = d.name;
        if (!form.garmentCategory.value) form.garmentCategory.value = d.category;
        if (d.fabricYards && !form.fabricQty.value) form.fabricQty.value = d.fabricYards;
        if (!existing && d.productionDays) form.dueDate.value = addDays(form.orderDate.value || todayISO(), d.productionDays);
      }
    }
    if (e.target.matches('[data-photo-input]')) {
      for (const f of e.target.files) {
        try { st.photos.push(await readImage(f)); } catch (err) { toastError(err); }
      }
      e.target.value = '';
      paintPhotos();
    }
    if (e.target.id === 'est-rule' && e.target.value) {
      const rule = getState().fabricRules.find(r => r.id === e.target.value);
      const mId = form.measurementId?.value;
      const m = st.measurements.find(x => x.id === mId);
      const unitOut = form.fabricUnit.value === 'metres' ? 'm' : 'yd';
      const r = estimateFabric(rule, { measurements: m?.values || {}, unit: m?.unit || 'cm', outputUnit: unitOut });
      form.fabricQty.value = r.quantity;
      el.querySelector('#est-out').textContent = `Estimate: ${r.quantity} ${form.fabricUnit.value}${r.usedFallback ? ' (typical size — measurements missing)' : ''}. Adjust to your cutting layout.`;
    }
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);

  const off = delegate(el, 'click', '[data-act], [data-rm-item], [data-rm-photo]', async (e, b) => {
    if (b.dataset.act === 'add-item') { syncItems(); st.items.push({ description: '', qty: 1, unitPrice: '' }); paintItems(); el.querySelector(`#it-d-${st.items.length - 1}`).focus(); }
    else if (b.hasAttribute('data-rm-item')) { syncItems(); st.items.splice(Number(b.closest('.item-row').dataset.i), 1); paintItems(); }
    else if (b.dataset.rmPhoto !== undefined) { st.photos.splice(Number(b.dataset.rmPhoto), 1); paintPhotos(); }
    else if (b.dataset.act === 'new-customer') {
      const c = await (await import('./customers.js')).openCustomerForm();
      if (c) {
        const sel = form.customerId;
        sel.add(new Option(`${c.name}${c.phone ? ` · ${c.phone}` : ''}`, c.id, true, true));
        st.customerId = c.id; await loadMeasurements(); paintMeasurements();
      }
    }
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    syncItems();
    const alertEl = form.querySelector('.form-alert');
    alertEl.hidden = true;
    if (!validateForm(form)) return;
    const d = readForm(form);
    if (d.dueDate && d.orderDate && d.dueDate < d.orderDate) { alertEl.textContent = 'Delivery date cannot be before the order date.'; alertEl.hidden = false; return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const payload = { ...d, customerId: existing?.customerId || st.customerId, items: st.items, photos: st.photos };
      const rec = existing ? await updateOrder(id, payload) : await createOrder(payload);
      toast(existing ? 'Order updated.' : `Order ${rec.number} created.`, { type: 'success' });
      navigate(`/orders/${rec.id}`);
    } catch (err) {
      alertEl.textContent = err.message; alertEl.hidden = false; alertEl.scrollIntoView({ block: 'center' });
      btn.disabled = false; btn.classList.remove('loading');
    }
  };
  form.addEventListener('submit', onSubmit);
  return () => off();
}

// ---------- Detail ----------
async function renderDetail(el, id) {
  el.innerHTML = String(skeleton(8));
  const { orders } = await loadOrderViews();
  const o = orders.find(x => x.id === id);
  if (!o) { el.innerHTML = String(html`${pageHeader({ title: 'Order not found', back: '#/orders' })}<div class="card">${emptyState({ icon: 'clipboard-list', title: 'This order does not exist', action: html`<a class="btn btn-primary" href="#/orders">All orders</a>` })}</div>`); return; }
  const [customer, design, measurement, tasks, fabricItem, stockMoves] = await Promise.all([
    get('customers', o.customerId), o.designId ? get('designs', o.designId) : null, o.measurementId ? get('measurements', o.measurementId) : null,
    byIndex('productionTasks', 'orderId', id), o.fabricItemId ? get('inventory', o.fabricItemId) : null, byIndex('inventoryTransactions', 'orderId', id),
  ]);
  tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const stages = getState().stages;
  const idx = stageIndex(o.status);
  const next = stages[idx + 1];
  const payments = [...o.payments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  el.innerHTML = String(html`
    <a class="back-link" href="#/orders">${icon('arrow-left', 16)} Orders</a>
    <header class="page-header">
      <div class="page-title-wrap">
        <h1 class="page-title">${o.title}</h1>
        <p class="page-subtitle">${o.number} · ${customer ? html`<a href="#/customers/${customer.id}" class="strong">${customer.name}</a>` : 'Unknown customer'} · ordered ${fmtDate(o.orderDate)}</p>
        <div class="row-wrap mt-2">${orderStatusBadge(o)} ${o.overdue ? badge(`Due ${fmtDate(o.dueDate)}`, 'danger') : o.dueDate ? badge(`Due ${fmtDate(o.dueDate)}`, 'neutral') : ''} ${o.assignedTo ? badge(staffName(o.assignedTo), 'gold') : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-act="invoice">${icon('file-text', 16)} Invoice</button>
        <button class="btn btn-secondary" data-act="message">${icon('message-square', 16)} Message</button>
        <a class="btn btn-secondary" href="#/orders/${id}/edit">${icon('pencil', 16)} Edit</a>
        <button class="icon-btn" data-act="more" aria-label="More actions" aria-haspopup="dialog">${icon('ellipsis', 20)}</button>
      </div>
    </header>

    ${o.cancelled ? html`<div class="alert alert-warn mb-4">${icon('circle-alert', 18)}<div><strong>This order is cancelled.</strong>${o.cancelReason || ''} <button class="btn btn-sm btn-secondary mt-2" data-act="reopen">Reopen order</button></div></div>` : ''}

    <div class="card card-pad mb-4">
      <div class="between mb-3" style="flex-wrap:wrap"><h2 class="card-title">${icon('square-kanban', 18)} Production progress</h2>
        ${o.cancelled ? '' : html`<div class="row-wrap">
          <label class="sr-only" for="stage-sel">Set stage</label>
          <select id="stage-sel" class="input" style="width:auto;min-height:36px">${stages.map(s => html`<option value="${s.key}" ${s.key === o.status ? raw('selected') : ''}>${s.label}</option>`)}</select>
          ${next ? html`<button class="btn btn-primary btn-sm" data-act="advance">${icon('arrow-right', 14)} ${next.label}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="note">${icon('camera', 14)} Note / photo</button></div>`}
      </div>
      <ol class="stage-track">${stages.map((s, i) => html`<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"><span class="hide-sm">${s.label}</span></li>`)}</ol>
      <p class="small muted mt-2 show-sm">Stage ${idx + 1} of ${stages.length}: ${stageLabel(o.status)}</p>
    </div>

    <div class="dash-grid">
      <div class="span-8 stack">
        <div class="card">
          <div class="card-header"><h2 class="card-title">${icon('receipt', 18)} Items</h2></div>
          ${table({ columns: [
            { label: 'Description', cell: i => html`<strong>${i.description}</strong>` },
            { label: 'Qty', cls: 'right', cell: i => html`<span class="num">${i.qty}</span>` },
            { label: 'Unit price', cls: 'right', cell: i => html`<span class="num">${money(i.unitPrice)}</span>` },
            { label: 'Amount', cls: 'right', cell: i => html`<span class="num strong">${money(i.unitPrice * i.qty)}</span>` },
          ], rows: o.items })}
          <div class="card-foot"><dl class="kv" style="justify-content:end;grid-template-columns:max-content max-content;margin-left:auto;width:max-content">
            ${o.discount ? html`<dt>Discount</dt><dd class="num right">−${money(o.discount)}</dd>` : ''}
            <dt>Total</dt><dd class="num right strong">${money(o.total)}</dd>
            <dt>Paid</dt><dd class="num right text-success">${money(o.paid)}</dd>
            <dt>${o.credit > 0 ? 'Credit' : 'Balance'}</dt><dd class="num right strong ${o.balance > 0 ? 'text-danger' : ''}">${money(o.credit > 0 ? o.credit : o.balance)}</dd>
          </dl></div>
        </div>

        <div class="card">
          <div class="card-header"><h2 class="card-title">${icon('banknote', 18)} Payments</h2>${o.cancelled ? '' : html`<button class="btn btn-primary btn-sm" data-act="pay">${icon('plus', 14)} Record payment</button>`}</div>
          ${payments.length ? html`<ul class="list">${payments.map(p => html`<li class="list-item">
            <span class="list-icon" style="color:${p.type === 'refund' ? 'var(--danger)' : 'var(--success)'}">${icon(p.type === 'refund' ? 'undo-2' : 'banknote', 16)}</span>
            <span class="list-main"><strong>${p.type === 'refund' ? 'Refund' : p.type === 'deposit' ? 'Deposit' : 'Payment'} · ${p.method}</strong><small>${p.receiptNo} · ${fmtDate(p.date)}${p.reference ? ` · ref ${p.reference}` : ''}</small></span>
            <span class="num strong ${p.type === 'refund' ? 'text-danger' : ''}">${p.type === 'refund' ? '−' : ''}${money(p.amount)}</span>
            <button class="icon-btn sm" data-receipt="${p.id}" aria-label="Download receipt ${p.receiptNo}" title="Receipt PDF">${icon('download', 16)}</button></li>`)}</ul>`
            : emptyState({ icon: 'banknote', title: 'No payments yet', text: o.total ? `${money(o.total)} outstanding.` : 'Add a price to this order first.' })}
        </div>

        <div class="card">
          <div class="card-header"><h2 class="card-title">${icon('history', 18)} Production timeline</h2></div>
          <ul class="list">${tasks.map(t => html`<li class="list-item" style="align-items:flex-start">
            <span class="list-icon">${icon(t.photo ? 'camera' : t.from !== t.stage ? 'arrow-right' : 'message-square', 16)}</span>
            <span class="list-main"><strong>${t.from && t.from !== t.stage ? `${stageLabel(t.from)} → ${stageLabel(t.stage)}` : stageLabel(t.stage)}</strong>
              <small>${fmtDateTime(t.createdAt)}${t.by ? ` · ${staffName(t.by) || t.by}` : ''}</small>
              ${t.note ? html`<p class="small mt-2" style="white-space:pre-wrap">${t.note}</p>` : ''}
              ${t.photo ? html`<div class="photo-strip mt-2"><div class="ph"><img src="${t.photo}" alt="Progress photo" data-zoom></div></div>` : ''}</span></li>`)}</ul>
        </div>
      </div>

      <div class="span-4 stack">
        <div class="card card-pad"><dl class="kv">
          <dt>Customer</dt><dd>${customer ? html`<a href="#/customers/${customer.id}">${customer.name}</a><br><small class="subtle">${customer.phone || ''}</small>` : '—'}</dd>
          <dt>Category</dt><dd>${o.garmentCategory || '—'}</dd>
          <dt>Design</dt><dd>${design ? design.name : '—'}</dd>
          <dt>Measurements</dt><dd>${measurement ? html`<a href="#/measurements/${measurement.id}">${measurement.templateName} v${measurement.version}</a>` : html`<a href="#/measurements/new?customer=${o.customerId}&order=${o.id}">Take now</a>`}</dd>
          <dt>Order date</dt><dd>${fmtDate(o.orderDate)}</dd>
          <dt>Delivery</dt><dd>${fmtDate(o.dueDate)}${o.deliveredAt ? html`<br><small class="subtle">Delivered ${fmtDate(o.deliveredAt)}</small>` : ''}</dd>
          <dt>Assigned</dt><dd>${staffName(o.assignedTo) || '—'}</dd>
        </dl></div>

        <div class="card card-pad">
          <h2 class="card-title mb-3">${icon('layers', 18)} Fabric</h2>
          <dl class="kv"><dt>Type</dt><dd>${o.fabricType || '—'}</dd><dt>Quantity</dt><dd>${o.fabricQty ? `${o.fabricQty} ${o.fabricUnit}` : '—'}</dd>
          <dt>From stock</dt><dd>${fabricItem ? html`<a href="#/inventory/${fabricItem.id}">${fabricItem.name}</a>` : 'No'}</dd></dl>
          ${stockMoves.length ? html`<p class="small text-success mt-3">${icon('check', 14)} ${stockMoves.map(m => `${Math.abs(m.quantity)} ${fabricItem?.unit || ''}`).join(', ')} deducted from stock</p>`
            : fabricItem && o.fabricQty > 0 && !o.cancelled ? html`<button class="btn btn-secondary btn-sm mt-3 w-full" data-act="deduct">${icon('package-minus', 14)} Deduct ${o.fabricQty} ${o.fabricUnit} from stock</button>` : ''}
          <button class="btn btn-ghost btn-sm mt-2 w-full" data-act="actual">${icon('ruler', 14)} Log actual fabric used</button>
        </div>

        ${o.photos?.length ? html`<div class="card card-pad"><h2 class="card-title mb-3">${icon('image', 18)} Reference photos</h2><div class="photo-strip">${o.photos.map((p, i) => html`<div class="ph"><img src="${p}" alt="Reference ${i + 1}" data-zoom></div>`)}</div></div>` : ''}
        ${o.notes ? html`<div class="card card-pad"><h2 class="card-title mb-2">${icon('file-text', 18)} Notes</h2><p class="small" style="white-space:pre-wrap">${o.notes}</p></div>` : ''}
      </div>
    </div>`);

  const reload = () => renderDetail(el, id);
  const offs = [
    delegate(el, 'change', '#stage-sel', async (e, s) => {
      try { await changeStage(id, s.value); toast(`Moved to ${stageLabel(s.value)}.`, { type: 'success' }); maybePromptMessage(o, s.value); reload(); } catch (err) { toastError(err); }
    }),
    delegate(el, 'click', '[data-zoom]', (e, img) => openModal({ title: 'Photo', size: 'lg', body: html`<div class="lightbox"><img src="${img.src}" alt=""></div>` })),
    delegate(el, 'click', '[data-receipt]', async (e, b) => {
      const p = payments.find(x => x.id === b.dataset.receipt);
      try { await (await import('../exports.js')).receiptPdf(p, o, customer); } catch (err) { toastError(err); }
    }),
    delegate(el, 'click', '[data-act]', async (e, b) => {
      const act = b.dataset.act;
      try {
        if (act === 'advance') { await changeStage(id, next.key); toast(`Moved to ${next.label}.`, { type: 'success' }); maybePromptMessage(o, next.key); reload(); }
        else if (act === 'note') { if (await openNoteForm(o)) reload(); }
        else if (act === 'pay') { if (await (await import('./finance.js')).openPaymentForm(id)) reload(); }
        else if (act === 'invoice') await (await import('../exports.js')).invoicePdf(o, customer);
        else if (act === 'message') (await import('./notifications.js')).composeMessage({ order: o, customer });
        else if (act === 'reopen') { await setOrderCancelled(id, false); toast('Order reopened.', { type: 'success' }); reload(); }
        else if (act === 'deduct') {
          const ok = await confirmDialog({ title: 'Deduct fabric from stock?', message: `Remove ${o.fabricQty} ${o.fabricUnit} of “${fabricItem.name}” from inventory for ${o.number}?\n\nIn stock now: ${fabricItem.quantity} ${fabricItem.unit}.${fabricItem.unit !== o.fabricUnit ? `\n\nNote: the item is tracked in ${fabricItem.unit}; the quantity will be deducted as-is.` : ''}`, confirmLabel: 'Deduct stock' });
          if (!ok) return;
          await moveStock({ itemId: fabricItem.id, type: 'out', quantity: o.fabricQty, orderId: id, note: `Used for ${o.number}`, markOrderDeducted: true });
          toast('Stock updated.', { type: 'success' }); reload();
        }
        else if (act === 'actual') { if (await openActualFabricForm(o)) reload(); }
        else if (act === 'more') openMoreMenu(o, reload);
      } catch (err) { toastError(err); }
    }),
  ];
  return () => offs.forEach(f => f());
}

function maybePromptMessage(o, stage) {
  const map = { cutting: 'production_started', sewing: 'production_started', ready: 'ready' };
  const tplKey = map[stage];
  if (!tplKey) return;
  toast(stage === 'ready' ? 'Let the customer know it is ready?' : 'Tell the customer production has started?', {
    timeout: 8000,
    action: { label: 'Compose', fn: async () => (await import('./notifications.js')).composeMessage({ order: o, templateKey: tplKey }) },
  });
}

function openMoreMenu(o, reload) {
  const m = openModal({
    title: `${o.number}`, size: 'sm',
    body: html`<div class="stack-sm">
      <a class="btn btn-secondary btn-block" href="#/calendar?new=1&order=${o.id}" data-close>${icon('calendar-plus', 16)} Schedule fitting / delivery</a>
      ${o.cancelled ? '' : html`<button class="btn btn-secondary btn-block" data-m="cancel">${icon('x', 16)} Cancel order</button>`}
      <button class="btn btn-danger-ghost btn-block" data-m="delete">${icon('trash-2', 16)} Delete order</button></div>`,
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    m.close();
    try {
      if (b.dataset.m === 'cancel') {
        const r = await formModal({ title: `Cancel ${o.number}?`, submitLabel: 'Cancel order', danger: true,
          body: html`<p class="span-2 small muted">The order stays in your records as cancelled. ${o.paid > 0 ? `${money(o.paid)} has been paid — record a refund from the order page if you are returning money.` : ''}</p>${field({ label: 'Reason', name: 'reason', full: true })}`,
          onSubmit: (d) => setOrderCancelled(o.id, true, d.reason) });
        if (r) { toast('Order cancelled.', { type: 'success' }); reload(); }
      } else {
        const ok = await confirmDialog({ title: `Delete ${o.number}?`, message: 'Only orders with no payments or stock movements can be deleted. This cannot be undone.', confirmLabel: 'Delete', danger: true, requireText: 'DELETE' });
        if (!ok) return;
        await deleteOrder(o.id);
        toast('Order deleted.', { type: 'success' });
        navigate('/orders');
      }
    } catch (err) { toastError(err); }
  });
}

export async function openNoteForm(o) {
  let photo = '';
  return formModal({
    title: `Progress update · ${o.number}`, submitLabel: 'Save update',
    body: html`${field({ label: 'Note', name: 'note', type: 'textarea', full: true, placeholder: 'e.g. Collar attached, waiting for buttons' })}
      ${field({ label: 'By', name: 'by', type: 'select', value: o.assignedTo || '', options: [{ value: '', label: '—' }, ...getState().staff.map(s => ({ value: s.id, label: s.name }))] })}
      <div class="field"><label>Photo</label><div class="row"><div class="photo-strip" data-ph></div><label class="upload-tile" style="position:relative">${icon('camera', 18)}<span>Add</span><input type="file" accept="image/*" capture="environment" data-file></label></div></div>`,
    onOpen: (form) => form.querySelector('[data-file]').addEventListener('change', async (e) => {
      try { photo = await readImage(e.target.files[0]); form.querySelector('[data-ph]').innerHTML = String(html`<div class="ph"><img src="${photo}" alt="Preview"></div>`); } catch (err) { toastError(err); }
    }),
    onSubmit: (d) => {
      if (!d.note && !photo) throw new Error('Add a note or a photo.');
      return addProductionNote(o.id, { note: d.note, photo, by: d.by });
    },
  });
}

async function openActualFabricForm(o) {
  const rules = getState().fabricRules;
  const guess = rules.find(r => o.garmentCategory && r.garment.toLowerCase().includes(o.garmentCategory.toLowerCase().split(' ')[0])) || rules[0];
  const measurement = o.measurementId ? await get('measurements', o.measurementId) : null;
  const unit = o.fabricUnit === 'metres' ? 'm' : 'yd';
  return formModal({
    title: 'Log actual fabric used', submitLabel: 'Save',
    body: html`<p class="span-2 small muted">Recording what you really used improves future estimates for this garment type (after 3 or more logs you can apply a correction in the Fabric Calculator).</p>
      ${field({ label: 'Garment rule', name: 'ruleId', type: 'select', value: guess?.id, options: rules.map(r => ({ value: r.id, label: r.garment })), full: true })}
      ${field({ label: `Actual fabric used (${o.fabricUnit})`, name: 'actual', type: 'number', required: true, attrs: 'min="0.1"' })}
      ${field({ label: 'Fabric width (cm)', name: 'width', type: 'number', value: 150, attrs: 'min="50"' })}`,
    onSubmit: (d) => {
      const rule = rules.find(r => r.id === d.ruleId);
      const est = estimateFabric({ ...rule, wastePct: 0 }, { measurements: measurement?.values || {}, unit: measurement?.unit || 'cm', fabricWidthCm: d.width || 150, outputUnit: unit });
      return logFabricUsage({ ruleId: rule.id, garment: rule.garment, orderId: o.id, estimated: round(est.net, 2), actual: d.actual, unit: o.fabricUnit, calibrationAtTime: rule.calibration || 1, usedFallback: est.usedFallback, date: todayISO() });
    },
  });
}

