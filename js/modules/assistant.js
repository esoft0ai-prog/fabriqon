// Tailoring assistant: offline guidance + calculators, and optional AI via a
// secure backend proxy. Never invents measurements or guarantees diagnoses.
import { html, icon, raw, field, toast, toastError, pageHeader, delegate, badge, table, emptyState, validateForm, readForm } from '../ui.js';
import { searchKnowledge, KNOWLEDGE } from '../core/knowledge.js';
import { suggestPrice, stageProgress } from '../core/calc.js';
import { aiStatus, askAI } from '../ai.js';
import { loadOrderViews } from '../services.js';
import { getAll } from '../database.js';
import { money, fmtDate, todayISO, daysBetween } from '../utils.js';
import { getState, stageLabel, stageIndex } from '../state.js';

const chatLog = []; // session-only conversation (module scope, cleared on reload)

export async function render(el, params, query) {
  const tab = query.tab || 'ask';
  const s = aiStatus();
  const tabs = [['ask', 'Ask'], ['pricing', 'Pricing'], ['schedule', 'Schedule'], ['quote', 'Quotation'], ['design', 'Design ideas']];
  el.innerHTML = String(html`
    ${pageHeader({ title: 'Tailoring Assistant', subtitle: 'Guidance, pricing, scheduling and quotations — works offline' })}
    <div class="alert ${s.available ? 'alert-success' : ''} mb-4">${icon(s.available ? 'sparkles' : 'book-open', 18)}<div>
      ${s.available ? html`<strong>AI connected.</strong>Questions go to your configured AI service. Answers are suggestions — always check them against your own experience.`
        : s.reason === 'offline' ? html`<strong>Offline — using built-in guidance.</strong>AI answers return when you reconnect.`
          : html`<strong>Using built-in tailoring guidance.</strong>AI is optional and not configured. To enable it, deploy the small proxy in <span class="code">server/ai-proxy.mjs</span> with your provider key and add its URL in <a class="strong" href="#/settings?tab=ai">Settings → AI</a>. Keys never go in the app.`}
    </div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<a class="tab" role="tab" href="#/assistant?tab=${k}" aria-selected="${tab === k}">${l}</a>`)}</div>
    <section id="as-body"></section>`);
  const body = el.querySelector('#as-body');
  if (tab === 'ask') return renderAsk(body);
  if (tab === 'pricing') return renderPricing(body);
  if (tab === 'schedule') return renderSchedule(body);
  if (tab === 'quote') return renderQuote(body);
  return renderDesign(body);
}

function localAnswer(q) {
  const hits = searchKnowledge(q);
  if (!hits.length) {
    return `I don't have built-in guidance for that yet. Try asking about a sewing machine problem (e.g. "skipped stitches", "thread breaking", "puckering"), a measurement term ("ease", "inseam", "round sleeve"), garment construction ("agbada", "trousers", "gown with zip"), fabrics ("pre-washing", "lace", "fabric combinations"), or pricing and scheduling.\n\nFor fabric quantities use the Fabric Calculator — it works from your actual measurements.`;
  }
  return hits.map((h, i) => `${i === 0 ? '' : '\n— Related —\n'}${h.title}\n${h.a}`).join('\n');
}

