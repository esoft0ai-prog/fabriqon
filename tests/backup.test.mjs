import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, validateBackup, planRestore, resolveRestore } from '../js/core/backup-format.js';
import { validateRecord, STORES, DB_VERSION, MIGRATIONS } from '../js/core/schema.js';

const customer = (id, name, updatedAt = '2026-11-01T00:00:00Z') => ({ id, code: `CUS-${id}`, name, createdAt: '2026-10-01T00:00:00Z', updatedAt });

test('every store has a migration path up to the current version', () => {
  for (let v = 1; v <= DB_VERSION; v++) assert.equal(typeof MIGRATIONS[v], 'function', `migration ${v}`);
  assert.ok(STORES.includes('fabricLogs'));
});

test('record validation catches bad data', () => {
  assert.equal(validateRecord('customers', customer('1', 'Ada')), null);
  assert.match(validateRecord('customers', { id: '1', code: 'C', name: '  ' }), /name/);
  assert.match(validateRecord('payments', { id: 'p', orderId: 'o', amount: -5, type: 'payment', date: '2026-11-01' }), /positive/);
  assert.match(validateRecord('payments', { id: 'p', orderId: 'o', amount: 5, type: 'gift', date: '2026-11-01' }), /type/);
  assert.match(validateRecord('measurements', { id: 'm', customerId: 'c', unit: 'mm', values: {} }), /cm or in/);
  assert.match(validateRecord('measurements', { id: 'm', customerId: 'c', unit: 'cm', values: { chest: -1 } }), /positive/);
  assert.match(validateRecord('inventory', { id: 'i', name: 'Lace', quantity: -1 }), /negative/);
  assert.equal(validateRecord('settings', { key: 'business', value: {} }), null);
  assert.match(validateRecord('nope', { id: 'x' }), /Unknown store/);
});

test('a built backup validates and counts records', () => {
  const b = buildBackup({ customers: [customer('1', 'Ada'), customer('2', 'Bola')] }, { business: 'Test' });
  assert.equal(b.format, 'fabriqon-backup');
  assert.equal(b.counts.customers, 2);
  const v = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(v.ok, true, v.errors.join('; '));
});

test('invalid backups are rejected as a whole', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ format: 'other', schemaVersion: 1, stores: {} }).ok, false);
  const newer = buildBackup({});
  newer.schemaVersion = DB_VERSION + 1;
  assert.match(validateBackup(newer).errors.join(), /newer version/);
  const corrupt = buildBackup({ customers: [customer('1', 'Ada'), { id: '2', code: 'C2' }] });
  const v = validateBackup(corrupt);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /customers #2/);
  const dup = buildBackup({ customers: [customer('1', 'Ada'), customer('1', 'Ada again')] });
  assert.match(validateBackup(dup).errors.join(), /duplicate/);
  const truncated = buildBackup({ customers: [customer('1', 'Ada')] });
  truncated.counts.customers = 5;
  assert.match(validateBackup(truncated).errors.join(), /truncated/);
});

test('restore plan separates new, identical and conflicting records', () => {
  const backup = buildBackup({ customers: [customer('1', 'Ada'), customer('2', 'Bola (edited)', '2026-11-10T00:00:00Z'), customer('3', 'Chidi')] });
  const existing = { customers: new Map([['1', customer('1', 'Ada')], ['2', customer('2', 'Bola', '2026-11-05T00:00:00Z')]]) };
  const plan = planRestore(backup, existing);
  assert.equal(plan.customers.added.length, 1);
  assert.equal(plan.customers.identical, 1);
  assert.equal(plan.customers.conflicts.length, 1);
});

test('restore strategies never overwrite silently', () => {
  const backup = buildBackup({ customers: [customer('2', 'Bola (backup)', '2026-11-10T00:00:00Z'), customer('4', 'Dayo'), customer('5', 'Old', '2026-01-01T00:00:00Z')] });
  const existing = { customers: new Map([['2', customer('2', 'Bola (device)', '2026-11-05T00:00:00Z')], ['5', customer('5', 'Newer on device', '2026-11-12T00:00:00Z')]]) };
  const plan = planRestore(backup, existing);
  assert.deepEqual(resolveRestore(plan, 'keep-existing').customers.map(c => c.id), ['4']);
  assert.deepEqual(resolveRestore(plan, 'newer-wins').customers.map(c => c.id).sort(), ['2', '4']);
  assert.deepEqual(resolveRestore(plan, 'backup-wins').customers.map(c => c.id).sort(), ['2', '4', '5']);
  assert.throws(() => resolveRestore(plan, 'yolo'));
});

test('restoring never moves numbering counters backwards', () => {
  const backup = buildBackup({ settings: [{ key: 'seq:customer', value: 8 }, { key: 'seq:receipt', value: 30 }, { key: 'business', value: { name: 'Old' } }] });
  const existing = { settings: new Map([['seq:customer', { key: 'seq:customer', value: 9 }], ['seq:receipt', { key: 'seq:receipt', value: 12 }], ['business', { key: 'business', value: { name: 'New' } }]]) };
  const plan = planRestore(backup, existing);
  for (const strategy of ['keep-existing', 'newer-wins', 'backup-wins']) {
    const w = resolveRestore(plan, strategy).settings;
    assert.equal(w.find(s => s.key === 'seq:customer'), undefined, `${strategy}: higher device counter kept`);
    assert.equal(w.find(s => s.key === 'seq:receipt').value, 30, `${strategy}: higher backup counter applied`);
  }
  assert.equal(resolveRestore(plan, 'keep-existing').settings.some(s => s.key === 'business'), false);
});
