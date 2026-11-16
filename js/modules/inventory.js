// Inventory: materials, stock movements, purchases, suppliers, low-stock.
import { html, icon, raw, field, formModal, toast, toastError, table, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog, stat } from '../ui.js';
import { getAll, get, byIndex } from '../database.js';
import { saveItem, deleteItem, moveStock, saveSupplier, deleteSupplier } from '../services.js';
import { isLowStock, inventoryValue } from '../core/calc.js';
import { INVENTORY_CATEGORIES, INVENTORY_UNITS } from '../core/defaults.js';
import { money, fmtDate, fmtNum, todayISO, debounce, byId, sum } from '../utils.js';
import { navigate } from '../router.js';

export async function openItemForm(existing = {}) {
  const suppliers = await getAll('suppliers');
  const isNew = !existing.id;
  const res = await formModal({
    title: isNew ? 'Add inventory item' : `Edit ${existing.name}`, submitLabel: isNew ? 'Add item' : 'Save',
    body: html`
      ${field({ label: 'Item name', name: 'name', value: existing.name, required: true, full: true, placeholder: 'e.g. Navy Atiku, Black thread 40s', attrs: 'maxlength="100"' })}
      ${field({ label: 'Category', name: 'category', type: 'select', value: existing.category || 'Fabric', options: INVENTORY_CATEGORIES })}
      ${field({ label: 'Unit', name: 'unit', type: 'select', value: existing.unit || 'yards', options: INVENTORY_UNITS })}
      ${isNew ? field({ label: 'Opening quantity', name: 'quantity', type: 'number', value: existing.quantity ?? '', attrs: 'min="0"' }) : ''}
      ${field({ label: 'Purchase price per unit', name: 'unitCost', type: 'number', value: existing.unitCost ?? '', attrs: 'min="0"' })}
      ${field({ label: 'Minimum stock level', name: 'minLevel', type: 'number', value: existing.minLevel ?? '', attrs: 'min="0"', hint: 'You get a low-stock alert at or below this' })}
      ${field({ label: 'Supplier', name: 'supplierId', type: 'select', value: existing.supplierId || '', options: [{ value: '', label: '—' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))] })}
      ${field({ label: 'Colour / shade', name: 'color', value: existing.color })}
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: existing.notes, full: true })}`,
    onSubmit: (d) => saveItem({ ...existing, ...d, quantity: isNew ? (d.quantity || 0) : existing.quantity, unitCost: d.unitCost || 0, minLevel: d.minLevel || 0 }),
  });
  if (res && res !== true) toast(isNew ? `${res.name} added.` : 'Item saved.', { type: 'success' });
  return res;
}

export async function openMoveForm(item, type) {
  const label = { in: 'Add stock (purchase)', out: 'Use / remove stock', adjust: 'Stock count adjustment' }[type];
  const res = await formModal({
    title: `${label} · ${item.name}`, submitLabel: 'Save',
    body: html`
      <p class="span-2 small muted">Currently in stock: <strong>${fmtNum(item.quantity)} ${item.unit}</strong></p>
      ${field({ label: type === 'adjust' ? `Counted quantity (${item.unit})` : `Quantity (${item.unit})`, name: 'quantity', type: 'number', required: true, attrs: `min="${type === 'adjust' ? 0 : 0.001}" ${type === 'out' ? `max="${item.quantity}"` : ''}` })}
      ${type === 'in' ? field({ label: 'Price per unit', name: 'unitCost', type: 'number', value: item.unitCost || '', attrs: 'min="0"' }) : ''}
      ${field({ label: 'Date', name: 'date', type: 'date', value: todayISO(), required: true })}
      ${field({ label: 'Note', name: 'note', full: true, placeholder: type === 'out' ? 'e.g. Used for samples' : type === 'adjust' ? 'Reason for adjustment' : 'Invoice no., supplier' })}
      ${type === 'in' ? field({ label: 'Also record this purchase as a Materials expense', name: 'recordExpense', type: 'checkbox', value: true, full: true }) : ''}`,
    onSubmit: (d) => moveStock({ itemId: item.id, type, ...d }),
  });
  if (res !== null && res !== undefined) toast(`Stock updated: ${fmtNum(res)} ${item.unit}.`, { type: 'success' });
  return res;
}