function renderAsk(el) {
  const s = aiStatus();
  const suggestions = ['Why is my thread breaking?', 'Seam puckering on chiffon', 'What is ease?', 'Agbada construction steps', 'How should I price a senator?', 'Fabric combinations for aso-oke'];
  if (!chatLog.length) chatLog.push({ role: 'assistant', content: `Hello! I can help with sewing problems, measurement terms, garment construction, fabric choices, pricing and planning.${s.available ? '' : ' (Built-in guidance mode.)'}` });
  const paint = () => {
    el.innerHTML = String(html`<div class="card chat">
      <div class="chat-log" id="chat-log" aria-live="polite">${chatLog.map(m => html`<div class="msg ${m.role === 'user' ? 'user' : 'bot'}">${m.content}</div>`)}</div>
      ${chatLog.length < 3 ? html`<div class="suggestions">${suggestions.map(q => html`<button class="chip" data-q="${q}">${q}</button>`)}</div>` : ''}
      <form class="chat-form" id="chat-form"><label class="sr-only" for="chat-in">Ask a question</label><input id="chat-in" class="input" placeholder="Ask about sewing, fit, fabrics, pricing…" autocomplete="off" maxlength="600"><button class="btn btn-primary" type="submit" aria-label="Send">${icon('send', 16)}</button></form>
    </div>
    <details class="card card-pad mt-4"><summary class="strong">Browse all built-in topics (${KNOWLEDGE.length})</summary><ul class="stack-sm mt-3" style="padding-left:18px">${KNOWLEDGE.map(k => html`<li><button class="btn btn-ghost btn-sm btn-wrap" data-q="${k.title}">${k.cat}: ${k.title}</button></li>`)}</ul></details>`);
    const log = el.querySelector('#chat-log');
    log.scrollTop = log.scrollHeight;
  };
  paint();
  const ask = async (q) => {
    if (!q.trim()) return;
    chatLog.push({ role: 'user', content: q.trim() });
    const st = aiStatus();
    if (st.available) {
      chatLog.push({ role: 'assistant', content: 'Thinking…', pending: true });
      paint();
      try {
        const { reply } = await askAI({ messages: chatLog.filter(m => !m.pending).map(({ role, content }) => ({ role, content })) });
        chatLog.pop(); chatLog.push({ role: 'assistant', content: reply });
      } catch (err) {
        chatLog.pop();
        chatLog.push({ role: 'assistant', content: `AI unavailable — ${err.message} Built-in guidance:\n\n${localAnswer(q)}` });
      }
    } else chatLog.push({ role: 'assistant', content: localAnswer(q) });
    paint();
    el.querySelector('#chat-in')?.focus();
  };
  const onSubmit = (e) => { if (e.target.id !== 'chat-form') return; e.preventDefault(); const v = el.querySelector('#chat-in').value; ask(v); };
  el.addEventListener('submit', onSubmit);
  const off = delegate(el, 'click', '[data-q]', (e, b) => ask(b.dataset.q));
  return () => { off(); el.removeEventListener('submit', onSubmit); };
}

function renderPricing(el) {
  el.innerHTML = String(html`<div class="dash-grid">
    <div class="card span-7"><div class="card-header"><h2 class="card-title">${icon('calculator', 18)} Garment pricing</h2></div><div class="card-body">
      <form class="form" id="price-form" novalidate>
        ${field({ label: 'Materials cost', name: 'materials', type: 'number', value: 0, attrs: 'min="0"', hint: 'Fabric (if you supply it), lining, buttons, zips, thread' })}
        ${field({ label: 'Labour hours', name: 'labourHours', type: 'number', value: 6, attrs: 'min="0"' })}
        ${field({ label: 'Your hourly rate', name: 'hourlyRate', type: 'number', value: 1500, attrs: 'min="0"' })}
        ${field({ label: 'Overheads (%)', name: 'overheadPct', type: 'number', value: 15, attrs: 'min="0" max="300"', hint: 'Rent, power, maintenance' })}
        ${field({ label: 'Profit margin (%)', name: 'marginPct', type: 'number', value: 25, attrs: 'min="0" max="500"' })}
      </form></div></div>
    <div class="card card-pad span-5" id="price-out" aria-live="polite"></div></div>`);
  const out = el.querySelector('#price-out');
  const calc = () => {
    const d = readForm(el.querySelector('#price-form'));
    const r = suggestPrice(d);
    out.innerHTML = String(html`<span class="estimate-tag">${icon('info', 14)} Suggested price</span>
      <div class="result-hero mt-2"><span class="big">${money(r.price)}</span></div>
      <dl class="kv mt-4"><dt>Total cost</dt><dd class="num">${money(r.cost)}</dd><dt>Profit</dt><dd class="num text-success">${money(r.profit)}</dd></dl>
      <p class="small subtle mt-3">Compare with your local market and adjust for rush jobs, embroidery and customer relationship.</p>`);
  };
  calc();
  const onInput = () => calc();
  el.addEventListener('input', onInput);
  return () => el.removeEventListener('input', onInput);
}

