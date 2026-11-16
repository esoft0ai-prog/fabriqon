// IndexedDB schema and record validation. Pure: used by the database layer
// and by backup validation (also in Node tests).

export const DB_NAME = 'fabriqon';
export const DB_VERSION = 2;

/**
 * Migrations run in order for every version above the stored one.
 * Each receives (db, tx) inside the versionchange transaction.
 */
export const MIGRATIONS = {
  1: (db) => {
    const make = (name, indexes = [], keyPath = 'id') => {
      const s = db.createObjectStore(name, { keyPath });
      for (const [idx, path, opts] of indexes) s.createIndex(idx, path, opts || {});
      return s;
    };
    make('customers', [['name', 'nameLower'], ['phone', 'phone'], ['code', 'code', { unique: true }], ['createdAt', 'createdAt']]);
    make('measurements', [['customerId', 'customerId'], ['takenAt', 'takenAt'], ['orderId', 'orderId']]);
    make('measurementTemplates', [['group', 'group']]);
    make('designs', [['category', 'category'], ['createdAt', 'createdAt']]);
    make('orders', [['number', 'number', { unique: true }], ['customerId', 'customerId'], ['status', 'status'], ['dueDate', 'dueDate'], ['orderDate', 'orderDate']]);
    make('orderItems', [['orderId', 'orderId']]);
    make('productionTasks', [['orderId', 'orderId'], ['createdAt', 'createdAt']]);
    make('payments', [['orderId', 'orderId'], ['customerId', 'customerId'], ['date', 'date']]);
    make('expenses', [['date', 'date'], ['category', 'category']]);
    make('inventory', [['category', 'category'], ['name', 'nameLower']]);
    make('inventoryTransactions', [['itemId', 'itemId'], ['date', 'date'], ['orderId', 'orderId']]);
    make('suppliers', [['name', 'nameLower']]);
    make('appointments', [['start', 'start'], ['customerId', 'customerId']]);
    make('notifications', [['createdAt', 'createdAt'], ['read', 'readFlag']]);
    make('settings', [], 'key');
    make('activityLogs', [['at', 'at'], ['entity', 'entity']]);
  },
  2: (db) => {
    // v2: actual fabric consumption log, used to calibrate estimates.
    const s = db.createObjectStore('fabricLogs', { keyPath: 'id' });
    s.createIndex('ruleId', 'ruleId');
    s.createIndex('date', 'date');
  },
};

export const STORES = [
  'customers', 'measurements', 'measurementTemplates', 'designs', 'orders', 'orderItems', 'productionTasks',
  'payments', 'expenses', 'inventory', 'inventoryTransactions', 'suppliers', 'appointments', 'notifications',
  'settings', 'activityLogs', 'fabricLogs',
];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const optNum = (v) => v === undefined || v === null || v === '' || isNum(v);

/** Required-field rules per store. Returns an error string or null. */
const RULES = {
  customers: (r) => !isStr(r.name) ? 'Customer name is required' : !isStr(r.code) ? 'Customer code is required' : null,
  measurements: (r) => !isStr(r.customerId) ? 'Measurement must belong to a customer'
    : !['cm', 'in'].includes(r.unit) ? 'Unit must be cm or in'
      : typeof r.values !== 'object' || r.values === null ? 'Measurement values missing'
        : Object.values(r.values).some(v => !isNum(v) || v < 0) ? 'Measurements must be positive numbers' : null,
  measurementTemplates: (r) => !isStr(r.name) ? 'Template name is required' : !Array.isArray(r.fields) ? 'Template fields missing' : null,
  designs: (r) => !isStr(r.name) ? 'Design name is required' : null,
  orders: (r) => !isStr(r.number) ? 'Order number is required' : !isStr(r.customerId) ? 'Order must have a customer'
    : !isStr(r.status) ? 'Order status is required' : !optNum(r.discount) ? 'Discount must be a number' : null,
  orderItems: (r) => !isStr(r.orderId) ? 'Item must belong to an order' : !isStr(r.description) ? 'Item description is required'
    : !isNum(r.qty) || r.qty <= 0 ? 'Item quantity must be positive' : !isNum(r.unitPrice) || r.unitPrice < 0 ? 'Item price cannot be negative' : null,
  productionTasks: (r) => !isStr(r.orderId) ? 'Production entry must belong to an order' : null,
  payments: (r) => !isStr(r.orderId) ? 'Payment must belong to an order' : !isNum(r.amount) || r.amount <= 0 ? 'Payment amount must be positive'
    : !['payment', 'deposit', 'refund'].includes(r.type) ? 'Invalid payment type' : !isDate(r.date) ? 'Payment date is invalid' : null,
  expenses: (r) => !isNum(r.amount) || r.amount <= 0 ? 'Expense amount must be positive' : !isDate(r.date) ? 'Expense date is invalid' : !isStr(r.category) ? 'Expense category is required' : null,
  inventory: (r) => !isStr(r.name) ? 'Item name is required' : !isNum(r.quantity) || r.quantity < 0 ? 'Quantity cannot be negative' : !optNum(r.unitCost) ? 'Unit cost must be a number' : null,
  inventoryTransactions: (r) => !isStr(r.itemId) ? 'Movement must reference an item' : !['in', 'out', 'adjust'].includes(r.type) ? 'Invalid movement type' : !isNum(r.quantity) ? 'Movement quantity is invalid' : null,
  suppliers: (r) => !isStr(r.name) ? 'Supplier name is required' : null,
  appointments: (r) => !isStr(r.title) ? 'Appointment title is required' : !isDate(r.start) ? 'Appointment start is invalid' : (r.end && !isDate(r.end)) ? 'Appointment end is invalid' : null,
  notifications: (r) => !isStr(r.title) ? 'Notification title is required' : null,
  settings: (r) => !isStr(r.key) ? 'Setting key is required' : null,
  activityLogs: (r) => !isStr(r.action) ? 'Log action is required' : null,
  fabricLogs: (r) => !isStr(r.ruleId) ? 'Fabric log must reference a rule' : !isNum(r.actual) || r.actual <= 0 ? 'Actual quantity must be positive' : null,
};

export function validateRecord(store, record) {
  if (!record || typeof record !== 'object') return 'Record is not an object';
  if (store !== 'settings' && !isStr(record.id)) return 'Record id is missing';
  const rule = RULES[store];
  return rule ? rule(record) : `Unknown store: ${store}`;
}
