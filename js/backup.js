// Full JSON backup & validated, non-destructive restore.
import { exportAll, existingMaps, importRecords, getSetting } from './database.js';
import { buildBackup, validateBackup, planRestore, resolveRestore } from './core/backup-format.js';
import { STORES } from './core/schema.js';
import { download, todayISO } from './utils.js';
import { local } from './storage.js';
import { getState, loadState } from './state.js';
import { html, icon, openModal, toast, confirmDialog } from './ui.js';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createBackupFile() {
  const data = await exportAll();
  const backup = buildBackup(data, { business: getState().business?.name });
  backup.checksum = await sha256(JSON.stringify(backup.stores));
  return backup;
}

export async function downloadBackup({ silent = false } = {}) {
  const backup = await createBackupFile();
  const name = `fabriqon-backup-${(getState().business?.name || 'workspace').replace(/\W+/g, '-').toLowerCase()}-${todayISO()}.json`;
  download(JSON.stringify(backup), name, 'application/json');
  local.set('lastBackupAt', new Date().toISOString());
  if (!silent) toast('Backup downloaded. Keep it somewhere safe off this device.', { type: 'success', timeout: 6000 });
  return backup;
}

export async function readBackupFile(file) {
  if (!file) throw new Error('Choose a backup file.');
  if (file.size > 300 * 1024 * 1024) throw new Error('This file is too large to be a Fabriqon backup.');
  let json;
  try { json = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Is it a Fabriqon backup?'); }
  const v = validateBackup(json);
  if (json.checksum) {
    const actual = await sha256(JSON.stringify(json.stores));
    if (actual !== json.checksum) v.errors.unshift('Checksum mismatch — the file was modified or is corrupted.'), v.ok = false;
  } else v.warnings.push('Backup has no checksum (older or hand-made file); integrity could not be verified.');
  return { json, validation: v };
}

const LABELS = { customers: 'Customers', measurements: 'Measurements', measurementTemplates: 'Measurement templates', designs: 'Designs', orders: 'Orders', orderItems: 'Order items', productionTasks: 'Production updates', payments: 'Payments', expenses: 'Expenses', inventory: 'Inventory items', inventoryTransactions: 'Stock movements', suppliers: 'Suppliers', appointments: 'Appointments', notifications: 'Messages & notifications', settings: 'Settings', activityLogs: 'Activity log', fabricLogs: 'Fabric usage logs' };

/** Full restore flow: validate → preview plan → choose strategy → write. */
export async function restoreFlow(file) {
  const { json, validation } = await readBackupFile(file);
  if (!validation.ok) {
    openModal({ title: 'Backup cannot be restored', size: 'md', body: html`<div class="alert alert-danger">${icon('circle-alert', 18)}<div><strong>Nothing was changed.</strong>The file failed validation:</div></div><ul class="small mt-3">${validation.errors.map(e => html`<li>${e}</li>`)}</ul>` });
    return false;
  }
  const plan = planRestore(json, await existingMaps());
  const rows = STORES.filter(s => plan[s] && (plan[s].added.length || plan[s].conflicts.length || plan[s].identical));
  const totalNew = rows.reduce((n, s) => n + plan[s].added.length, 0);
  const totalConf = rows.reduce((n, s) => n + plan[s].conflicts.length, 0);

  return new Promise((resolve) => {
    const m = openModal({
      title: 'Restore backup', size: 'lg', onClose: (r) => resolve(r === true),
      body: html`
        <p class="small muted mb-3">Backup from <strong>${json.business || 'unknown business'}</strong>, made ${new Date(json.exportedAt).toLocaleString()}.</p>
        ${validation.warnings.length ? html`<div class="alert alert-warn mb-3">${icon('info', 18)}<div>${validation.warnings.slice(0, 4).map(w => html`<div>${w}</div>`)}</div></div>` : ''}
        <div class="table-wrap mb-4"><table class="table"><thead><tr><th>Data</th><th class="right">New</th><th class="right">Same</th><th class="right">Different</th></tr></thead><tbody>
          ${rows.map(s => html`<tr><td data-label="Data">${LABELS[s] || s}</td><td data-label="New" class="right num">${plan[s].added.length}</td><td data-label="Same" class="right num">${plan[s].identical}</td><td data-label="Different" class="right num ${plan[s].conflicts.length ? 'text-warning strong' : ''}">${plan[s].conflicts.length}</td></tr>`)}
        </tbody></table></div>
        <fieldset style="border:0;padding:0;margin:0" class="stack-sm"><legend class="strong small mb-2">How should records that exist in both places be handled? (${totalConf} differ)</legend>
          <label class="option-card"><input type="radio" name="strategy" value="keep-existing" checked><span>Keep what is on this device — only add the ${totalNew} new record(s)</span></label>
          <label class="option-card"><input type="radio" name="strategy" value="newer-wins"><span>Use whichever copy was updated most recently</span></label>
          <label class="option-card"><input type="radio" name="strategy" value="backup-wins"><span>Use the backup copy for all ${totalConf} differing record(s)</span></label>
          <label class="option-card"><input type="radio" name="strategy" value="replace"><span class="text-danger">Replace everything on this device with the backup</span></label>
        </fieldset>
        <p class="small subtle mt-3">Before any change, Fabriqon downloads a safety backup of the current data.</p>`,
      footer: html`<span class="spacer"></span><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Restore</button>`,
    });
    m.dialog.querySelector('[data-go]').addEventListener('click', async (e) => {
      const strategy = m.dialog.querySelector('[name=strategy]:checked').value;
      if (strategy === 'replace') {
        const ok = await confirmDialog({ title: 'Replace all data?', message: 'Every record on this device will be deleted and replaced by the backup. A safety backup of the current data will be downloaded first.', confirmLabel: 'Replace everything', danger: true, requireText: 'REPLACE' });
        if (!ok) return;
      }
      const btn = e.currentTarget;
      btn.disabled = true; btn.classList.add('loading');
      try {
        await downloadBackup({ silent: true });
        let n;
        if (strategy === 'replace') {
          const writes = Object.fromEntries(STORES.filter(s => Array.isArray(json.stores[s])).map(s => [s, json.stores[s]]));
          n = await importRecords(writes, { replace: true });
        } else {
          n = await importRecords(resolveRestore(plan, strategy));
        }
        await loadState(getSetting);
        local.set('lastRestoreAt', new Date().toISOString());
        toast(`Restore complete: ${n} record(s) written. A safety backup of the previous data was downloaded.`, { type: 'success', timeout: 8000 });
        m.close(true);
      } catch (err) {
        toast(`Restore failed — no changes were made. ${err.message}`, { type: 'error', timeout: 9000 });
        btn.disabled = false; btn.classList.remove('loading');
      }
    });
  });
}

