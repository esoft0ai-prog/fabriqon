// IndexedDB data layer: versioned schema, validated CRUD, transactions,
// sequences, change events and integrity checks.
import { DB_NAME, DB_VERSION, MIGRATIONS, STORES, validateRecord } from './core/schema.js';

let dbPromise = null;
const bus = new EventTarget();

export class DbError extends Error {
  constructor(message, cause) { super(message); this.name = 'DbError'; this.cause = cause; }
}

const friendly = (err) => {
  if (!err) return 'Unknown database error';
  if (err.name === 'QuotaExceededError') return 'Device storage is full. Free up space or export and remove old photos.';
  if (err.name === 'ConstraintError') return 'A record with the same unique value already exists.';
  if (err.name === 'VersionError') return 'This browser holds data from a newer Fabriqon version. Reload the latest app.';
  return err.message || String(err);
};

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(new DbError(friendly(req.error), req.error));
});

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(new DbError(friendly(tx.error), tx.error));
  tx.onerror = () => reject(new DbError(friendly(tx.error), tx.error));
});

export function openDb() {
  if (dbPromise) return dbPromise;
  if (!('indexedDB' in globalThis)) return Promise.reject(new DbError('This browser does not support IndexedDB, which Fabriqon needs to store data.'));
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, req.transaction);
    };
    req.onblocked = () => reject(new DbError('Fabriqon is open in another tab with an older version. Close other tabs and reload.'));
    req.onerror = () => reject(new DbError(friendly(req.error), req.error));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        bus.dispatchEvent(new CustomEvent('versionchange'));
      };
      resolve(db);
    };
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export const onDbEvent = (type, fn) => { bus.addEventListener(type, fn); return () => bus.removeEventListener(type, fn); };
const emitChange = (stores) => bus.dispatchEvent(new CustomEvent('change', { detail: { stores } }));

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const now = () => new Date().toISOString();

/** Adds derived index fields (lower-cased names for case-insensitive lookup). */
function decorate(store, rec) {
  if ('name' in rec && typeof rec.name === 'string') rec.nameLower = rec.name.trim().toLowerCase();
  if (store === 'notifications') rec.readFlag = rec.read ? 1 : 0;
  return rec;
}

function prepare(store, rec, isNew) {
  const r = { ...rec };
  if (store !== 'settings') {
    if (!r.id) r.id = uid();
    if (isNew && !r.createdAt) r.createdAt = now();
    r.updatedAt = now();
  }
  decorate(store, r);
  const err = validateRecord(store, r);
  if (err) throw new DbError(err);
  return r;
}

/**
 * Runs fn inside a single transaction over `stores`. fn receives a handle with
 * promise-returning get/getAll/byIndex/add/put/delete bound to that
 * transaction; only await these inside fn so the transaction stays alive.
 * Everything commits or nothing does.
 */
export async function transaction(stores, fn, mode = 'readwrite') {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = txDone(tx);
  const os = (s) => tx.objectStore(s);
  const touched = new Set();
  const t = {
    get: (s, key) => reqP(os(s).get(key)),
    getAll: (s) => reqP(os(s).getAll()),
    byIndex: (s, index, value) => reqP(os(s).index(index).getAll(value)),
    add: async (s, rec) => { const r = prepare(s, rec, true); await reqP(os(s).add(r)); touched.add(s); return r; },
    put: async (s, rec) => { const r = prepare(s, rec, false); await reqP(os(s).put(r)); touched.add(s); return r; },
    putRaw: async (s, rec) => { const err = validateRecord(s, rec); if (err) throw new DbError(`${s}: ${err}`); await reqP(os(s).put(decorate(s, { ...rec }))); touched.add(s); return rec; },
    delete: async (s, key) => { await reqP(os(s).delete(key)); touched.add(s); },
    clear: async (s) => { await reqP(os(s).clear()); touched.add(s); },
  };
  let result;
  try {
    result = await fn(t);
  } catch (err) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => {});
    throw err instanceof DbError ? err : new DbError(friendly(err), err);
  }
  await done;
  if (touched.size) emitChange([...touched]);
  return result;
}