export async function render(el, params) {
  if (params.id) return renderItem(el, params.id);
  el.innerHTML = String(html`${pageHeader({ title: 'Inventory' })}${skeleton(6)}`);
  const [items, suppliers] = await Promise.all([getAll('inventory'), getAll('suppliers')]);
  const sup = byId(suppliers);
  const low = items.filter(isLowStock);
  const ui = { q: '', cat: '', tab: 'items' };

  el.innerHTML = String(html`
    ${pageHeader({ title: 'Inventory', subtitle: 'Fabrics, threads, buttons, zips and accessories',
      actions: html`<button class="btn btn-secondary" data-act="report">${icon('download', 16)} Report</button><button class="btn btn-primary" data-act="add">${icon('package-plus', 16)} Add item</button>` })}
    <div class="stats">
      ${stat({ label: 'Items', value: items.length, icon: 'package', tone: 'navy' })}
      ${stat({ label: 'Stock value', value: money(inventoryValue(items)), icon: 'banknote', tone: 'gold', sub: 'at purchase price' })}
      ${stat({ label: 'Low stock', value: low.length, icon: 'package-minus', tone: low.length ? 'red' : 'green' })}
      ${stat({ label: 'Suppliers', value: suppliers.length, icon: 'truck', tone: 'blue' })}
    </div>
    <div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="items" aria-selected="true">Items</button><button class="tab" role="tab" data-tab="suppliers" aria-selected="false">Suppliers<span class="count">${suppliers.length}</span></button></div>
    <div id="inv-body"></div>`);
  const body = el.querySelector('#inv-body');

  const paintItems = () => {
    if (!items.length) { body.innerHTML = String(html`<div class="card">${emptyState({ icon: 'package', title: 'No stock recorded', text: 'Track fabrics and accessories so you know what you have, what it is worth and when to restock.', action: html`<button class="btn btn-primary" data-act="add">Add first item</button>` })}</div>`); return; }
    const q = ui.q.toLowerCase();
    const rows = items.filter(i => (!ui.cat || i.category === ui.cat) && (!q || i.nameLower.includes(q) || (i.color || '').toLowerCase().includes(q))).sort((a, b) => (isLowStock(b) - isLowStock(a)) || a.name.localeCompare(b.name));
    body.innerHTML = String(html`
      <div class="toolbar">
        <div class="search">${icon('search', 16)}<label class="sr-only" for="i-q">Search stock</label><input id="i-q" class="input" type="search" placeholder="Search items" value="${ui.q}"></div>
        <label class="sr-only" for="i-cat">Category</label><select id="i-cat" class="input"><option value="">All categories</option>${INVENTORY_CATEGORIES.map(c => html`<option ${c === ui.cat ? raw('selected') : ''}>${c}</option>`)}</select>
      </div>
      <div class="card">${rows.length ? table({
        columns: [
          { label: 'Item', cell: i => html`<div class="cell-main"><div><strong>${i.name}</strong><small>${i.category}${i.color ? ` · ${i.color}` : ''}</small></div></div>` },
          { label: 'In stock', cls: 'right', cell: i => html`<span class="num strong ${isLowStock(i) ? 'text-danger' : ''}">${fmtNum(i.quantity)}</span> <span class="subtle">${i.unit}</span>${isLowStock(i) ? html` ${badge('Low', 'danger')}` : ''}` },
          { label: 'Unit cost', cls: 'right', cell: i => html`<span class="num">${i.unitCost ? money(i.unitCost) : '—'}</span>` },
          { label: 'Value', cls: 'right', cell: i => html`<span class="num">${money((i.unitCost || 0) * i.quantity)}</span>` },
          { label: 'Supplier', cell: i => sup.get(i.supplierId)?.name || html`<span class="subtle">—</span>` },
          { label: '', cls: 'actions', cell: i => html`<button class="icon-btn sm" data-in="${i.id}" title="Add stock" aria-label="Add stock to ${i.name}">${icon('package-plus', 16)}</button><button class="icon-btn sm" data-out="${i.id}" title="Use stock" aria-label="Use stock of ${i.name}">${icon('package-minus', 16)}</button><a class="icon-btn sm" href="#/inventory/${i.id}" aria-label="Open ${i.name}">${icon('chevron-right', 16)}</a>` },
        ], rows,
      }) : emptyState({ icon: 'search', title: 'No items match' })}</div>`);
  };
  const paintSuppliers = () => {
    body.innerHTML = String(html`<div class="row mb-3"><span class="spacer"></span><button class="btn btn-primary btn-sm" data-act="add-sup">${icon('plus', 14)} Add supplier</button></div>
      <div class="card">${suppliers.length ? table({
        columns: [
          { label: 'Supplier', cell: s => html`<strong>${s.name}</strong>` },
          { label: 'Phone', cell: s => s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a>` : '—' },
          { label: 'Address', cell: s => s.address || '—' },
          { label: 'Items', cls: 'right', cell: s => items.filter(i => i.supplierId === s.id).length },
          { label: '', cls: 'actions', cell: s => html`<button class="icon-btn sm" data-edit-sup="${s.id}" aria-label="Edit supplier">${icon('pencil', 16)}</button><button class="icon-btn sm" data-del-sup="${s.id}" aria-label="Delete supplier">${icon('trash-2', 16)}</button>` },
        ], rows: suppliers,
      }) : emptyState({ icon: 'truck', title: 'No suppliers yet', text: 'Keep fabric market and accessory sellers’ contacts in one place.' })}</div>`);
  };
  const paint = () => (ui.tab === 'items' ? paintItems() : paintSuppliers());
  paint();

  const supplierForm = (s = {}) => formModal({
    title: s.id ? 'Edit supplier' : 'Add supplier',
    body: html`${field({ label: 'Name', name: 'name', value: s.name, required: true, full: true })}${field({ label: 'Phone', name: 'phone', type: 'tel', value: s.phone })}${field({ label: 'Email', name: 'email', type: 'email', value: s.email })}${field({ label: 'Address / market', name: 'address', value: s.address, full: true })}${field({ label: 'Notes', name: 'notes', type: 'textarea', value: s.notes, full: true })}`,
    onSubmit: (d) => saveSupplier({ ...s, ...d }),
  });

  const reload = () => render(el, params);
  const offs = [
    delegate(el, 'input', '#i-q', debounce((e) => { ui.q = e.target.value.trim(); paintItems(); el.querySelector('#i-q')?.focus(); const inp = el.querySelector('#i-q'); inp?.setSelectionRange(inp.value.length, inp.value.length); }, 200)),
    delegate(el, 'change', '#i-cat', (e, s) => { ui.cat = s.value; paintItems(); }),
    delegate(el, 'click', '[data-tab],[data-act],[data-in],[data-out],[data-edit-sup],[data-del-sup]', async (e, b) => {
      const d = b.dataset;
      try {
        if (d.tab) { ui.tab = d.tab; el.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', t === b)); paint(); }
        else if (d.act === 'add') { if (await openItemForm()) reload(); }
        else if (d.act === 'add-sup') { if (await supplierForm()) reload(); }
        else if (d.act === 'report') {
          const { exportRows } = await import('../exports.js');
          exportRows('inventory-report', items.map(i => ({ Item: i.name, Category: i.category, Colour: i.color || '', Quantity: i.quantity, Unit: i.unit, 'Unit cost': i.unitCost || 0, Value: (i.unitCost || 0) * i.quantity, 'Min level': i.minLevel || 0, Low: isLowStock(i) ? 'Yes' : 'No', Supplier: sup.get(i.supplierId)?.name || '' })));
        }
        else if (d.in) { if ((await openMoveForm(items.find(i => i.id === d.in), 'in')) !== null) reload(); }
        else if (d.out) { if ((await openMoveForm(items.find(i => i.id === d.out), 'out')) !== null) reload(); }
        else if (d.editSup) { if (await supplierForm(suppliers.find(s => s.id === d.editSup))) reload(); }
        else if (d.delSup) {
          if (!(await confirmDialog({ title: 'Delete supplier?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
          await deleteSupplier(d.delSup); toast('Supplier deleted.', { type: 'success' }); reload();
        }
      } catch (err) { toastError(err); }
    }),
  ];
  return () => offs.forEach(f => f());
}

async function renderItem(el, id) {
  el.innerHTML = String(skeleton(6));
  const item = await get('inventory', id);
  if (!item) { el.innerHTML = String(html`${pageHeader({ title: 'Item not found', back: '#/inventory' })}<div class="card">${emptyState({ icon: 'package', title: 'This item does not exist' })}</div>`); return; }
  const [moves, orders, supplier] = await Promise.all([byIndex('inventoryTransactions', 'itemId', id), getAll('orders'), item.supplierId ? get('suppliers', item.supplierId) : null]);
  const ordersById = byId(orders);
  moves.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const used = sum(moves.filter(m => m.type === 'out'), m => m.quantity);
  el.innerHTML = String(html`
    ${pageHeader({ title: item.name, subtitle: `${item.category}${item.color ? ` · ${item.color}` : ''}${supplier ? ` · from ${supplier.name}` : ''}`, back: '#/inventory',
      actions: html`<button class="btn btn-secondary" data-m="adjust">${icon('sliders-horizontal', 16)} Count</button><button class="btn btn-secondary" data-m="out">${icon('package-minus', 16)} Use</button><button class="btn btn-primary" data-m="in">${icon('package-plus', 16)} Add stock</button>` })}
    <div class="stats">
      ${stat({ label: 'In stock', value: `${fmtNum(item.quantity)} ${item.unit}`, icon: 'package', tone: isLowStock(item) ? 'red' : 'green', sub: item.minLevel ? `minimum ${item.minLevel}` : 'no minimum set' })}
      ${stat({ label: 'Value', value: money((item.unitCost || 0) * item.quantity), icon: 'banknote', tone: 'gold', sub: item.unitCost ? `${money(item.unitCost)} / ${item.unit}` : 'no price set' })}
      ${stat({ label: 'Total used', value: `${fmtNum(used)} ${item.unit}`, icon: 'scissors', tone: 'navy' })}
      ${stat({ label: 'Movements', value: moves.length, icon: 'history', tone: 'blue' })}
    </div>
    <div class="card"><div class="card-header"><h2 class="card-title">${icon('history', 18)} Stock movements</h2><div class="row"><button class="btn btn-ghost btn-sm" data-m="edit">${icon('pencil', 14)} Edit item</button><button class="btn btn-danger-ghost btn-sm" data-m="delete">${icon('trash-2', 14)} Delete</button></div></div>
      ${moves.length ? table({ columns: [
        { label: 'Date', cell: m => fmtDate(m.date) },
        { label: 'Type', cell: m => badge(m.type === 'in' ? 'Added' : m.type === 'out' ? 'Used' : 'Adjusted', m.type === 'in' ? 'success' : m.type === 'out' ? 'warning' : 'info') },
        { label: 'Quantity', cls: 'right', cell: m => html`<span class="num strong">${m.type === 'out' ? '−' : m.quantity > 0 ? '+' : ''}${fmtNum(m.quantity)}</span>` },
        { label: 'Balance', cls: 'right', cell: m => html`<span class="num">${m.balanceAfter !== undefined ? fmtNum(m.balanceAfter) : '—'}</span>` },
        { label: 'Note', cell: m => html`${m.note || ''}${m.orderId && ordersById.get(m.orderId) ? html` <a href="#/orders/${m.orderId}">${ordersById.get(m.orderId).number}</a>` : ''}` },
      ], rows: moves }) : emptyState({ icon: 'history', title: 'No movements yet' })}
    </div>`);
  return delegate(el, 'click', '[data-m]', async (e, b) => {
    try {
      const k = b.dataset.m;
      if (['in', 'out', 'adjust'].includes(k)) { if ((await openMoveForm(item, k)) !== null) renderItem(el, id); }
      else if (k === 'edit') { if (await openItemForm(item)) renderItem(el, id); }
      else if (k === 'delete') {
        if (!(await confirmDialog({ title: `Delete ${item.name}?`, message: `This removes the item and its ${moves.length} stock movement(s). Expenses already recorded are kept.`, confirmLabel: 'Delete', danger: true, requireText: 'DELETE' }))) return;
        await deleteItem(id); toast('Item deleted.', { type: 'success' }); navigate('/inventory');
      }
    } catch (err) { toastError(err); }
  });
}
