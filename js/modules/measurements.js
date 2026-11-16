// Body measurements: phone-friendly capture, versioned history, comparison,
// unit conversion, printable sheets and export.
import { html, icon, raw, field, toast, toastError, table, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog, validateForm, esc } from '../ui.js';
import { getAll, get, byIndex } from '../database.js';
import { saveMeasurement, deleteMeasurement } from '../services.js';
import { MEASUREMENT_FIELDS } from '../core/defaults.js';
import { convertLength, compareMeasurements, round } from '../core/calc.js';
import { fmtDate, debounce, byId } from '../utils.js';
import { getState } from '../state.js';
import { navigate } from '../router.js';
import { local } from '../storage.js';

export const fieldLabel = (key, tpl) => tpl?.labels?.[key] || MEASUREMENT_FIELDS[key]?.label || key;
const isAge = (key) => key === 'age';
const fmtVal = (v, unit, key) => v === null || v === undefined ? '—' : isAge(key) ? `${v} yrs` : `${round(v, 2)} ${unit}`;

export async function render(el, params, query) {
  if (location.hash.startsWith('#/measurements/new')) return renderCapture(el, query);
  if (params.id) return renderDetail(el, params.id);
  return renderList(el);
}

// ---------- List ----------
async function renderList(el) {
  el.innerHTML = String(skeleton(6));
  const [all, customers] = await Promise.all([getAll('measurements'), getAll('customers')]);
  const custs = byId(customers);
  // Latest record per customer + template.
  const latest = new Map();
  for (const m of all.sort((a, b) => b.takenAt.localeCompare(a.takenAt))) {
    const k = `${m.customerId}|${m.templateId}`;
    if (!latest.has(k)) latest.set(k, { ...m, versions: 0 });
    latest.get(k).versions++;
  }
  const rows = [...latest.values()];
  el.innerHTML = String(html`
    ${pageHeader({ title: 'Measurements', subtitle: 'Latest measurements per customer. Every update is kept as a new version.', actions: html`<a class="btn btn-secondary" href="#/settings?tab=templates">${icon('sliders-horizontal', 16)} Templates</a><a class="btn btn-primary" href="#/measurements/new">${icon('ruler', 16)} Take measurements</a>` })}
    <div class="toolbar"><div class="search">${icon('search', 16)}<label class="sr-only" for="m-q">Search</label><input id="m-q" class="input" type="search" placeholder="Search customer"></div></div>
    <div class="card" id="m-list"></div>`);
  const listEl = el.querySelector('#m-list');
  const paint = (q = '') => {
    const f = rows.filter(r => !q || (custs.get(r.customerId)?.nameLower || '').includes(q.toLowerCase()));
    if (!rows.length) { listEl.innerHTML = String(emptyState({ icon: 'ruler', title: 'No measurements yet', text: 'Record body measurements for a customer. Fabriqon keeps every version so you can compare changes over time.', action: html`<a class="btn btn-primary" href="#/measurements/new">Take measurements</a>` })); return; }
    listEl.innerHTML = String(f.length ? table({
      columns: [
        { label: 'Customer', cell: r => html`<div class="cell-main"><div><strong>${custs.get(r.customerId)?.name || 'Unknown'}</strong><small>${custs.get(r.customerId)?.code || ''}</small></div></div>` },
        { label: 'Template', cell: r => badge(r.templateName, 'gold') },
        { label: 'Taken', cell: r => fmtDate(r.takenAt) },
        { label: 'Versions', cls: 'right', cell: r => html`<span class="num">${r.versions}</span>` },
        { label: 'Fields', cls: 'right', cell: r => html`<span class="num">${Object.keys(r.values).length + r.custom.length}</span> <span class="subtle">${r.unit}</span>` },
        { label: '', cls: 'actions', cell: r => html`<a class="btn btn-ghost btn-sm" href="#/measurements/${r.id}">Open ${icon('chevron-right', 14)}</a>` },
      ],
      rows: f, rowAttrs: r => `data-href="#/measurements/${r.id}"`,
    }) : emptyState({ icon: 'search', title: 'No matches' }));
  };
  paint();
  el.querySelector('#m-q').addEventListener('input', debounce(e => paint(e.target.value.trim()), 120));
  return delegate(el, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; });
}

