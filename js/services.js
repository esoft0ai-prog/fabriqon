// Business operations. Each mutating function runs in one IndexedDB
// transaction so related records (order + items + deposit + log) commit
// together or not at all.
import { transaction, getAll, nextSequence, logActivity, DbError } from './database.js';
import { orderTotal, orderBalance, validatePayment, applyStockMovement, isOverdue, roundMoney } from './core/calc.js';
import { getState } from './state.js';
import { todayISO, byId, groupBy, money } from './utils.js';

const pad = (n, w = 4) => String(n).padStart(w, '0');
const clean = (s) => (typeof s === 'string' ? s.trim() : s);

/** Next number from a counter, skipping any value already used (e.g. after a restore). */
async function uniqueNumber(t, seqName, store, index, format) {
  for (let guard = 0; guard < 10000; guard++) {
    const value = format(await nextSequence(t, seqName));
    if (!(await t.byIndex(store, index, value)).length) return value;
  }
  throw new DbError('Could not allocate a unique number.');
}

export class DuplicateError extends Error {
  constructor(message, existing) { super(message); this.name = 'DuplicateError'; this.existing = existing; }
}

// ---------- Customers ----------
export async function createCustomer(data, { allowDuplicate = false } = {}) {
  const name = clean(data.name);
  const phone = clean(data.phone || '');
  if (!allowDuplicate) {
    const all = await getAll('customers');
    const dup = all.find(c => (phone && c.phone && c.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')) || c.nameLower === name.toLowerCase());
    if (dup) throw new DuplicateError(`A customer named “${dup.name}”${dup.phone ? ` (${dup.phone})` : ''} already exists.`, dup);
  }
  return transaction(['customers', 'settings', 'activityLogs'], async (t) => {
    const code = await uniqueNumber(t, 'customer', 'customers', 'code', (n) => `CUS-${pad(n)}`);
    const rec = await t.add('customers', {
      code, name, phone, email: clean(data.email || ''), gender: data.gender || '',
      address: clean(data.address || ''), notes: clean(data.notes || ''), photo: data.photo || '', archived: false,
    });
    await logActivity(t, 'created', 'customer', rec.id, `New customer ${rec.name}`);
    return rec;
  });
}

export async function updateCustomer(id, patch) {
  return transaction(['customers', 'activityLogs'], async (t) => {
    const cur = await t.get('customers', id);
    if (!cur) throw new DbError('Customer not found — it may have been deleted.');
    const rec = await t.put('customers', { ...cur, ...patch, name: clean(patch.name ?? cur.name) });
    await logActivity(t, 'updated', 'customer', id, `Updated ${rec.name}`);
    return rec;
  });
}

export async function setCustomerArchived(id, archived) {
  return updateCustomer(id, { archived });
}

/** Deletes a customer only when they have no orders or payments. */
export async function deleteCustomer(id) {
  return transaction(['customers', 'orders', 'payments', 'measurements', 'activityLogs'], async (t) => {
    const cur = await t.get('customers', id);
    if (!cur) throw new DbError('Customer not found.');
    const orders = await t.byIndex('orders', 'customerId', id);
    const pays = await t.byIndex('payments', 'customerId', id);
    if (orders.length || pays.length) throw new DbError(`${cur.name} has ${orders.length} order(s) and ${pays.length} payment(s). Archive the customer instead so financial history stays intact.`);
    for (const m of await t.byIndex('measurements', 'customerId', id)) await t.delete('measurements', m.id);
    await t.delete('customers', id);
    await logActivity(t, 'deleted', 'customer', id, `Deleted customer ${cur.name}`);
  });
}

// ---------- Measurements ----------
/** Always adds a new record so history is never destroyed. */
export async function saveMeasurement(data) {
  const values = {};
  for (const [k, v] of Object.entries(data.values || {})) if (v !== null && v !== '' && Number.isFinite(Number(v))) values[k] = Number(v);
  const custom = (data.custom || []).filter(c => clean(c.label) && Number.isFinite(Number(c.value))).map(c => ({ label: clean(c.label), value: Number(c.value) }));
  if (!Object.keys(values).length && !custom.length) throw new DbError('Enter at least one measurement.');
  return transaction(['measurements', 'customers', 'activityLogs'], async (t) => {
    const customer = await t.get('customers', data.customerId);
    if (!customer) throw new DbError('Choose a valid customer.');
    const history = (await t.byIndex('measurements', 'customerId', data.customerId)).filter(m => m.templateId === data.templateId);
    const rec = await t.add('measurements', {
      customerId: data.customerId, templateId: data.templateId, templateName: data.templateName, unit: data.unit,
      values, custom, notes: clean(data.notes || ''), takenAt: data.takenAt || new Date().toISOString(),
      orderId: data.orderId || '', previousId: data.previousId || '', version: history.length + 1, takenBy: data.takenBy || '',
    });
    await logActivity(t, 'created', 'measurement', rec.id, `${data.templateName} measurements for ${customer.name} (v${rec.version})`);
    return rec;
  });
}

export const deleteMeasurement = (id) => transaction(['measurements', 'activityLogs'], async (t) => {
  const m = await t.get('measurements', id);
  if (!m) throw new DbError('Measurement not found.');
  await t.delete('measurements', id);
  await logActivity(t, 'deleted', 'measurement', id, `Deleted measurement v${m.version}`);
});

// ---------- Designs ----------
export const saveDesign = (data) => transaction(['designs', 'activityLogs'], async (t) => {
  const cur = data.id ? await t.get('designs', data.id) : null;
  const rec = cur ? await t.put('designs', { ...cur, ...data }) : await t.add('designs', data);
  await logActivity(t, cur ? 'updated' : 'created', 'design', rec.id, `${cur ? 'Updated' : 'Added'} design ${rec.name}`);
  return rec;
});

export const deleteDesign = (id) => transaction(['designs', 'orders', 'activityLogs'], async (t) => {
  const used = (await t.getAll('orders')).filter(o => o.designId === id).length;
  if (used) throw new DbError(`This design is used by ${used} order(s) and cannot be deleted.`);
  await t.delete('designs', id);
  await logActivity(t, 'deleted', 'design', id, 'Deleted a design');
});

// ---------- Orders ----------
function cleanItems(items) {
  const out = (items || []).filter(i => clean(i.description)).map(i => ({ description: clean(i.description), qty: Number(i.qty) || 1, unitPrice: roundMoney(Number(i.unitPrice) || 0) }));
  if (!out.length) throw new DbError('Add at least one item with a description.');
  if (out.some(i => i.unitPrice < 0 || i.qty <= 0)) throw new DbError('Quantities must be positive and prices cannot be negative.');
  return out;
}

export async function createOrder(data) {
  const items = cleanItems(data.items);
  const total = orderTotal(items, data.discount);
  const deposit = Number(data.deposit) || 0;
  if (deposit < 0) throw new DbError('Deposit cannot be negative.');
  if (deposit > total) throw new DbError('Deposit is more than the order total.');
  const stages = getState().stages;
  return transaction(['orders', 'orderItems', 'payments', 'productionTasks', 'customers', 'settings', 'activityLogs'], async (t) => {
    const customer = await t.get('customers', data.customerId);
    if (!customer) throw new DbError('Choose a valid customer.');
    const year = (data.orderDate || todayISO()).slice(0, 4);
    const number = await uniqueNumber(t, `order-${year}`, 'orders', 'number', (n) => `ORD-${year}-${pad(n)}`);
    const status = data.status || stages[0].key;
    const order = await t.add('orders', {
      number, customerId: data.customerId, designId: data.designId || '', measurementId: data.measurementId || '',
      garmentCategory: data.garmentCategory || '', title: clean(data.title || items[0].description), fabricType: data.fabricType || '',
      fabricQty: Number(data.fabricQty) || 0, fabricUnit: data.fabricUnit || 'yards', fabricItemId: data.fabricItemId || '', fabricDeducted: false,
      discount: roundMoney(Number(data.discount) || 0), orderDate: data.orderDate || todayISO(), dueDate: data.dueDate || '',
      assignedTo: data.assignedTo || '', notes: clean(data.notes || ''), photos: data.photos || [], status, cancelled: false, deliveredAt: '',
    });
    for (const it of items) await t.add('orderItems', { ...it, orderId: order.id });
    await t.add('productionTasks', { orderId: order.id, stage: status, from: '', note: 'Order created', photo: '', by: data.assignedTo || '' });
    if (deposit > 0) {
      const rn = await nextSequence(t, 'receipt');
      await t.add('payments', { orderId: order.id, customerId: data.customerId, amount: roundMoney(deposit), type: 'deposit', method: data.depositMethod || 'Cash', date: order.orderDate, reference: '', notes: 'Deposit at order', receiptNo: `REC-${pad(rn, 5)}` });
    }
    await logActivity(t, 'created', 'order', order.id, `Order ${order.number} for ${customer.name}`);
    return order;
  });
}

export async function updateOrder(id, data) {
  const items = cleanItems(data.items);
  return transaction(['orders', 'orderItems', 'activityLogs'], async (t) => {
    const cur = await t.get('orders', id);
    if (!cur) throw new DbError('Order not found.');
    const { items: _i, deposit: _d, depositMethod: _m, ...rest } = data;
    const order = await t.put('orders', { ...cur, ...rest, discount: roundMoney(Number(data.discount) || 0), fabricQty: Number(data.fabricQty) || 0 });
    for (const old of await t.byIndex('orderItems', 'orderId', id)) await t.delete('orderItems', old.id);
    for (const it of items) await t.add('orderItems', { ...it, orderId: id });
    await logActivity(t, 'updated', 'order', id, `Updated order ${order.number}`);
    return order;
  });
}

export async function changeStage(orderId, stage, { note = '', photo = '', by = '' } = {}) {
  const stages = getState().stages;
  if (!stages.some(s => s.key === stage)) throw new DbError('Unknown production stage.');
  return transaction(['orders', 'productionTasks', 'activityLogs'], async (t) => {
    const o = await t.get('orders', orderId);
    if (!o) throw new DbError('Order not found.');
    if (o.cancelled) throw new DbError('This order is cancelled. Reopen it first.');
    if (o.status === stage && !note && !photo) return o;
    const last = stages[stages.length - 1].key;
    const order = await t.put('orders', { ...o, status: stage, deliveredAt: stage === last ? (o.deliveredAt || new Date().toISOString()) : '' });
    await t.add('productionTasks', { orderId, stage, from: o.status, note: clean(note), photo, by });
    const label = stages.find(s => s.key === stage).label;
    await logActivity(t, 'stage', 'order', orderId, `${o.number} → ${label}`);
    return order;
  });
}

export const addProductionNote = (orderId, { note, photo, by }) => transaction(['orders', 'productionTasks'], async (t) => {
  const o = await t.get('orders', orderId);
  if (!o) throw new DbError('Order not found.');
  return t.add('productionTasks', { orderId, stage: o.status, from: o.status, note: clean(note || ''), photo: photo || '', by: by || '' });
});

export const setOrderCancelled = (orderId, cancelled, reason = '') => transaction(['orders', 'productionTasks', 'activityLogs'], async (t) => {
  const o = await t.get('orders', orderId);
  if (!o) throw new DbError('Order not found.');
  const order = await t.put('orders', { ...o, cancelled, cancelReason: cancelled ? clean(reason) : '', cancelledAt: cancelled ? new Date().toISOString() : '' });
  await t.add('productionTasks', { orderId, stage: o.status, from: o.status, note: cancelled ? `Cancelled${reason ? `: ${reason}` : ''}` : 'Reopened', photo: '', by: '' });
  await logActivity(t, cancelled ? 'cancelled' : 'reopened', 'order', orderId, `${o.number} ${cancelled ? 'cancelled' : 'reopened'}`);
  return order;
});

export const deleteOrder = (orderId) => transaction(['orders', 'orderItems', 'payments', 'productionTasks', 'inventoryTransactions', 'activityLogs'], async (t) => {
  const o = await t.get('orders', orderId);
  if (!o) throw new DbError('Order not found.');
  if ((await t.byIndex('payments', 'orderId', orderId)).length) throw new DbError('This order has payments recorded. Cancel it instead (refund first if needed).');
  if ((await t.byIndex('inventoryTransactions', 'orderId', orderId)).length) throw new DbError('Stock was deducted for this order. Cancel it instead.');
  for (const i of await t.byIndex('orderItems', 'orderId', orderId)) await t.delete('orderItems', i.id);
  for (const p of await t.byIndex('productionTasks', 'orderId', orderId)) await t.delete('productionTasks', p.id);
  await t.delete('orders', orderId);
  await logActivity(t, 'deleted', 'order', orderId, `Deleted order ${o.number}`);
});

// ---------- Payments ----------
export async function recordPayment({ orderId, amount, type = 'payment', method = 'Cash', date, reference = '', notes = '', allowCredit = false }) {
  return transaction(['orders', 'orderItems', 'payments', 'settings', 'activityLogs'], async (t) => {
    const o = await t.get('orders', orderId);
    if (!o) throw new DbError('Order not found.');
    const items = await t.byIndex('orderItems', 'orderId', orderId);
    const pays = await t.byIndex('payments', 'orderId', orderId);
    const bal = orderBalance(orderTotal(items, o.discount), pays);
    const v = validatePayment({ amount, type, balance: bal.balance, paid: bal.paid, allowCredit, format: money });
    if (!v.ok) throw new DbError(v.error);
    const n = await nextSequence(t, 'receipt');
    const rec = await t.add('payments', {
      orderId, customerId: o.customerId, amount: roundMoney(amount), type, method, date: date || todayISO(),
      reference: clean(reference), notes: clean(notes) + (v.excess > 0 ? ` (includes ${v.excess} advance credit)` : ''), receiptNo: `${type === 'refund' ? 'RFD' : 'REC'}-${pad(n, 5)}`,
    });
    await logActivity(t, type, 'payment', rec.id, `${type === 'refund' ? 'Refund' : 'Payment'} ${rec.receiptNo} on ${o.number}`);
    return rec;
  });
}

export const deletePayment = (id) => transaction(['payments', 'activityLogs'], async (t) => {
  const p = await t.get('payments', id);
  if (!p) throw new DbError('Payment not found.');
  await t.delete('payments', id);
  await logActivity(t, 'deleted', 'payment', id, `Deleted payment ${p.receiptNo} (${p.amount})`);
});

// ---------- Expenses & suppliers ----------
export const saveExpense = (data) => transaction(['expenses', 'activityLogs'], async (t) => {
  const cur = data.id ? await t.get('expenses', data.id) : null;
  const rec = cur ? await t.put('expenses', { ...cur, ...data, amount: roundMoney(data.amount) }) : await t.add('expenses', { ...data, amount: roundMoney(data.amount) });
  await logActivity(t, cur ? 'updated' : 'created', 'expense', rec.id, `${cur ? 'Updated' : 'Recorded'} expense: ${rec.category} ${rec.amount}`);
  return rec;
});
export const deleteExpense = (id) => transaction(['expenses', 'activityLogs'], async (t) => {
  await t.delete('expenses', id);
  await logActivity(t, 'deleted', 'expense', id, 'Deleted an expense');
});

export const saveSupplier = (data) => transaction(['suppliers'], async (t) => {
  const cur = data.id ? await t.get('suppliers', data.id) : null;
  return cur ? t.put('suppliers', { ...cur, ...data }) : t.add('suppliers', data);
});
export const deleteSupplier = (id) => transaction(['suppliers', 'inventory'], async (t) => {
  const used = (await t.getAll('inventory')).filter(i => i.supplierId === id).length;
  if (used) throw new DbError(`This supplier is linked to ${used} inventory item(s).`);
  await t.delete('suppliers', id);
});

// ---------- Inventory ----------
export const saveItem = (data) => transaction(['inventory', 'inventoryTransactions', 'activityLogs'], async (t) => {
  const cur = data.id ? await t.get('inventory', data.id) : null;
  if (cur) {
    // Quantity changes on existing items go through stock movements only.
    const rec = await t.put('inventory', { ...cur, ...data, quantity: cur.quantity });
    await logActivity(t, 'updated', 'inventory', rec.id, `Updated item ${rec.name}`);
    return rec;
  }
  const qty = Math.max(0, Number(data.quantity) || 0);
  const rec = await t.add('inventory', { ...data, quantity: qty, unitCost: Number(data.unitCost) || 0, minLevel: Number(data.minLevel) || 0 });
  if (qty > 0) await t.add('inventoryTransactions', { itemId: rec.id, type: 'in', quantity: qty, unitCost: rec.unitCost, note: 'Opening stock', orderId: '', date: todayISO(), balanceAfter: qty });
  await logActivity(t, 'created', 'inventory', rec.id, `Added ${rec.name} to inventory`);
  return rec;
});

export const deleteItem = (id) => transaction(['inventory', 'inventoryTransactions', 'activityLogs'], async (t) => {
  const it = await t.get('inventory', id);
  if (!it) throw new DbError('Item not found.');
  for (const m of await t.byIndex('inventoryTransactions', 'itemId', id)) await t.delete('inventoryTransactions', m.id);
  await t.delete('inventory', id);
  await logActivity(t, 'deleted', 'inventory', id, `Deleted ${it.name}`);
});

/**
 * Stock in / out / adjust. Optionally records the purchase as an expense
 * and links consumption to an order — all in one transaction.
 */
export async function moveStock({ itemId, type, quantity, unitCost, note = '', orderId = '', date, recordExpense = false, markOrderDeducted = false }) {
  return transaction(['inventory', 'inventoryTransactions', 'expenses', 'orders', 'activityLogs'], async (t) => {
    const it = await t.get('inventory', itemId);
    if (!it) throw new DbError('Inventory item not found.');
    const newQty = applyStockMovement(it.quantity, type, Number(quantity));
    const cost = unitCost !== undefined && unitCost !== null && unitCost !== '' ? Number(unitCost) : it.unitCost;
    await t.put('inventory', { ...it, quantity: newQty, unitCost: type === 'in' && cost > 0 ? cost : it.unitCost });
    const delta = type === 'adjust' ? newQty - it.quantity : Number(quantity);
    await t.add('inventoryTransactions', { itemId, type, quantity: delta, unitCost: cost || 0, note: clean(note), orderId, date: date || todayISO(), balanceAfter: newQty });
    if (type === 'in' && recordExpense && cost > 0) {
      await t.add('expenses', { category: 'Materials', amount: roundMoney(cost * Number(quantity)), date: date || todayISO(), description: `Purchase: ${quantity} ${it.unit} ${it.name}`, supplierId: it.supplierId || '', inventoryItemId: itemId });
    }
    if (orderId && markOrderDeducted) {
      const o = await t.get('orders', orderId);
      if (o) await t.put('orders', { ...o, fabricDeducted: true });
    }
    await logActivity(t, `stock-${type}`, 'inventory', itemId, `${type === 'in' ? 'Added' : type === 'out' ? 'Used' : 'Adjusted'} ${Math.abs(delta)} ${it.unit} ${it.name}`);
    return newQty;
  });
}

// ---------- Appointments ----------
export const saveAppointment = (data) => transaction(['appointments', 'activityLogs'], async (t) => {
  const cur = data.id ? await t.get('appointments', data.id) : null;
  const rec = cur ? await t.put('appointments', { ...cur, ...data }) : await t.add('appointments', { status: 'scheduled', ...data });
  await logActivity(t, cur ? 'updated' : 'created', 'appointment', rec.id, `${cur ? 'Updated' : 'Scheduled'} ${rec.title}`);
  return rec;
});
export const deleteAppointment = (id) => transaction(['appointments'], (t) => t.delete('appointments', id));

// ---------- Notifications & fabric logs ----------
export const addNotification = (data) => transaction(['notifications'], (t) => t.add('notifications', { read: false, ...data }));
export const markNotificationsRead = (ids) => transaction(['notifications'], async (t) => {
  for (const id of ids) { const n = await t.get('notifications', id); if (n && !n.read) await t.put('notifications', { ...n, read: true }); }
});
export const logFabricUsage = (data) => transaction(['fabricLogs', 'activityLogs'], async (t) => {
  const rec = await t.add('fabricLogs', data);
  await logActivity(t, 'created', 'fabric', rec.id, `Logged actual fabric use: ${data.actual} ${data.unit} for ${data.garment}`);
  return rec;
});

// ---------- Read models ----------
/** All orders enriched with totals, balances, customer names and flags. */
export async function loadOrderViews() {
  const [orders, items, payments, customers] = await Promise.all([getAll('orders'), getAll('orderItems'), getAll('payments'), getAll('customers')]);
  const itemsBy = groupBy(items, i => i.orderId);
  const paysBy = groupBy(payments, p => p.orderId);
  const custs = byId(customers);
  const today = todayISO();
  const views = orders.map(o => {
    const total = orderTotal(itemsBy[o.id] || [], o.discount);
    const bal = orderBalance(total, paysBy[o.id] || []);
    const c = custs.get(o.customerId);
    return { ...o, items: itemsBy[o.id] || [], payments: paysBy[o.id] || [], ...bal, customerName: c?.name || 'Unknown customer', customerPhone: c?.phone || '', overdue: isOverdue(o, today) };
  });
  views.sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '') || (b.number || '').localeCompare(a.number || ''));
  return { orders: views, payments, customers, custs };
}
