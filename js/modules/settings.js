// Settings: business profile, preferences, templates, workflow, staff,
// security (PIN), AI endpoint, and data/backup tools.
import { html, icon, raw, field, formModal, toast, toastError, table, pageHeader, badge, delegate, confirmDialog, validateForm, readForm } from '../ui.js';
import { getAll, setSetting, put, add, remove, checkIntegrity, wipeAll } from '../database.js';
import { CURRENCIES, MEASUREMENT_FIELDS, DEFAULT_STAGES, BUSINESS_TYPES } from '../core/defaults.js';
import { DB_VERSION } from '../core/schema.js';
import { getState } from '../state.js';
import { readImage, fmtDate, timeAgo } from '../utils.js';
import { local, storageEstimate, requestPersistence, bytes } from '../storage.js';
import { getThemePref, setThemePref } from '../theme.js';
import { hashPin, verifyPin } from '../lock.js';
import { canInstall, promptInstall, isStandalone } from '../pwa.js';
import { validateEndpoint } from '../ai.js';

const TABS = [['business', 'Business', 'house'], ['preferences', 'Preferences', 'sliders-horizontal'], ['templates', 'Measurement templates', 'ruler'], ['workflow', 'Workflow', 'square-kanban'], ['staff', 'Staff', 'users'], ['security', 'Security', 'lock'], ['ai', 'AI', 'sparkles'], ['data', 'Data & backup', 'hard-drive']];
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);

export async function render(el, params, query) {
  const tab = TABS.some(t => t[0] === query.tab) ? query.tab : 'business';
  el.innerHTML = String(html`
    ${pageHeader({ title: 'Settings', subtitle: 'Configure Fabriqon for how your workshop runs' })}
    <div class="tabs" role="tablist">${TABS.map(([k, l, ic]) => html`<a class="tab" role="tab" href="#/settings?tab=${k}" aria-selected="${tab === k}">${icon(ic, 15)} ${l}</a>`)}</div>
    <section id="set-body"></section>`);
  const body = el.querySelector('#set-body');
  const fn = { business, preferences, templates, workflow, staff, security, ai, data }[tab];
  return fn(body, () => render(el, params, query));
}

// ---------- Business ----------
function business(el) {
  const b = getState().business || {};
  let logo = b.logo || '';
  el.innerHTML = String(html`<div class="card"><div class="card-body"><form class="form" id="biz" novalidate>
    <div class="field span-2"><label>Logo</label><div class="row"><div class="photo-strip" id="logo">${logo ? html`<div class="ph"><img src="${logo}" alt="Business logo"><button type="button" data-rm aria-label="Remove logo">${icon('x', 12)}</button></div>` : ''}</div>
      <label class="upload-tile" style="position:relative">${icon('upload', 18)}<span>Upload</span><input type="file" accept="image/png,image/jpeg,image/webp" id="logo-in"></label></div><p class="field-hint">Shown on invoices, receipts and in the sidebar.</p></div>
    ${field({ label: 'Business name', name: 'name', value: b.name, required: true })}
    ${field({ label: 'Business type', name: 'type', type: 'select', value: b.type, options: BUSINESS_TYPES })}
    ${field({ label: 'Owner name', name: 'owner', value: b.owner })}
    ${field({ label: 'Phone', name: 'phone', type: 'tel', value: b.phone })}
    ${field({ label: 'Email', name: 'email', type: 'email', value: b.email })}
    ${field({ label: 'Address', name: 'address', value: b.address })}
    ${field({ label: 'City', name: 'city', value: b.city })}
    ${field({ label: 'State', name: 'state', value: b.state })}
    ${field({ label: 'Country', name: 'country', value: b.country })}
    ${field({ label: 'Phone country code', name: 'countryCode', value: b.countryCode || '234', attrs: 'pattern="\\d{1,4}"', hint: 'Used to build WhatsApp links' })}
    <div class="span-2 row"><span class="spacer"></span><button class="btn btn-primary" type="submit">${icon('save', 16)} Save profile</button></div>
  </form></div></div>`);
  const paintLogo = () => { el.querySelector('#logo').innerHTML = logo ? String(html`<div class="ph"><img src="${logo}" alt="Business logo"><button type="button" data-rm aria-label="Remove logo">${icon('x', 12)}</button></div>`) : ''; };
  el.querySelector('#logo-in').addEventListener('change', async (e) => { try { logo = await readImage(e.target.files[0], { maxDim: 400 }); paintLogo(); } catch (err) { toastError(err); } });
  el.querySelector('#logo').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { logo = ''; paintLogo(); } });
  el.querySelector('#biz').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    try {
      const next = { ...getState().business, ...readForm(e.target), logo };
      await setSetting('business', next);
      getState().business = next;
      toast('Business profile saved.', { type: 'success' });
    } catch (err) { toastError(err); }
  });
}