async function renderSchedule(el) {
  const { orders } = await loadOrderViews();
  const stages = getState().stages;
  const last = stages.at(-1).key;
  const defaultDays = { received: 0.5, measured: 0.5, sourcing: 1, cutting: 1, sewing: 2, finishing: 1, qc: 0.5, ready: 0 };
  const active = orders.filter(o => !o.cancelled && o.status !== last && o.status !== 'ready');
  const today = todayISO();
  const rows = active.map(o => {
    const idx = stageIndex(o.status);
    const workLeft = stages.slice(idx, stages.findIndex(s => s.key === 'ready') >= 0 ? stages.findIndex(s => s.key === 'ready') : stages.length - 1).reduce((s, st) => s + (defaultDays[st.key] ?? 1), 0);
    const daysLeft = o.dueDate ? daysBetween(today, o.dueDate) : 999;
    return { ...o, workLeft, daysLeft, slack: daysLeft - workLeft };
  }).sort((a, b) => a.slack - b.slack);
  if (!rows.length) { el.innerHTML = String(html`<div class="card">${emptyState({ icon: 'square-kanban', title: 'No jobs to schedule', text: 'Active orders that are not yet ready will be ranked here by urgency.' })}</div>`); return; }
  el.innerHTML = String(html`
    <p class="small muted mb-3">Ranked by slack: days until delivery minus an estimate of the work left (default stage durations — e.g. sewing ≈ 2 days). Start at the top.</p>
    <div class="card">${table({ columns: [
      { label: 'Priority', cell: o => o.slack < 0 ? badge('Behind', 'danger') : o.slack <= 1 ? badge('Start now', 'warning') : o.slack <= 3 ? badge('Soon', 'gold') : badge('On track', 'success') },
      { label: 'Order', cell: o => html`<a href="#/orders/${o.id}"><strong>${o.title}</strong></a><br><small class="subtle">${o.number} · ${o.customerName}</small>` },
      { label: 'Stage', cell: o => html`${stageLabel(o.status)}<div class="progress mt-2" style="width:100px"><span style="width:${stageProgress(o.status, stages)}%"></span></div>` },
      { label: 'Due', cell: o => o.dueDate ? fmtDate(o.dueDate) : '—' },
      { label: 'Work left', cls: 'right', cell: o => `~${o.workLeft} d` },
      { label: 'Slack', cls: 'right', cell: o => html`<span class="num strong ${o.slack < 0 ? 'text-danger' : ''}">${o.daysLeft === 999 ? '—' : `${o.slack} d`}</span>` },
    ], rows })}</div>`);
}

