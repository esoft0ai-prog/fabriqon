// Fabric estimator: configurable per-garment rules, width scaling, waste
// allowance, cost, and calibration from logged actual consumption.
import { html, icon, raw, field, formModal, toast, toastError, table, pageHeader, badge, delegate, skeleton, confirmDialog } from '../ui.js';
import { getAll, byIndex, setSetting } from '../database.js';
import { logFabricUsage } from '../services.js';
import { estimateFabric, calibrationFromLogs } from '../core/fabric-engine.js';
import { MEASUREMENT_FIELDS, DEFAULT_FABRIC_RULES, FABRIC_WIDTHS, FABRIC_TYPES } from '../core/defaults.js';
import { convertLength, round } from '../core/calc.js';
import { money, fmtDate, copyText, todayISO, groupBy } from '../utils.js';
import { getState } from '../state.js';
import { local } from '../storage.js';

const label = (k) => MEASUREMENT_FIELDS[k]?.label || k;

async function saveRules(rules) {
  await setSetting('fabricRules', rules);
  getState().fabricRules = rules;
}

async function openRuleForm(rule = null) {
  const r = rule || { id: `rule-${Date.now().toString(36)}`, garment: '', terms: [{ key: 'shirtLength', factor: 2 }], allowanceCm: 20, refWidthCm: 150, fallbackCm: 200, wastePct: 10, calibration: 1 };
  const keys = Object.keys(MEASUREMENT_FIELDS).filter(k => k !== 'age');
  return formModal({
    title: rule ? `Edit rule · ${rule.garment}` : 'New fabric rule', size: 'lg', submitLabel: 'Save rule',
    body: html`
      <p class="span-2 small muted">Length needed = Σ (factor × measurement) + allowance, at the reference fabric width. Narrower fabric scales the length up proportionally. Set factors to match how <em>you</em> lay out and cut this garment.</p>
      ${field({ label: 'Garment name', name: 'garment', value: r.garment, required: true, full: true })}
      <div class="field span-2"><label>Length terms (factor × measurement)</label>
        <div class="stack-sm">${keys.map(k => {
          const t = r.terms.find(x => x.key === k);
          return t || ['shirtLength', 'sleeve', 'trouserLength', 'dressLength', 'skirtLength', 'blouseLength'].includes(k)
            ? html`<div class="row"><label class="small" style="flex:1" for="tf-${k}">${label(k)}</label><input id="tf-${k}" class="input" style="max-width:110px" type="number" step="0.25" min="0" max="10" name="tf_${k}" value="${t?.factor ?? 0}"></div>` : '';
        })}</div><p class="field-hint">Use 0 to ignore a measurement.</p></div>
      ${field({ label: 'Allowance (cm)', name: 'allowanceCm', type: 'number', value: r.allowanceCm, attrs: 'min="0"', hint: 'Seams, hems, facings' })}
      ${field({ label: 'Reference fabric width (cm)', name: 'refWidthCm', type: 'number', value: r.refWidthCm, attrs: 'min="50"', required: true })}
      ${field({ label: 'Fallback length when measurements are missing (cm)', name: 'fallbackCm', type: 'number', value: r.fallbackCm, attrs: 'min="0"', required: true })}
      ${field({ label: 'Waste allowance (%)', name: 'wastePct', type: 'number', value: r.wastePct, attrs: 'min="0" max="100"' })}
      ${field({ label: 'Calibration factor', name: 'calibration', type: 'number', value: r.calibration ?? 1, attrs: 'min="0.3" max="3" step="0.01"', hint: '1 = no correction. Learned from your actual usage logs.' })}`,
    onSubmit: async (d) => {
      const terms = keys.filter(k => Number(d[`tf_${k}`]) > 0).map(k => ({ key: k, factor: Number(d[`tf_${k}`]) }));
      if (!terms.length) throw new Error('Add at least one measurement term with a factor above 0.');
      const updated = { ...r, garment: d.garment.trim(), terms, allowanceCm: d.allowanceCm || 0, refWidthCm: d.refWidthCm, fallbackCm: d.fallbackCm, wastePct: d.wastePct || 0, calibration: d.calibration || 1 };
      const rules = [...getState().fabricRules];
      const i = rules.findIndex(x => x.id === r.id);
      if (i >= 0) rules[i] = updated; else rules.push(updated);
      await saveRules(rules);
      return updated;
    },
  });
}