// ---------- Simple CRUD ----------
export const get = (store, key) => transaction([store], (t) => t.get(store, key), 'readonly');
export const getAll = (store) => transaction([store], (t) => t.getAll(store), 'readonly');
export const byIndex = (store, index, value) => transaction([store], (t) => t.byIndex(store, index, value), 'readonly');
export const add = (store, rec) => transaction([store], (t) => t.add(store, rec));
export const put = (store, rec) => transaction([store], (t) => t.put(store, rec));
export const remove = (store, key) => transaction([store], (t) => t.delete(store, key));

export async function count(store) {
  const db = await openDb();
  return reqP(db.transaction(store).objectStore(store).count());
}

/** Range query over an index, e.g. dates between from and to (inclusive). */
export async function range(store, index, from, to) {
  const db = await openDb();
  const r = from && to ? IDBKeyRange.bound(from, to) : from ? IDBKeyRange.lowerBound(from) : to ? IDBKeyRange.upperBound(to) : null;
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(r));
}

/** Latest n records by an index (descending). */
export async function latest(store, index, n = 10) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store).objectStore(store).index(index).openCursor(null, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (c && out.length < n) { out.push(c.value); c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(new DbError(friendly(req.error), req.error));
  });
}

// ---------- Settings ----------
export async function getSetting(key, fallback = null) {
  const r = await get('settings', key);
  return r === undefined ? fallback : r.value;
}
export const setSetting = (key, value) => put('settings', { key, value });

/** Atomically increments a named counter (inside an existing tx handle). */
export async function nextSequence(t, name) {
  const rec = await t.get('settings', `seq:${name}`);
  const n = (rec?.value || 0) + 1;
  await t.put('settings', { key: `seq:${name}`, value: n });
  return n;
}

// ---------- Activity log ----------
export const logActivity = (t, action, entity, entityId, summary) =>
  t.add('activityLogs', { action, entity, entityId, summary, at: now() });

// ---------- Bulk ----------
export async function exportAll() {
  return transaction(STORES, async (t) => {
    const out = {};
    for (const s of STORES) out[s] = await t.getAll(s);
    return out;
  }, 'readonly');
}

export async function existingMaps() {
  const all = await exportAll();
  const maps = {};
  for (const [s, recs] of Object.entries(all)) maps[s] = new Map(recs.map(r => [s === 'settings' ? r.key : r.id, r]));
  return maps;
}

/** Writes already-validated records ({store: records[]}); optional full replace. */
export async function importRecords(writes, { replace = false } = {}) {
  const stores = STORES.filter(s => writes[s]);
  return transaction(stores, async (t) => {
    let n = 0;
    for (const s of stores) {
      if (replace) await t.clear(s);
      for (const r of writes[s]) { await t.putRaw(s, r); n++; }
    }
    return n;
  });
}

export async function wipeAll() {
  return transaction(STORES, async (t) => { for (const s of STORES) await t.clear(s); });
}

// ---------- Integrity ----------
export async function checkIntegrity() {
  const db = await openDb();
  const issues = [];
  const missingStores = STORES.filter(s => !db.objectStoreNames.contains(s));
  if (missingStores.length) issues.push({ level: 'error', text: `Missing stores: ${missingStores.join(', ')}` });
  const all = await exportAll();
  const ids = (s) => new Set(all[s].map(r => r.id));
  const customers = ids('customers'), orders = ids('orders'), items = ids('inventory');
  const orphan = (store, field, set, label) => {
    const bad = all[store].filter(r => r[field] && !set.has(r[field]));
    if (bad.length) issues.push({ level: 'warn', text: `${bad.length} ${label} reference a record that no longer exists.` });
  };
  orphan('measurements', 'customerId', customers, 'measurement(s)');
  orphan('orders', 'customerId', customers, 'order(s)');
  orphan('orderItems', 'orderId', orders, 'order line(s)');
  orphan('payments', 'orderId', orders, 'payment(s)');
  orphan('inventoryTransactions', 'itemId', items, 'stock movement(s)');
  let invalid = 0;
  for (const s of STORES) for (const r of all[s]) if (validateRecord(s, r)) invalid++;
  if (invalid) issues.push({ level: 'error', text: `${invalid} record(s) fail validation.` });
  const negative = all.inventory.filter(i => i.quantity < 0).length;
  if (negative) issues.push({ level: 'error', text: `${negative} inventory item(s) have negative stock.` });
  const counts = Object.fromEntries(STORES.map(s => [s, all[s].length]));
  return { ok: !issues.some(i => i.level === 'error'), issues, counts, version: db.version };
}