async function renderQuote(el) {
  const customers = (await getAll('customers')).filter(c => !c.archived);
  const lines = [{ description: '', qty: 1, unitPrice: '' }];
  const paint = () => {
    el.innerHTML = String(html`<div class="card"><div class="card-header"><h2 class="card-title">${icon('file-text', 18)} Prepare a quotation</h2></div><div class="card-body">
      <form id="q-form" class="form" novalidate>
        ${field({ label: 'Customer', name: 'customer', type: 'select', options: [{ value: '', label: 'Walk-in / not saved' }, ...customers.map(c => ({ value: c.name, label: c.name }))] })}
        ${field({ label: 'Or enter a name', name: 'customName' })}
        <div class="items-editor span-2">${lines.map((l, i) => html`<div class="item-row" data-i="${i}">
          <input class="input" data-f="description" placeholder="Item, e.g. Agbada sewing + embroidery" value="${l.description}" aria-label="Description">
          <input class="input" data-f="qty" type="number" min="1" value="${l.qty}" aria-label="Quantity">
          <input class="input price" data-f="unitPrice" type="number" min="0" step="any" placeholder="Price" value="${l.unitPrice}" aria-label="Unit price">
          <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove line" ${lines.length === 1 ? raw('disabled') : ''}>${icon('trash-2', 16)}</button></div>`)}
          <button type="button" class="btn btn-ghost btn-sm" data-add>${icon('plus', 14)} Add line</button></div>
        ${field({ label: 'Notes / terms', name: 'notes', type: 'textarea', full: true, value: 'A 60% deposit confirms the order. Delivery date is agreed after fabric is received.' })}
        ${field({ label: 'Valid for (days)', name: 'validDays', type: 'number', value: 14, attrs: 'min="1"' })}
        <div class="span-2 row"><span class="spacer"></span><button class="btn btn-primary" type="submit">${icon('download', 16)} Generate PDF</button></div>
      </form></div></div>`);
  };
  paint();
  const sync = () => el.querySelectorAll('.item-row').forEach(r => r.querySelectorAll('[data-f]').forEach(inp => { lines[Number(r.dataset.i)][inp.dataset.f] = inp.value; }));
  const off = delegate(el, 'click', '[data-add],[data-rm]', (e, b) => { sync(); if (b.hasAttribute('data-add')) lines.push({ description: '', qty: 1, unitPrice: '' }); else lines.splice(Number(b.dataset.rm), 1); paint(); });
  const onSubmit = async (e) => {
    e.preventDefault();
    sync();
    const form = el.querySelector('#q-form');
    if (!validateForm(form)) return;
    const d = readForm(form);
    const items = lines.filter(l => l.description.trim()).map(l => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unitPrice: Number(l.unitPrice) || 0 }));
    if (!items.length) { toast('Add at least one line.', { type: 'warning' }); return; }
    try { await (await import('../exports.js')).quotationPdf({ customerName: d.customName || d.customer, items, notes: d.notes, validDays: d.validDays || 14 }); } catch (err) { toastError(err); }
  };
  el.addEventListener('submit', onSubmit);
  return () => { off(); el.removeEventListener('submit', onSubmit); };
}

function renderDesign(el) {
  const s = aiStatus();
  el.innerHTML = String(html`<div class="card"><div class="card-header"><h2 class="card-title">${icon('wand-sparkles', 18)} Design ideas</h2></div><div class="card-body stack">
    ${s.available ? '' : html`<div class="alert alert-warn">${icon('info', 18)}<div><strong>Design ideas need an AI service.</strong>${s.reason === 'offline' ? 'Reconnect to the internet to use this.' : 'Configure an AI proxy in Settings → AI. Image generation works only if your proxy connects to an image-capable provider.'} Meanwhile, browse your own <a class="strong" href="#/designs">style library</a>.</div></div>`}
    <form id="dz-form" class="stack">
      ${field({ label: 'Describe the outfit', name: 'brief', type: 'textarea', rows: 4, required: true, placeholder: 'e.g. Wine-coloured lace gown for a 50th birthday, mermaid cut, long sleeves, modest neckline, with gold aso-oke gele' })}
      <div class="row"><span class="spacer"></span><button class="btn btn-primary" type="submit" ${s.available ? '' : raw('disabled')}>${icon('sparkles', 16)} Get concepts</button></div>
    </form>
    <div id="dz-out" aria-live="polite"></div></div></div>`);
  const onSubmit = async (e) => {
    e.preventDefault();
    const form = el.querySelector('#dz-form');
    if (!validateForm(form)) return;
    const out = el.querySelector('#dz-out');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const { reply, images } = await askAI({ task: 'design', messages: [{ role: 'user', content: form.brief.value }] });
      out.innerHTML = String(html`<div class="msg bot" style="max-width:none">${reply}</div>${images.length ? html`<div class="gallery mt-4">${images.map(src => html`<div class="design-thumb card"><img src="${src}" alt="Design concept" loading="lazy"></div>`)}</div>` : ''}`);
    } catch (err) { out.innerHTML = String(html`<div class="alert alert-danger">${icon('circle-alert', 18)}<div>${err.message}</div></div>`); }
    finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
  el.addEventListener('submit', onSubmit);
  return () => el.removeEventListener('submit', onSubmit);
}
