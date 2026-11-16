// Backup file format, validation and restore planning. Pure functions.
import { STORES, DB_VERSION, validateRecord } from './schema.js';

export const BACKUP_FORMAT = 'fabriqon-backup';

export function buildBackup(data, meta = {}) {
  const stores = {};
  for (const s of STORES) stores[s] = Array.isArray(data[s]) ? data[s] : [];
  return {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    business: meta.business || null,
    counts: Object.fromEntries(STORES.map(s => [s, stores[s].length])),
    stores,
  };
}

/**
 * Validates a parsed backup. Returns { ok, errors[], warnings[], counts }.
 * Invalid records are reported (up to a limit) and the whole file is rejected
 * so a partially corrupt backup never lands in the database.
 */
export function validateBackup(json) {
  const errors = [];
  const warnings = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['File is not a JSON object.'], warnings, counts: {} };
  if (json.format !== BACKUP_FORMAT) errors.push('This is not a Fabriqon backup file.');
  if (typeof json.schemaVersion !== 'number') errors.push('Backup has no schema version.');
  else if (json.schemaVersion > DB_VERSION) errors.push(`Backup was made by a newer version of Fabriqon (schema ${json.schemaVersion}). Update the app first.`);
  if (!json.stores || typeof json.stores !== 'object') {
    errors.push('Backup has no data section.');
    return { ok: false, errors, warnings, counts: {} };
  }
  const counts = {};
  let bad = 0;
  for (const [store, records] of Object.entries(json.stores)) {
    if (!STORES.includes(store)) { warnings.push(`Unknown section “${store}” will be ignored.`); continue; }
    if (!Array.isArray(records)) { errors.push(`Section “${store}” is not a list.`); continue; }
    counts[store] = records.length;
    const seen = new Set();
    records.forEach((r, i) => {
      const err = validateRecord(store, r);
      const key = store === 'settings' ? r?.key : r?.id;
      if (!err && seen.has(key)) {
        if (bad++ < 20) errors.push(`${store} #${i + 1}: duplicate id ${key}`);
      } else if (err) {
        if (bad++ < 20) errors.push(`${store} #${i + 1}: ${err}`);
      }
      seen.add(key);
    });
    if (json.counts && typeof json.counts[store] === 'number' && json.counts[store] !== records.length) {
      errors.push(`Section “${store}” has ${records.length} records but the file says ${json.counts[store]} — the file may be truncated.`);
    }
  }
  if (bad > 20) errors.push(`…and ${bad - 20} more invalid records.`);
  for (const s of STORES) if (!(s in json.stores)) warnings.push(`Backup has no “${s}” section (older backup) — nothing will change there.`);
  return { ok: errors.length === 0, errors, warnings, counts };
}

const stable = (o) => JSON.stringify(o, Object.keys(o).sort());

/**
 * Compares backup records with existing ones.
 * existing: { store: Map(key -> record) }
 * Returns per store: { added: [], identical: n, conflicts: [{incoming, current}] }
 */
export function planRestore(backup, existing) {
  const plan = {};
  for (const store of STORES) {
    const incoming = backup.stores[store];
    if (!Array.isArray(incoming)) continue;
    const current = existing[store] || new Map();
    const p = { added: [], identical: 0, conflicts: [] };
    for (const rec of incoming) {
      const key = store === 'settings' ? rec.key : rec.id;
      const cur = current.get(key);
      if (!cur) p.added.push(rec);
      else if (stable(cur) === stable(rec)) p.identical++;
      else p.conflicts.push({ incoming: rec, current: cur });
    }
    plan[store] = p;
  }
  return plan;
}

/**
 * Resolves conflicts with an explicit strategy.
 *  'keep-existing' — never overwrite; only add new records.
 *  'newer-wins'    — overwrite only when the backup copy has a later updatedAt.
 *  'backup-wins'   — overwrite all conflicts with the backup copy.
 * Returns { store: records[] } to write.
 */
export function resolveRestore(plan, strategy) {
  if (!['keep-existing', 'newer-wins', 'backup-wins'].includes(strategy)) throw new Error('Unknown restore strategy');
  const writes = {};
  for (const [store, p] of Object.entries(plan)) {
    const out = [...p.added];
    for (const c of p.conflicts) {
      // Numbering counters (seq:*) must never move backwards, whatever the
      // strategy, or new records would reuse existing order/receipt numbers.
      if (store === 'settings' && String(c.incoming.key).startsWith('seq:')) {
        const max = Math.max(Number(c.incoming.value) || 0, Number(c.current.value) || 0);
        if (max !== c.current.value) out.push({ ...c.incoming, value: max });
        continue;
      }
      if (strategy === 'backup-wins') out.push(c.incoming);
      else if (strategy === 'newer-wins') {
        const a = Date.parse(c.incoming.updatedAt || c.incoming.createdAt || 0) || 0;
        const b = Date.parse(c.current.updatedAt || c.current.createdAt || 0) || 0;
        if (a > b) out.push(c.incoming);
      }
    }
    writes[store] = out;
  }
  return writes;
}