// ---------- Preferences ----------
function preferences(el) {
  const b = getState().business || {};
  const p = getState().prefs;
  el.innerHTML = String(html`<div class="card"><div class="card-body"><form class="form" id="prefs" novalidate>
    <div class="form-section">Money &amp; units</div>
    ${field({ label: 'Currency', name: 'currency', type: 'select', value: b.currency || 'NGN', options: CURRENCIES.map(c => ({ value: c.code, label: c.label })), hint: 'Changes how amounts are displayed; existing figures are not converted.' })}
    ${field({ label: 'Default body measurement unit', name: 'unit', type: 'select', value: b.unit || 'cm', options: [{ value: 'cm', label: 'Centimetres' }, { value: 'in', label: 'Inches' }] })}
    ${field({ label: 'Default fabric unit', name: 'fabricUnit', type: 'select', value: b.fabricUnit || 'yards', options: ['yards', 'metres'] })}
    <div class="form-section">Appearance</div>
    ${field({ label: 'Theme', name: 'theme', type: 'select', value: getThemePref(), options: [{ value: 'system', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] })}
    <div class="form-section">Reminders</div>
    ${field({ label: 'Remind me to back up every (days)', name: 'backupReminderDays', type: 'number', value: p.backupReminderDays, attrs: 'min="1" max="90" step="1"', required: true })}
    <div class="span-2 row"><span class="spacer"></span><button class="btn btn-primary" type="submit">${icon('save', 16)} Save preferences</button></div>
  </form></div></div>`);
  el.querySelector('[name=theme]').addEventListener('change', (e) => setThemePref(e.target.value));
  el.querySelector('#prefs').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    const d = readForm(e.target);
    try {
      const nextB = { ...getState().business, currency: d.currency, unit: d.unit, fabricUnit: d.fabricUnit };
      const nextP = { ...getState().prefs, backupReminderDays: d.backupReminderDays };
      await setSetting('business', nextB); await setSetting('prefs', nextP);
      getState().business = nextB; getState().prefs = nextP;
      toast('Preferences saved.', { type: 'success' });
    } catch (err) { toastError(err); }
  });
}