// ---------- Capture ----------
async function renderCapture(el, query) {
  el.innerHTML = String(skeleton(6));
  const [customers, templates, orders] = await Promise.all([getAll('customers'), getAll('measurementTemplates'), getAll('orders')]);
  const active = customers.filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name));
  templates.sort((a, b) => (a.builtIn === b.builtIn ? a.name.localeCompare(b.name) : a.builtIn ? -1 : 1));
  if (!active.length) {
    el.innerHTML = String(html`${pageHeader({ title: 'Take measurements', back: '#/measurements' })}<div class="card">${emptyState({ icon: 'users', title: 'Add a customer first', text: 'Measurements belong to a customer.', action: html`<a class="btn btn-primary" href="#/customers">Go to customers</a>` })}</div>`);
    return;
  }
  const from = query.from ? await get('measurements', query.from) : null;
  const st = {
    customerId: from?.customerId || query.customer || '',
    templateId: from?.templateId || query.template || '',
    unit: from?.unit || getState().business?.unit || 'cm',
    values: {}, custom: from ? from.custom.map(c => ({ ...c })) : [],
    notes: '', mode: local.get('measureMode', window.innerWidth < 700 ? 'focus' : 'grid'), idx: 0, prev: null,
  };
  if (from) st.values = { ...from.values };

  const loadPrev = async () => {
    st.prev = null;
    if (!st.customerId) return;
    const hist = (await byIndex('measurements', 'customerId', st.customerId)).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    if (!st.templateId) {
      const c = customers.find(x => x.id === st.customerId);
      const guess = hist[0]?.templateId || (c?.gender === 'Female' ? 'tpl-women' : c?.gender === 'Child' ? 'tpl-children' : 'tpl-men');
      st.templateId = templates.some(t => t.id === guess) ? guess : templates[0]?.id;
    }
    st.prev = hist.find(m => m.templateId === st.templateId) || null;
  };
  await loadPrev();
  const tpl = () => templates.find(t => t.id === st.templateId) || templates[0];
  const prevVal = (key) => {
    if (!st.prev || st.prev.values[key] === undefined) return null;
    return isAge(key) ? st.prev.values[key] : round(convertLength(st.prev.values[key], st.prev.unit, st.unit), 2);
  };
  const custOrders = () => orders.filter(o => o.customerId === st.customerId && !o.cancelled);

  const paint = () => {
    const t = tpl();
    const fields = t?.fields || [];
    st.idx = Math.min(st.idx, Math.max(0, fields.length - 1));
    el.innerHTML = String(html`
      ${pageHeader({ title: from ? 'Update measurements' : 'Take measurements', subtitle: 'A new version is saved each time — earlier records are never overwritten.', back: from ? `#/measurements/${from.id}` : '#/measurements' })}
      <form class="stack-lg" id="mform" novalidate>
        <div class="card card-pad"><div class="form">
          ${field({ label: 'Customer', name: 'customerId', type: 'select', required: true, value: st.customerId, options: [{ value: '', label: 'Choose a customer…' }, ...active.map(c => ({ value: c.id, label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}` }))] })}
          ${field({ label: 'Template', name: 'templateId', type: 'select', required: true, value: st.templateId, options: templates.map(x => ({ value: x.id, label: x.name })) })}
          ${field({ label: 'Unit', name: 'unit', type: 'select', value: st.unit, options: [{ value: 'cm', label: 'Centimetres (cm)' }, { value: 'in', label: 'Inches (in)' }] })}
          ${field({ label: 'Link to order (optional)', name: 'orderId', type: 'select', value: query.order || '', options: [{ value: '', label: 'Not linked' }, ...custOrders().map(o => ({ value: o.id, label: `${o.number} · ${o.title}` }))] })}
        </div>
        ${st.prev ? html`<p class="small muted mt-3">${icon('history', 14)} Previous ${st.prev.templateName} measurements from ${fmtDate(st.prev.takenAt)} are shown as hints.</p>` : ''}
        </div>

        <div class="card">
          <div class="card-header"><h2 class="card-title">${icon('ruler', 18)} ${t?.name || ''} measurements</h2>
            <div class="btn-group" role="group" aria-label="Entry mode">
              <button type="button" data-mode="focus" aria-pressed="${st.mode === 'focus'}">${icon('smartphone', 14)} One at a time</button>
              <button type="button" data-mode="grid" aria-pressed="${st.mode === 'grid'}">${icon('layout-grid', 14)} All fields</button>
            </div>
          </div>
          <div class="card-body">${st.mode === 'focus' && fields.length ? focusView(fields, t) : gridView(fields, t)}</div>
        </div>

        <div class="card">
          <div class="card-header"><h2 class="card-title">${icon('plus', 18)} Custom measurements</h2><button type="button" class="btn btn-secondary btn-sm" data-add-custom>${icon('plus', 14)} Add field</button></div>
          <div class="card-body stack-sm" id="custom-list">
            ${st.custom.length ? st.custom.map((c, i) => html`<div class="row" data-ci="${i}">
              <label class="sr-only" for="cl-${i}">Name</label><input class="input" id="cl-${i}" placeholder="e.g. Cap size" value="${c.label}" data-cl>
              <label class="sr-only" for="cv-${i}">Value</label><input class="input" id="cv-${i}" type="number" inputmode="decimal" step="any" min="0" style="max-width:120px" value="${c.value ?? ''}" data-cv>
              <button type="button" class="icon-btn" data-rm-custom aria-label="Remove field">${icon('trash-2', 16)}</button></div>`)
              : html`<p class="small subtle">Add anything not in the template — agbada cap, cuff width, etc.</p>`}
          </div>
        </div>

        <div class="card card-pad">${field({ label: 'Notes', name: 'notes', type: 'textarea', value: st.notes, placeholder: 'Posture, preferred fit (slim/loose), things to remember…' })}</div>
        <div class="row" style="justify-content:flex-end"><a class="btn btn-ghost" href="#/measurements">Cancel</a><button class="btn btn-primary btn-lg" type="submit">${icon('save', 18)} Save measurements</button></div>
      </form>`);
    const cur = el.querySelector('#mf-input');
    if (cur) cur.focus({ preventScroll: true });
  };

  const gridView = (fields, t) => fields.length ? html`<div class="measure-grid">${fields.map(k => {
    const p = prevVal(k);
    return html`<div class="m-field"><label for="mv-${k}">${fieldLabel(k, t)}${p !== null ? html`<span class="prev">was ${p}</span>` : ''}</label>
      <input id="mv-${k}" data-key="${k}" type="number" inputmode="decimal" step="any" min="0" max="${isAge(k) ? 18 : 400}" value="${st.values[k] ?? ''}" placeholder="${isAge(k) ? 'yrs' : st.unit}"></div>`;
  })}</div>` : html`<p class="subtle">This template has no fields. Edit it in Settings → Templates.</p>`;

  const focusView = (fields, t) => {
    const k = fields[st.idx];
    const p = prevVal(k);
    const filled = fields.filter(f => st.values[f] !== undefined && st.values[f] !== '').length;
    return html`<div class="measure-focus">
      <div class="small muted">${st.idx + 1} of ${fields.length} · ${filled} filled</div>
      <div class="progress w-full" style="max-width:380px"><span style="width:${(filled / fields.length) * 100}%"></span></div>
      <label class="mf-label" for="mf-input">${fieldLabel(k, t)}</label>
      <div class="mf-prev">${p !== null ? `Previous: ${fmtVal(p, st.unit, k)}` : 'No previous value'}</div>
      <div class="mf-input">
        <button type="button" class="mf-step" data-step="-0.5" aria-label="Decrease by 0.5">−</button>
        <input id="mf-input" data-key="${k}" type="number" inputmode="decimal" step="any" min="0" value="${st.values[k] ?? ''}" placeholder="${p ?? '0'}" enterkeyhint="next">
        <button type="button" class="mf-step" data-step="0.5" aria-label="Increase by 0.5">+</button>
      </div>
      <div class="small subtle">${isAge(k) ? 'years' : st.unit === 'cm' ? 'centimetres' : 'inches'}</div>
      <div class="mf-nav">
        <button type="button" class="btn btn-secondary" data-nav="-1" ${st.idx === 0 ? raw('disabled') : ''}>${icon('chevron-left', 18)} Back</button>
        ${p !== null ? html`<button type="button" class="btn btn-ghost" data-same title="Use previous value">Same</button>` : ''}
        <button type="button" class="btn btn-primary" data-nav="1">${st.idx === fields.length - 1 ? 'Done' : 'Next'} ${icon('chevron-right', 18)}</button>
      </div>
      <div class="mf-dots" role="group" aria-label="Jump to field">${fields.map((f, i) => html`<button type="button" data-jump="${i}" class="${st.values[f] !== undefined && st.values[f] !== '' ? 'filled' : ''} ${i === st.idx ? 'current' : ''}" aria-label="${fieldLabel(f, t)}" title="${fieldLabel(f, t)}"></button>`)}</div>
    </div>`;
  };

  const captureInputs = () => {
    el.querySelectorAll('[data-key]').forEach(inp => {
      if (inp.value === '') delete st.values[inp.dataset.key]; else st.values[inp.dataset.key] = Number(inp.value);
    });
    el.querySelectorAll('[data-ci]').forEach(row => {
      const i = Number(row.dataset.ci);
      st.custom[i] = { label: row.querySelector('[data-cl]').value, value: row.querySelector('[data-cv]').value === '' ? null : Number(row.querySelector('[data-cv]').value) };
    });
    const notes = el.querySelector('[name=notes]');
    if (notes) st.notes = notes.value;
  };

  paint();

  const onChange = async (e) => {
    const n = e.target.name;
    if (n === 'customerId' || n === 'templateId') {
      captureInputs();
      st[n] = e.target.value;
      if (n === 'customerId') st.templateId = '';
      await loadPrev();
      if (n === 'customerId' && !from) st.values = {};
      if (n === 'templateId') { const keys = new Set(tpl()?.fields || []); st.values = Object.fromEntries(Object.entries(st.values).filter(([k]) => keys.has(k))); }
      paint();
    } else if (n === 'unit') {
      captureInputs();
      const to = e.target.value;
      for (const k of Object.keys(st.values)) if (!isAge(k)) st.values[k] = round(convertLength(st.values[k], st.unit, to), 2);
      st.custom = st.custom.map(c => ({ ...c, value: c.value === null ? null : round(convertLength(c.value, st.unit, to), 2) }));
      st.unit = to;
      toast(`Values converted to ${to === 'cm' ? 'centimetres' : 'inches'}.`);
      paint();
    }
  };
  el.addEventListener('change', onChange);

  const onKey = (e) => {
    if (e.target.id === 'mf-input' && e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-nav="1"]')?.click(); }
  };
  el.addEventListener('keydown', onKey);

  const off = delegate(el, 'click', 'button', async (e, b) => {
    const fields = tpl()?.fields || [];
    if (b.dataset.mode) { captureInputs(); st.mode = b.dataset.mode; local.set('measureMode', st.mode); paint(); }
    else if (b.dataset.step) {
      const inp = el.querySelector('#mf-input');
      const base = inp.value === '' ? (prevVal(inp.dataset.key) ?? 0) : Number(inp.value);
      inp.value = Math.max(0, round(base + Number(b.dataset.step), 2));
    } else if (b.dataset.nav) {
      captureInputs();
      const next = st.idx + Number(b.dataset.nav);
      if (next >= fields.length) { el.querySelector('[name=notes]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.querySelector('[type=submit]').focus({ preventScroll: true }); return; }
      st.idx = Math.max(0, next); paint();
    } else if (b.hasAttribute('data-same')) {
      const inp = el.querySelector('#mf-input');
      inp.value = prevVal(inp.dataset.key);
      captureInputs();
      if (st.idx < fields.length - 1) { st.idx++; paint(); }
    } else if (b.dataset.jump) { captureInputs(); st.idx = Number(b.dataset.jump); paint(); }
    else if (b.hasAttribute('data-add-custom')) { captureInputs(); st.custom.push({ label: '', value: null }); paint(); el.querySelector(`#cl-${st.custom.length - 1}`)?.focus(); }
    else if (b.hasAttribute('data-rm-custom')) { captureInputs(); st.custom.splice(Number(b.closest('[data-ci]').dataset.ci), 1); paint(); }
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    captureInputs();
    if (!validateForm(form)) return;
    const bad = Object.entries(st.values).find(([k, v]) => !(v >= 0) || (!isAge(k) && v > 400));
    if (bad) { toastError(new Error(`${fieldLabel(bad[0], tpl())} looks wrong (${bad[1]}). Check the value.`)); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const t = tpl();
      const rec = await saveMeasurement({
        customerId: st.customerId, templateId: t.id, templateName: t.name, unit: st.unit, values: st.values,
        custom: st.custom, notes: st.notes, orderId: form.orderId.value, previousId: st.prev?.id || '',
      });
      toast('Measurements saved.', { type: 'success' });
      navigate(`/measurements/${rec.id}`);
    } catch (err) { toastError(err); btn.disabled = false; }
  };
  el.addEventListener('submit', onSubmit);
  return () => { off(); el.removeEventListener('change', onChange); el.removeEventListener('submit', onSubmit); el.removeEventListener('keydown', onKey); };
}

// ---------- Detail ----------
async function renderDetail(el, id) {
  el.innerHTML = String(skeleton(6));
  const m = await get('measurements', id);
  if (!m) { el.innerHTML = String(html`${pageHeader({ title: 'Measurement not found', back: '#/measurements' })}<div class="card">${emptyState({ icon: 'ruler', title: 'This record does not exist' })}</div>`); return; }
  const [customer, tplRec, history, order] = await Promise.all([get('customers', m.customerId), get('measurementTemplates', m.templateId), byIndex('measurements', 'customerId', m.customerId), m.orderId ? get('orders', m.orderId) : null]);
  const versions = history.filter(h => h.templateId === m.templateId).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const idx = versions.findIndex(v => v.id === id);
  const prev = versions[idx + 1] || null;
  let viewUnit = m.unit;
  let cmpId = prev?.id || '';

  const paint = () => {
    const conv = (rec, key) => rec?.values[key] === undefined ? null : isAge(key) ? rec.values[key] : round(convertLength(rec.values[key], rec.unit, viewUnit), 2);
    const other = versions.find(v => v.id === cmpId) || null;
    const keys = [...new Set([...(tplRec?.fields || []), ...Object.keys(m.values)])].filter(k => m.values[k] !== undefined || other?.values[k] !== undefined);
    const cur = Object.fromEntries(keys.map(k => [k, conv(m, k)]).filter(([, v]) => v !== null));
    const old = other ? Object.fromEntries(keys.map(k => [k, conv(other, k)]).filter(([, v]) => v !== null)) : {};
    const diffs = new Map(compareMeasurements(cur, old).map(d => [d.key, d]));
    el.innerHTML = String(html`
      ${pageHeader({
        title: `${customer?.name || 'Unknown customer'}`, back: customer ? `#/customers/${customer.id}?tab=measurements` : '#/measurements',
        subtitle: `${m.templateName} measurements · version ${m.version} · ${fmtDate(m.takenAt)}${idx > 0 ? ' · (older version)' : ''}`,
        actions: html`
          <button class="btn btn-secondary" data-act="pdf">${icon('printer', 16)} Print sheet</button>
          <button class="btn btn-secondary" data-act="xlsx">${icon('file-spreadsheet', 16)} Export</button>
          <a class="btn btn-primary" href="#/measurements/new?from=${m.id}">${icon('pencil', 16)} Update (new version)</a>`,
      })}
      ${idx > 0 ? html`<div class="alert alert-warn mb-4">${icon('history', 18)}<div>You are viewing an older version. <a class="strong" href="#/measurements/${versions[0].id}">Open the latest</a>.</div></div>` : ''}
      <div class="dash-grid">
        <div class="card span-8">
          <div class="card-header" style="flex-wrap:wrap">
            <h2 class="card-title">${icon('ruler', 18)} Values</h2>
            <div class="row-wrap">
              ${versions.length > 1 ? html`<label class="sr-only" for="cmp">Compare with</label><select id="cmp" class="input" style="width:auto;min-height:34px;font-size:var(--fs-xs)">
                <option value="">No comparison</option>${versions.filter(v => v.id !== id).map(v => html`<option value="${v.id}" ${v.id === cmpId ? raw('selected') : ''}>Compare with v${v.version} (${fmtDate(v.takenAt)})</option>`)}</select>` : ''}
              <div class="btn-group" role="group" aria-label="Display unit"><button data-unit="cm" aria-pressed="${viewUnit === 'cm'}">cm</button><button data-unit="in" aria-pressed="${viewUnit === 'in'}">in</button></div>
            </div>
          </div>
          ${table({
            columns: [
              { label: 'Measurement', cell: k => html`<strong>${fieldLabel(k, tplRec)}</strong>` },
              { label: 'Value', cls: 'right', cell: k => html`<span class="num strong">${fmtVal(cur[k] ?? null, viewUnit, k)}</span>` },
              ...(other ? [
                { label: `v${other.version}`, cls: 'right', cell: k => html`<span class="num subtle">${fmtVal(old[k] ?? null, viewUnit, k)}</span>` },
                { label: 'Change', cls: 'right', cell: k => { const d = diffs.get(k)?.delta; return d === null || d === undefined ? html`<span class="subtle">—</span>` : d === 0 ? html`<span class="subtle">same</span>` : html`<span class="num strong ${d > 0 ? 'cmp-up' : 'cmp-down'}">${d > 0 ? '+' : ''}${d}</span>`; } },
              ] : []),
            ],
            rows: keys,
          })}
          ${m.custom.length ? html`<div class="card-body" style="border-top:1px solid var(--border)"><h3 class="small strong mb-2">Custom</h3><dl class="kv">${m.custom.map(c => html`<dt>${c.label}</dt><dd class="num">${round(convertLength(c.value, m.unit, viewUnit), 2)} ${viewUnit}</dd>`)}</dl></div>` : ''}
        </div>
        <div class="span-4 stack">
          <div class="card card-pad"><dl class="kv">
            <dt>Customer</dt><dd>${customer ? html`<a href="#/customers/${customer.id}">${customer.name}</a>` : '—'}</dd>
            <dt>Recorded in</dt><dd>${m.unit === 'cm' ? 'Centimetres' : 'Inches'}</dd>
            <dt>Order</dt><dd>${order ? html`<a href="#/orders/${order.id}">${order.number}</a>` : 'Not linked'}</dd>
            <dt>Notes</dt><dd style="white-space:pre-wrap">${m.notes || '—'}</dd></dl>
            <div class="row-wrap mt-4"><a class="btn btn-secondary btn-sm" href="#/orders/new?customer=${m.customerId}&measurement=${m.id}">${icon('plus', 14)} Use in new order</a><button class="btn btn-danger-ghost btn-sm" data-act="delete">${icon('trash-2', 14)} Delete</button></div>
          </div>
          <div class="card"><div class="card-header"><h2 class="card-title">${icon('history', 18)} Version history</h2></div>
            <ul class="list">${versions.map(v => html`<li><a class="list-item" href="#/measurements/${v.id}" ${v.id === id ? raw('aria-current="true" style="background:var(--surface-2)"') : ''}><span class="list-main"><strong>Version ${v.version}</strong><small>${fmtDate(v.takenAt)} · ${v.unit}</small></span>${v === versions[0] ? badge('Latest', 'success') : ''}</a></li>`)}</ul>
          </div>
        </div>
      </div>`);
  };
  paint();

  const offs = [
    delegate(el, 'click', '[data-unit]', (e, b) => { viewUnit = b.dataset.unit; paint(); }),
    delegate(el, 'change', '#cmp', (e, s) => { cmpId = s.value; paint(); }),
    delegate(el, 'click', '[data-act]', async (e, b) => {
      try {
        const ex = await import('../exports.js');
        if (b.dataset.act === 'pdf') await ex.measurementSheetPdf(m, customer, tplRec, viewUnit);
        if (b.dataset.act === 'xlsx') {
          const keys = Object.keys(m.values);
          ex.exportRows(`measurements-${(customer?.name || 'customer').replace(/\W+/g, '-')}-v${m.version}`, [
            ...keys.map(k => ({ Measurement: fieldLabel(k, tplRec), Value: isAge(k) ? m.values[k] : round(convertLength(m.values[k], m.unit, viewUnit), 2), Unit: isAge(k) ? 'years' : viewUnit })),
            ...m.custom.map(c => ({ Measurement: c.label, Value: round(convertLength(c.value, m.unit, viewUnit), 2), Unit: viewUnit })),
          ]);
        }
        if (b.dataset.act === 'delete') {
          const ok = await confirmDialog({ title: 'Delete this measurement version?', message: `Version ${m.version} from ${fmtDate(m.takenAt)} will be removed permanently. Other versions are kept.`, confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await deleteMeasurement(id);
          toast('Measurement deleted.', { type: 'success' });
          navigate(versions[idx === 0 ? 1 : 0] ? `/measurements/${versions[idx === 0 ? 1 : 0].id}` : `/customers/${m.customerId}?tab=measurements`);
        }
      } catch (err) { toastError(err); }
    }),
  ];
  return () => offs.forEach(f => f());
}