export async function render(el) {
  el.innerHTML = String(html`${pageHeader({ title: 'Fabric Calculator' })}${skeleton(6)}`);
  const [customers, logs] = await Promise.all([getAll('customers'), getAll('fabricLogs')]);
  const biz = getState().business || {};
  const saved = local.get('fabricCalc', {});
  const st = {
    ruleId: saved.ruleId || getState().fabricRules[0]?.id, customerId: '', measurementId: '', measurements: [],
    unit: biz.unit || 'cm', manual: {}, widthCm: saved.widthCm || 150, garments: 1, sizeAdjustPct: 0, extraAllowanceCm: 0,
    outputUnit: (biz.fabricUnit || 'yards') === 'metres' ? 'm' : 'yd', price: '', fabricType: '',
  };
  const rule = () => getState().fabricRules.find(r => r.id === st.ruleId) || getState().fabricRules[0];
  const logsBy = groupBy(logs, l => l.ruleId);

  const compute = () => {
    const r = rule();
    if (!r) return null;
    const mRec = st.measurements.find(m => m.id === st.measurementId);
    const values = mRec ? Object.fromEntries(Object.entries(mRec.values).map(([k, v]) => [k, convertLength(v, mRec.unit, st.unit)])) : {};
    for (const [k, v] of Object.entries(st.manual)) if (v !== '' && v !== null && v !== undefined) values[k] = Number(v);
    return estimateFabric(r, { measurements: values, unit: st.unit, fabricWidthCm: st.widthCm, garments: st.garments, sizeAdjustPct: st.sizeAdjustPct, extraAllowanceCm: st.extraAllowanceCm, outputUnit: st.outputUnit, pricePerUnit: st.price });
  };

  const paintResult = () => {
    const box = el.querySelector('#fc-result');
    let res;
    try { res = compute(); } catch (err) { box.innerHTML = String(html`<div class="alert alert-danger">${icon('circle-alert', 18)}<div>${err.message}</div></div>`); return; }
    if (!res) return;
    const u = st.outputUnit === 'm' ? 'metres' : 'yards';
    box.innerHTML = String(html`
      <span class="estimate-tag">${icon('triangle-alert', 14)} Estimate — not a confirmed quantity</span>
      <div class="result-hero mt-2"><span class="big">${res.quantity}</span><span class="muted">${u} to buy</span></div>
      <p class="small muted">for ${st.garments} × ${res.garment}${st.fabricType ? ` in ${st.fabricType}` : ''}</p>
      <dl class="kv mt-4">
        <dt>Per garment</dt><dd class="num">${res.perGarment} ${u}</dd>
        <dt>Net for all garments</dt><dd class="num">${res.net} ${u}</dd>
        <dt>Waste allowance (${rule().wastePct}%)</dt><dd class="num">${res.waste} ${u}</dd>
        <dt>Width adjustment</dt><dd>${res.widthFactor > 1 ? `×${res.widthFactor} (fabric narrower than ${rule().refWidthCm} cm)` : 'none'}</dd>
        ${res.calibration !== 1 ? html`<dt>Your calibration</dt><dd>×${res.calibration}</dd>` : ''}
        ${st.price ? html`<dt>Estimated fabric cost</dt><dd class="num strong">${money(res.cost)}</dd>` : ''}
      </dl>
      ${res.usedFallback ? html`<div class="alert alert-warn mt-4">${icon('info', 18)}<div><strong>Typical size used.</strong>Missing: ${res.missing.map(label).join(', ')}. Enter these measurements for a closer estimate.</div></div>` : html`<p class="small subtle mt-3">Based on: ${res.used.map(u2 => `${u2.factor}× ${label(u2.key)} (${round(u2.cm, 1)} cm)`).join(' + ')} + ${rule().allowanceCm} cm allowance.</p>`}
      <p class="small subtle mt-3">Actual needs depend on the pattern, print/nap direction, matching, cutting layout and your technique. Confirm before buying.</p>
      <div class="row-wrap mt-4"><button class="btn btn-secondary btn-sm" data-act="copy">${icon('copy', 14)} Copy</button><button class="btn btn-ghost btn-sm" data-act="log">${icon('ruler', 14)} Log actual usage</button></div>`);
  };

  const paint = () => {
    const r = rule();
    const mRec = st.measurements.find(m => m.id === st.measurementId);
    const rulesWithLogs = getState().fabricRules.map(x => ({ ...x, logs: logsBy[x.id] || [], learned: calibrationFromLogs(logsBy[x.id] || [], x.calibration) }));
    el.innerHTML = String(html`
      ${pageHeader({ title: 'Fabric Calculator', subtitle: 'Estimate how much fabric to buy, using rules you control' })}
      <div class="dash-grid">
        <div class="card span-7"><div class="card-header"><h2 class="card-title">${icon('calculator', 18)} Inputs</h2></div><div class="card-body">
          <form class="form" id="fc-form" novalidate>
            ${field({ label: 'Garment / style rule', name: 'ruleId', type: 'select', value: st.ruleId, options: getState().fabricRules.map(x => ({ value: x.id, label: x.garment })), full: true })}
            ${field({ label: 'Customer (optional)', name: 'customerId', type: 'select', value: st.customerId, options: [{ value: '', label: 'Enter measurements manually' }, ...customers.filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }))] })}
            ${st.customerId ? field({ label: 'Measurement record', name: 'measurementId', type: 'select', value: st.measurementId, options: [{ value: '', label: st.measurements.length ? 'Choose…' : 'No measurements for this customer' }, ...st.measurements.map(m => ({ value: m.id, label: `${m.templateName} v${m.version} · ${fmtDate(m.takenAt)}` }))] }) : field({ label: 'Measurement unit', name: 'unit', type: 'select', value: st.unit, options: [{ value: 'cm', label: 'cm' }, { value: 'in', label: 'inches' }] })}
            <div class="form-section">Measurements used by this rule</div>
            ${r.terms.map(t => {
              const fromRec = mRec?.values[t.key] !== undefined ? round(convertLength(mRec.values[t.key], mRec.unit, st.unit), 1) : '';
              return field({ label: `${label(t.key)} (${st.unit})`, name: `m_${t.key}`, type: 'number', value: st.manual[t.key] ?? fromRec, attrs: 'min="0"', placeholder: fromRec ? '' : 'not set' });
            })}
            <div class="form-section">Fabric</div>
            ${field({ label: 'Fabric width', name: 'widthCm', type: 'select', value: FABRIC_WIDTHS.some(w => w.cm === st.widthCm) ? st.widthCm : 'custom', options: [...FABRIC_WIDTHS.map(w => ({ value: w.cm, label: w.label })), { value: 'custom', label: 'Other width…' }] })}
            ${FABRIC_WIDTHS.some(w => w.cm === st.widthCm) ? '' : field({ label: 'Custom width (cm)', name: 'customWidth', type: 'number', value: st.widthCm, attrs: 'min="30"' })}
            ${field({ label: 'Fabric type', name: 'fabricType', type: 'select', value: st.fabricType, options: [{ value: '', label: '—' }, ...FABRIC_TYPES] })}
            ${field({ label: 'Number of garments', name: 'garments', type: 'number', value: st.garments, attrs: 'min="1" step="1"' })}
            ${field({ label: 'Size / fit adjustment (%)', name: 'sizeAdjustPct', type: 'number', value: st.sizeAdjustPct, attrs: 'min="-30" max="100"', hint: 'e.g. +10 for a loose, flowing fit' })}
            ${field({ label: 'Extra allowance (cm)', name: 'extraAllowanceCm', type: 'number', value: st.extraAllowanceCm, attrs: 'min="0"', hint: 'Pattern matching, shrinkage' })}
            ${field({ label: 'Show result in', name: 'outputUnit', type: 'select', value: st.outputUnit, options: [{ value: 'yd', label: 'Yards' }, { value: 'm', label: 'Metres' }] })}
            ${field({ label: `Price per ${st.outputUnit === 'm' ? 'metre' : 'yard'}`, name: 'price', type: 'number', value: st.price, attrs: 'min="0"' })}
          </form></div></div>
        <div class="span-5 stack">
          <div class="card card-pad" id="fc-result" aria-live="polite"></div>
        </div>
        <div class="card span-12">
          <div class="card-header"><h2 class="card-title">${icon('sliders-horizontal', 18)} Your estimation rules</h2><div class="row"><button class="btn btn-ghost btn-sm" data-act="reset">${icon('undo-2', 14)} Reset defaults</button><button class="btn btn-primary btn-sm" data-act="new-rule">${icon('plus', 14)} New rule</button></div></div>
          ${table({ columns: [
            { label: 'Garment', cell: x => html`<strong>${x.garment}</strong>` },
            { label: 'Formula', cell: x => html`<span class="small">${x.terms.map(t => `${t.factor}× ${label(t.key)}`).join(' + ')} + ${x.allowanceCm} cm</span>` },
            { label: 'Ref. width', cls: 'right', cell: x => `${x.refWidthCm} cm` },
            { label: 'Waste', cls: 'right', cell: x => `${x.wastePct}%` },
            { label: 'Learning', cell: x => x.learned ? html`${badge(`${x.learned.samples} logs → ×${x.learned.factor}`, 'gold')}${Math.abs(x.learned.factor - (x.calibration || 1)) >= 0.02 ? html` <button class="btn btn-ghost btn-sm" data-apply="${x.id}" data-f="${x.learned.factor}">Apply</button>` : ''}` : html`<span class="small subtle">${x.logs.length}/3 logs${x.calibration !== 1 ? ` · ×${x.calibration}` : ''}</span>` },
            { label: '', cls: 'actions', cell: x => html`<button class="icon-btn sm" data-edit-rule="${x.id}" aria-label="Edit ${x.garment}">${icon('pencil', 16)}</button><button class="icon-btn sm" data-del-rule="${x.id}" aria-label="Delete ${x.garment}">${icon('trash-2', 16)}</button>` },
          ], rows: rulesWithLogs })}
        </div>
      </div>`);
    paintResult();
  };

  paint();

  const onInput = async (e) => {
    const n = e.target.name;
    if (!n) return;
    const v = e.target.value;
    if (n === 'ruleId') { st.ruleId = v; st.manual = {}; local.set('fabricCalc', { ...local.get('fabricCalc', {}), ruleId: v }); paint(); return; }
    if (n === 'customerId') {
      st.customerId = v; st.manual = {};
      st.measurements = v ? (await byIndex('measurements', 'customerId', v)).sort((a, b) => b.takenAt.localeCompare(a.takenAt)) : [];
      st.measurementId = st.measurements[0]?.id || '';
      if (st.measurements[0]) st.unit = st.measurements[0].unit;
      paint(); return;
    }
    if (n === 'measurementId') { st.measurementId = v; st.manual = {}; const m = st.measurements.find(x => x.id === v); if (m) st.unit = m.unit; paint(); return; }
    if (n === 'unit') { st.unit = v; st.manual = {}; paint(); return; }
    if (n === 'widthCm') { if (v === 'custom') { st.widthCm = 0; paint(); return; } st.widthCm = Number(v); local.set('fabricCalc', { ...local.get('fabricCalc', {}), widthCm: st.widthCm }); paint(); return; }
    if (n === 'customWidth') st.widthCm = Number(v) || 0;
    else if (n.startsWith('m_')) st.manual[n.slice(2)] = v === '' ? undefined : Number(v);
    else if (n === 'outputUnit') { st.outputUnit = v; paint(); return; }
    else if (n === 'fabricType') st.fabricType = v;
    else st[n] = v === '' ? 0 : Number(v);
    if (n === 'garments') st.garments = Math.max(1, Math.floor(Number(v) || 1));
    if (n === 'price') st.price = v === '' ? '' : Number(v);
    paintResult();
  };
  el.addEventListener('input', onInput);

  const offs = [delegate(el, 'click', '[data-act],[data-edit-rule],[data-del-rule],[data-apply]', async (e, b) => {
    const d = b.dataset;
    try {
      if (d.act === 'copy') {
        const r = compute();
        const ok = await copyText(`${r.garment}${st.fabricType ? ` (${st.fabricType})` : ''}: about ${r.quantity} ${st.outputUnit === 'm' ? 'metres' : 'yards'} for ${st.garments} garment(s) at ${st.widthCm} cm width — estimate, incl. ${rule().wastePct}% waste.${st.price ? ` Approx. cost ${money(r.cost)}.` : ''}`);
        toast(ok ? 'Copied.' : 'Could not copy.', { type: ok ? 'success' : 'error' });
      } else if (d.act === 'log') {
        const r = compute();
        const unit = st.outputUnit === 'm' ? 'metres' : 'yards';
        const res = await formModal({
          title: 'Log actual fabric used', submitLabel: 'Save',
          body: html`<p class="span-2 small muted">Rule estimate (before waste) for one garment: <strong>${r.perGarment} ${unit}</strong>. What did you actually use for one garment?</p>${field({ label: `Actual used (${unit})`, name: 'actual', type: 'number', required: true, attrs: 'min="0.1"' })}`,
          onSubmit: (dd) => logFabricUsage({ ruleId: rule().id, garment: rule().garment, estimated: r.perGarment, actual: dd.actual, unit, calibrationAtTime: rule().calibration || 1, usedFallback: r.usedFallback, date: todayISO() }),
        });
        if (res) { toast('Usage logged. Fabriqon learns from 3+ logs per rule.', { type: 'success' }); render(el); }
      } else if (d.act === 'new-rule') { if (await openRuleForm()) paint(); }
      else if (d.act === 'reset') {
        if (!(await confirmDialog({ title: 'Reset fabric rules?', message: 'All rules return to Fabriqon defaults. Your custom rules and calibrations will be lost. Usage logs are kept.', confirmLabel: 'Reset', danger: true }))) return;
        await saveRules(DEFAULT_FABRIC_RULES); st.ruleId = DEFAULT_FABRIC_RULES[0].id; paint();
      }
      else if (d.editRule) { if (await openRuleForm(getState().fabricRules.find(x => x.id === d.editRule))) paint(); }
      else if (d.delRule) {
        if (getState().fabricRules.length <= 1) throw new Error('Keep at least one rule.');
        const x = getState().fabricRules.find(y => y.id === d.delRule);
        if (!(await confirmDialog({ title: `Delete rule “${x.garment}”?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        await saveRules(getState().fabricRules.filter(y => y.id !== d.delRule));
        if (st.ruleId === d.delRule) st.ruleId = getState().fabricRules[0].id;
        paint();
      } else if (d.apply) {
        const rules = getState().fabricRules.map(x => (x.id === d.apply ? { ...x, calibration: Number(d.f) } : x));
        await saveRules(rules);
        toast(`Calibration ×${d.f} applied.`, { type: 'success' });
        paint();
      }
    } catch (err) { toastError(err); }
  })];
  return () => { offs.forEach(f => f()); el.removeEventListener('input', onInput); };
}