// ---------- Measurement templates ----------
async function templates(el, reload) {
  const list = (await getAll('measurementTemplates')).sort((a, b) => (a.builtIn === b.builtIn ? a.name.localeCompare(b.name) : a.builtIn ? -1 : 1));
  const all = await getAll('measurements');
  const used = (id) => all.filter(m => m.templateId === id).length;
  el.innerHTML = String(html`<div class="row mb-3"><p class="small muted">Built-in templates can be copied and customised. Custom fields you add appear when taking measurements.</p><span class="spacer"></span><button class="btn btn-primary btn-sm" data-new>${icon('plus', 14)} New template</button></div>
    <div class="card">${table({ columns: [
      { label: 'Template', cell: t => html`<strong>${t.name}</strong> ${t.builtIn ? badge('Built-in', 'neutral') : badge('Custom', 'gold')}` },
      { label: 'Fields', cell: t => html`<span class="small">${t.fields.map(k => t.labels?.[k] || MEASUREMENT_FIELDS[k]?.label || k).join(', ')}</span>` },
      { label: 'Records', cls: 'right', cell: t => used(t.id) },
      { label: '', cls: 'actions', cell: t => html`<button class="icon-btn sm" data-copy="${t.id}" aria-label="Copy ${t.name}" title="Copy">${icon('copy', 16)}</button>${t.builtIn ? '' : html`<button class="icon-btn sm" data-edit="${t.id}" aria-label="Edit ${t.name}">${icon('pencil', 16)}</button><button class="icon-btn sm" data-del="${t.id}" aria-label="Delete ${t.name}">${icon('trash-2', 16)}</button>`}` },
    ], rows: list })}</div>`);

  const form = (tpl, isCopy = false) => formModal({
    title: tpl && !isCopy ? `Edit ${tpl.name}` : 'New measurement template', size: 'lg', submitLabel: 'Save template',
    body: html`
      ${field({ label: 'Template name', name: 'name', value: isCopy ? `${tpl.name} (custom)` : tpl?.name, required: true })}
      ${field({ label: 'Group', name: 'group', type: 'select', value: tpl?.group || 'custom', options: [{ value: 'men', label: 'Men' }, { value: 'women', label: 'Women' }, { value: 'children', label: 'Children' }, { value: 'custom', label: 'Other' }] })}
      <fieldset class="field span-2" style="border:0;padding:0;margin:0"><legend class="small strong mb-2">Standard fields</legend><div class="row-wrap">
        ${Object.entries(MEASUREMENT_FIELDS).map(([k, f]) => html`<label class="chip" style="cursor:pointer"><input type="checkbox" name="f_${k}" ${tpl?.fields.includes(k) ? raw('checked') : ''} style="accent-color:var(--primary)"> ${f.label}</label>`)}</div></fieldset>
      ${field({ label: 'Extra custom fields', name: 'extra', type: 'textarea', full: true, value: (tpl?.fields || []).filter(k => !MEASUREMENT_FIELDS[k]).map(k => tpl.labels?.[k] || k).join('\n'), hint: 'One per line, e.g. Agbada cap, Cuff width, Lap' })}`,
    onSubmit: async (d) => {
      const std = Object.keys(MEASUREMENT_FIELDS).filter(k => d[`f_${k}`]);
      const labels = {};
      const extra = (d.extra || '').split('\n').map(s => s.trim()).filter(Boolean).map(lbl => { const k = `x_${slug(lbl)}`; labels[k] = lbl; return k; });
      const fields = [...new Set([...std, ...extra])];
      if (!fields.length) throw new Error('Choose at least one field.');
      const rec = { name: d.name.trim(), group: d.group, fields, labels, builtIn: false };
      return tpl && !isCopy ? put('measurementTemplates', { ...tpl, ...rec }) : add('measurementTemplates', rec);
    },
  });

  return delegate(el, 'click', '[data-new],[data-copy],[data-edit],[data-del]', async (e, b) => {
    try {
      const t = list.find(x => x.id === (b.dataset.copy || b.dataset.edit || b.dataset.del));
      if (b.hasAttribute('data-new')) { if (await form(null)) reload(); }
      else if (b.dataset.copy) { if (await form(t, true)) reload(); }
      else if (b.dataset.edit) { if (await form(t)) reload(); }
      else if (b.dataset.del) {
        if (used(t.id)) throw new Error(`${used(t.id)} measurement record(s) use this template. It cannot be deleted.`);
        if (!(await confirmDialog({ title: `Delete ${t.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        await remove('measurementTemplates', t.id); reload();
      }
    } catch (err) { toastError(err); }
  });
}

// ---------- Workflow ----------
async function workflow(el, reload) {
  const orders = await getAll('orders');
  let stages = getState().stages.map(s => ({ ...s }));
  const inUse = (key) => orders.filter(o => o.status === key && !o.cancelled).length;
  const paint = () => {
    el.innerHTML = String(html`<div class="card"><div class="card-header"><h2 class="card-title">${icon('square-kanban', 18)} Production stages</h2><button class="btn btn-ghost btn-sm" data-reset>${icon('undo-2', 14)} Defaults</button></div>
      <div class="card-body stack-sm">
        <p class="small muted">Rename, reorder or add stages to match how your workshop runs. The last stage means “delivered/completed”. A stage with active orders cannot be removed.</p>
        ${stages.map((s, i) => html`<div class="row" data-i="${i}">
          <span class="badge badge-neutral" style="min-width:28px;justify-content:center">${i + 1}</span>
          <label class="sr-only" for="st-${i}">Stage ${i + 1} name</label><input id="st-${i}" class="input" value="${s.label}" data-label maxlength="40">
          <button class="icon-btn sm" data-up ${i === 0 ? raw('disabled') : ''} aria-label="Move up">${icon('chevron-left', 16, 'rot90')}</button>
          <button class="icon-btn sm" data-down ${i === stages.length - 1 ? raw('disabled') : ''} aria-label="Move down">${icon('chevron-right', 16, 'rot90')}</button>
          <button class="icon-btn sm" data-rm ${inUse(s.key) || stages.length <= 2 ? raw('disabled') : ''} aria-label="Remove stage" title="${inUse(s.key) ? `${inUse(s.key)} active order(s)` : 'Remove'}">${icon('trash-2', 16)}</button></div>`)}
        <div class="row mt-2"><button class="btn btn-secondary btn-sm" data-add>${icon('plus', 14)} Add stage</button><span class="spacer"></span><button class="btn btn-primary" data-save>${icon('save', 16)} Save workflow</button></div>
      </div></div>`);
  };
  paint();
  const sync = () => el.querySelectorAll('[data-label]').forEach((inp, i) => { stages[i].label = inp.value.trim() || stages[i].label; });
  return delegate(el, 'click', 'button', async (e, b) => {
    const row = b.closest('[data-i]');
    const i = row ? Number(row.dataset.i) : -1;
    sync();
    if (b.hasAttribute('data-up')) { [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; paint(); }
    else if (b.hasAttribute('data-down')) { [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]]; paint(); }
    else if (b.hasAttribute('data-rm')) { stages.splice(i, 1); paint(); }
    else if (b.hasAttribute('data-add')) { stages.splice(stages.length - 1, 0, { key: `custom_${Date.now().toString(36)}`, label: 'New stage' }); paint(); el.querySelector(`#st-${stages.length - 2}`).select(); }
    else if (b.hasAttribute('data-reset')) {
      const missing = getState().stages.filter(s => !DEFAULT_STAGES.some(d => d.key === s.key) && inUse(s.key));
      if (missing.length) { toastError(new Error(`Move orders out of “${missing[0].label}” first.`)); return; }
      stages = DEFAULT_STAGES.map(s => ({ ...s })); paint();
    } else if (b.hasAttribute('data-save')) {
      const orphan = getState().stages.find(s => !stages.some(n => n.key === s.key) && inUse(s.key));
      if (orphan) { toastError(new Error(`“${orphan.label}” has active orders.`)); return; }
      try { await setSetting('stages', stages); getState().stages = stages; toast('Workflow saved.', { type: 'success' }); reload(); } catch (err) { toastError(err); }
    }
  });
}

// ---------- Staff ----------
function staff(el, reload) {
  const list = getState().staff;
  const ROLES = ['Owner', 'Admin', 'Tailor', 'Apprentice', 'Finisher', 'Other'];
  el.innerHTML = String(html`
    <div class="alert mb-4">${icon('info', 18)}<div>Staff are used for assigning jobs and tracking who did what. Because Fabriqon stores data on this device only, there are no separate staff logins or server-enforced permissions — anyone using this device can see everything. Use the app PIN to stop casual access.</div></div>
    <div class="row mb-3"><span class="spacer"></span><button class="btn btn-primary btn-sm" data-add>${icon('user-plus', 14)} Add staff member</button></div>
    <div class="card">${list.length ? table({ columns: [
      { label: 'Name', cell: s => html`<strong>${s.name}</strong>${s.active === false ? html` ${badge('Inactive', 'neutral')}` : ''}` },
      { label: 'Role', cell: s => s.role }, { label: 'Phone', cell: s => s.phone || '—' },
      { label: '', cls: 'actions', cell: s => html`<button class="icon-btn sm" data-edit="${s.id}" aria-label="Edit ${s.name}">${icon('pencil', 16)}</button><button class="icon-btn sm" data-del="${s.id}" aria-label="Remove ${s.name}">${icon('trash-2', 16)}</button>` },
    ], rows: list }) : html`<div class="empty"><div class="empty-icon">${icon('users', 28)}</div><h3>No staff added</h3><p>Add tailors and apprentices to assign them jobs on the production board.</p></div>`}</div>`);
  const form = (s = {}) => formModal({
    title: s.id ? `Edit ${s.name}` : 'Add staff member',
    body: html`${field({ label: 'Name', name: 'name', value: s.name, required: true })}${field({ label: 'Role', name: 'role', type: 'select', value: s.role || 'Tailor', options: ROLES })}${field({ label: 'Phone', name: 'phone', type: 'tel', value: s.phone })}${field({ label: 'Active', name: 'active', type: 'checkbox', value: s.active !== false })}`,
    onSubmit: async (d) => {
      const next = s.id ? list.map(x => (x.id === s.id ? { ...x, ...d } : x)) : [...list, { id: `staff-${Date.now().toString(36)}`, ...d }];
      await setSetting('staff', next); getState().staff = next;
    },
  });
  return delegate(el, 'click', '[data-add],[data-edit],[data-del]', async (e, b) => {
    try {
      if (b.hasAttribute('data-add')) { if (await form()) reload(); }
      else if (b.dataset.edit) { if (await form(list.find(x => x.id === b.dataset.edit))) reload(); }
      else {
        const s = list.find(x => x.id === b.dataset.del);
        const assigned = (await getAll('orders')).filter(o => o.assignedTo === s.id && !o.cancelled).length;
        if (assigned) { const ok = await confirmDialog({ title: `${s.name} has ${assigned} order(s)`, message: 'Mark them inactive instead? They will be hidden from assignment lists but history keeps their name.', confirmLabel: 'Mark inactive' }); if (!ok) return; const next = list.map(x => (x.id === s.id ? { ...x, active: false } : x)); await setSetting('staff', next); getState().staff = next; reload(); return; }
        if (!(await confirmDialog({ title: `Remove ${s.name}?`, confirmLabel: 'Remove', danger: true }))) return;
        const next = list.filter(x => x.id !== s.id); await setSetting('staff', next); getState().staff = next; reload();
      }
    } catch (err) { toastError(err); }
  });
}

// ---------- Security ----------
function security(el, reload) {
  const pin = getState().pin;
  el.innerHTML = String(html`<div class="card"><div class="card-body stack">
    <div class="alert alert-warn">${icon('shield-check', 18)}<div><strong>What the PIN does — and doesn't do</strong>The PIN stops someone casually opening Fabriqon on this device. It is not encryption and is not the same as an account login: someone with full access to this browser profile (or its developer tools) can still read the stored data. For stronger protection, use your device's screen lock and keep backups private.</div></div>
    <div class="between"><div><strong>App PIN</strong><p class="small muted">${pin ? 'A PIN is set.' : 'No PIN set.'}</p></div>
      <div class="row">${pin ? html`<button class="btn btn-secondary" data-change>Change PIN</button><button class="btn btn-danger-ghost" data-remove>Remove</button>` : html`<button class="btn btn-primary" data-set>Set a PIN</button>`}</div></div>
    ${pin ? html`<form class="form" id="lockpref"><div class="form-section">Auto-lock</div>${field({ label: 'Lock after inactivity (minutes, 0 = never)', name: 'lockAfterMinutes', type: 'number', value: getState().prefs.lockAfterMinutes, attrs: 'min="0" max="240" step="1"' })}<div class="row" style="align-self:end"><button class="btn btn-secondary" type="submit">Save</button></div></form>` : ''}
  </div></div>`);
  const pinForm = (needOld) => formModal({
    title: needOld ? 'Change PIN' : 'Set a PIN', submitLabel: 'Save PIN',
    body: html`${needOld ? field({ label: 'Current PIN', name: 'old', type: 'password', required: true, attrs: 'inputmode="numeric" autocomplete="current-password"', full: true }) : ''}
      ${field({ label: 'New PIN (4–8 digits)', name: 'pin', type: 'password', required: true, attrs: 'inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password"' })}
      ${field({ label: 'Confirm new PIN', name: 'pin2', type: 'password', required: true, attrs: 'inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password"' })}`,
    onSubmit: async (d) => {
      if (needOld && !(await verifyPin(d.old, getState().pin))) throw new Error('Current PIN is incorrect.');
      if (d.pin !== d.pin2) throw new Error('The PINs do not match.');
      const rec = await hashPin(d.pin);
      await setSetting('pin', rec); getState().pin = rec;
    },
  });
  el.querySelector('#lockpref')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = { ...getState().prefs, lockAfterMinutes: readForm(e.target).lockAfterMinutes || 0 };
    await setSetting('prefs', next); getState().prefs = next; toast('Auto-lock saved.', { type: 'success' });
  });
  return delegate(el, 'click', '[data-set],[data-change],[data-remove]', async (e, b) => {
    try {
      if (b.hasAttribute('data-set') || b.hasAttribute('data-change')) { if (await pinForm(b.hasAttribute('data-change'))) { toast('PIN saved. The lock button is in the top bar after reload.', { type: 'success' }); reload(); } }
      else {
        const r = await formModal({ title: 'Remove PIN', submitLabel: 'Remove PIN', danger: true, body: field({ label: 'Current PIN', name: 'old', type: 'password', required: true, full: true, attrs: 'inputmode="numeric"' }),
          onSubmit: async (d) => { if (!(await verifyPin(d.old, getState().pin))) throw new Error('Current PIN is incorrect.'); await remove('settings', 'pin'); getState().pin = null; } });
        if (r) { toast('PIN removed.', { type: 'success' }); reload(); }
      }
    } catch (err) { toastError(err); }
  });
}

// ---------- AI ----------
function ai(el) {
  el.innerHTML = String(html`<div class="card"><div class="card-body stack">
    <p class="small">Fabriqon works fully without AI. To enable AI answers and design concepts, run the small proxy included in <span class="code">server/ai-proxy.mjs</span> on a server you control. The proxy keeps your provider API key on the server — <strong>never paste an API key into the app</strong>.</p>
    <form class="form" id="aiform" novalidate>
      ${field({ label: 'Proxy URL', name: 'endpoint', type: 'url', value: getState().aiEndpoint, full: true, placeholder: 'https://your-server.example.com/api/assistant', hint: 'Must be https:// (http://localhost allowed for testing). Leave empty to disable AI.' })}
      <div class="span-2 row"><span class="spacer"></span><button class="btn btn-secondary" type="button" data-test>Test connection</button><button class="btn btn-primary" type="submit">Save</button></div>
    </form>
    <div id="ai-out" aria-live="polite"></div></div></div>`);
  const out = el.querySelector('#ai-out');
  const form = el.querySelector('#aiform');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const v = form.endpoint.value.trim();
      const url = v ? validateEndpoint(v) : '';
      await setSetting('aiEndpoint', url); getState().aiEndpoint = url;
      toast(url ? 'AI proxy saved.' : 'AI disabled.', { type: 'success' });
    } catch (err) { toastError(err); }
  });
  return delegate(el, 'click', '[data-test]', async () => {
    try {
      const url = validateEndpoint(form.endpoint.value.trim());
      out.innerHTML = String(html`<p class="small muted">Testing…</p>`);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'ping', messages: [{ role: 'user', content: 'ping' }] }) });
      const data = await res.json().catch(() => ({}));
      out.innerHTML = String(res.ok && typeof data.reply === 'string' ? html`<div class="alert alert-success">${icon('circle-check', 18)}<div>Connected. The proxy responded correctly.</div></div>` : html`<div class="alert alert-danger">${icon('circle-alert', 18)}<div>The proxy responded with status ${res.status} but not the expected <span class="code">{ reply }</span> format.</div></div>`);
    } catch (err) { out.innerHTML = String(html`<div class="alert alert-danger">${icon('circle-alert', 18)}<div>${err.message}</div></div>`); }
  });
}

// ---------- Data & backup ----------
async function data(el, reload) {
  const [est, integ] = await Promise.all([storageEstimate(), checkIntegrity().catch(err => ({ ok: false, issues: [{ level: 'error', text: err.message }], counts: {} }))]);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const lastBackup = local.get('lastBackupAt');
  const total = Object.values(integ.counts || {}).reduce((a, b) => a + b, 0);
  el.innerHTML = String(html`<div class="dash-grid">
    <div class="card span-12"><div class="card-body">
      <div class="alert alert-warn">${icon('hard-drive', 18)}<div><strong>Your data is stored only in this browser on this device.</strong>It does not sync to your phone, laptop or other browsers, and it is lost if you clear site data, reset the device or uninstall the browser. Download a backup regularly and keep it off the device (email it to yourself, cloud drive, USB). To move to a new device, restore the backup there.</div></div>
    </div></div>
    <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('download', 18)} Backup</h2></div><div class="card-body stack">
      <p class="small ${lastBackup ? 'muted' : 'text-warning strong'}">${lastBackup ? `Last backup: ${fmtDate(lastBackup)} (${timeAgo(lastBackup)})` : 'You have not downloaded a backup yet.'}</p>
      <button class="btn btn-primary" data-backup>${icon('download', 16)} Download full backup (.json)</button>
      <button class="btn btn-secondary" data-xlsx>${icon('file-spreadsheet', 16)} Export all data to Excel</button>
      <p class="small subtle">The JSON backup contains everything, including photos, and can be restored. The Excel export is for reading and analysis only.</p>
    </div></div>
    <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('upload', 18)} Restore</h2></div><div class="card-body stack">
      <label class="dropzone" id="drop" tabindex="0">${icon('upload', 22)}<div class="strong mt-2">Choose a Fabriqon backup file</div><div class="small">or drop it here</div><input type="file" accept="application/json,.json" id="restore-in" class="sr-only"></label>
      <p class="small subtle">The file is checked before anything changes. You'll see what is new or different and choose how to merge. Nothing is overwritten silently.</p>
    </div></div>
    <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('database', 18)} Storage</h2></div><div class="card-body stack">
      ${est ? html`<div><div class="between small"><span>Used ${bytes(est.usage)}</span><span class="subtle">of ~${bytes(est.quota)} available</span></div><div class="meter mt-2 ${est.pct > 80 ? 'danger' : est.pct > 50 ? 'warn' : ''}"><span style="width:${Math.max(1, est.pct)}%"></span></div></div>` : html`<p class="small muted">Storage usage is not available in this browser.</p>`}
      <div class="between"><span class="small">Persistent storage</span>${persisted ? badge('Granted', 'success') : html`<span class="row">${badge('Not granted', 'warning')}<button class="btn btn-ghost btn-sm" data-persist>Request</button></span>`}</div>
      <p class="small subtle">${persisted ? 'The browser will not clear Fabriqon data automatically when space is low.' : 'Without it, the browser may clear data under storage pressure. Installing the app usually grants it.'}</p>
      <div class="between"><span class="small">Install as app</span>${isStandalone() ? badge('Installed', 'success') : canInstall() ? html`<button class="btn btn-secondary btn-sm" data-install>${icon('monitor', 14)} Install</button>` : html`<span class="small subtle">Use your browser menu → “Install app” / “Add to Home Screen”</span>`}</div>
    </div></div>
    <div class="card span-6"><div class="card-header"><h2 class="card-title">${icon('shield-check', 18)} Database health</h2><button class="btn btn-ghost btn-sm" data-check>${icon('refresh-cw', 14)} Re-check</button></div><div class="card-body stack">
      <div class="between"><span class="small">Status</span>${integ.ok ? badge('Healthy', 'success') : badge('Needs attention', 'danger')}</div>
      <div class="between small"><span>Schema version</span><span class="num">${integ.version || DB_VERSION}</span></div>
      <div class="between small"><span>Records stored</span><span class="num">${total}</span></div>
      ${integ.issues.length ? html`<ul class="small" style="padding-left:18px;margin:0">${integ.issues.map(i => html`<li class="${i.level === 'error' ? 'text-danger' : 'text-warning'}">${i.text}</li>`)}</ul>` : html`<p class="small text-success">${icon('circle-check', 14)} No problems found.</p>`}
    </div></div>
    <div class="card span-12"><div class="card-header"><h2 class="card-title" style="color:var(--danger)">${icon('triangle-alert', 18)} Danger zone</h2></div><div class="card-body between" style="flex-wrap:wrap">
      <p class="small muted">Erase every record on this device and start again. Download a backup first.</p>
      <button class="btn btn-danger" data-wipe>${icon('trash-2', 16)} Erase all data</button></div></div>
  </div>`);

  const input = el.querySelector('#restore-in');
  const drop = el.querySelector('#drop');
  const doRestore = async (file) => {
    try { if (await (await import('../backup.js')).restoreFlow(file)) location.reload(); } catch (err) { toastError(err); }
    input.value = '';
  };
  input.addEventListener('change', () => input.files[0] && doRestore(input.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) doRestore(f); });

  return delegate(el, 'click', '[data-backup],[data-xlsx],[data-persist],[data-install],[data-check],[data-wipe]', async (e, b) => {
    try {
      if (b.hasAttribute('data-backup')) { await (await import('../backup.js')).downloadBackup(); reload(); }
      else if (b.hasAttribute('data-xlsx')) await exportAllExcel();
      else if (b.hasAttribute('data-persist')) { const r = await requestPersistence(); toast(r.persisted ? 'Persistent storage granted.' : 'The browser did not grant persistent storage. Installing the app often helps.', { type: r.persisted ? 'success' : 'warning', timeout: 6000 }); reload(); }
      else if (b.hasAttribute('data-install')) { await promptInstall(); reload(); }
      else if (b.hasAttribute('data-check')) reload();
      else if (b.hasAttribute('data-wipe')) {
        const ok = await confirmDialog({ title: 'Erase all Fabriqon data?', message: `This permanently deletes all ${total} records — customers, measurements, orders, payments and settings — from this device. It cannot be undone.\n\nA final backup will be downloaded first.`, confirmLabel: 'Erase everything', danger: true, requireText: 'ERASE' });
        if (!ok) return;
        await (await import('../backup.js')).downloadBackup({ silent: true });
        await wipeAll();
        local.remove('lastBackupAt');
        location.hash = '#/dashboard';
        location.reload();
      }
    } catch (err) { toastError(err); }
  });
}

async function exportAllExcel() {
  const { exportAll } = await import('../database.js');
  const all = await exportAll();
  const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !['photo', 'photos', 'images', 'logo', 'nameLower', 'readFlag'].includes(k)).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : v]));
  const sheets = {};
  for (const [s, rows] of Object.entries(all)) if (s !== 'settings') sheets[s] = rows.map(strip);
  await (await import('../exports.js')).exportWorkbook('fabriqon-all-data', sheets);
  toast('Excel export downloaded.', { type: 'success' });
}

