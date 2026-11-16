// Reusable UI primitives: safe HTML templating, icons, dialogs, forms,
// toasts, tables, badges and empty states.
import { ICONS } from './icons.js';

// ---------- Safe templating ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const renderVal = (v) => (v === null || v === undefined || v === false) ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(renderVal).join('') : esc(v);
/** Tagged template that escapes every interpolation unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += renderVal(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener. Returns an unsubscribe function. */
export function delegate(root, type, selector, fn) {
  const h = (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

// ---------- Icons ----------
export function icon(name, size = 18, cls = '') {
  const nodes = ICONS[name] || ICONS['circle-alert'];
  const inner = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return raw(`<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`);
}

// ---------- Toasts ----------
export function toast(message, { type = 'info', timeout = 3800, action } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = { success: 'circle-check', error: 'circle-alert', warning: 'triangle-alert', info: 'info' }[type] || 'info';
  el.innerHTML = String(html`${icon(ic, 18)}<span class="toast-msg">${message}</span>${action ? html`<button class="btn btn-ghost btn-sm" data-t-action>${action.label}</button>` : ''}<button class="icon-btn" aria-label="Dismiss" data-t-close>${icon('x', 16)}</button>`);
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('[data-t-close]').onclick = close;
  if (action) el.querySelector('[data-t-action]').onclick = () => { action.fn(); close(); };
  host.appendChild(el);
  if (timeout) setTimeout(close, timeout);
}
export const toastError = (err) => toast(err?.message || String(err), { type: 'error', timeout: 6000 });

// ---------- Modals ----------
let modalDepth = 0;
export function openModal({ title, body = '', footer = '', size = 'md', onClose, className = '' }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal modal-${size} ${className}`;
  const titleId = `m-title-${Date.now()}`;
  dlg.setAttribute('aria-labelledby', titleId);
  dlg.innerHTML = String(html`
    <div class="modal-header">
      <h2 class="modal-title" id="${titleId}">${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? html`<div class="modal-footer">${footer}</div>` : ''}`);
  document.body.appendChild(dlg);
  modalDepth++;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    modalDepth--;
    dlg.classList.add('closing');
    setTimeout(() => { dlg.close(); dlg.remove(); }, 140);
    onClose?.(result);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close(null);
    else if (e.target === dlg) {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close(null);
    }
  });
  dlg.showModal();
  const first = dlg.querySelector('[autofocus], .modal-body input:not([type=hidden]):not([type=file]), .modal-body select, .modal-body textarea, .modal-footer .btn-primary');
  first?.focus();
  return { dialog: dlg, body: dlg.querySelector('.modal-body'), close };
}
export const isModalOpen = () => modalDepth > 0;

/**
 * Opens a form in a modal. onSubmit(data, form, ctx) may throw to show an
 * inline error; returning false keeps the modal open. Resolves with the
 * onSubmit result, or null if cancelled.
 */
export function formModal({ title, body, submitLabel = 'Save', size = 'md', onSubmit, onOpen, danger = false, extraFooter = '' }) {
  return new Promise((resolve) => {
    const formId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const m = openModal({
      title, size,
      body: html`<form id="${formId}" class="form" novalidate><div class="form-alert" role="alert" hidden></div>${body}</form>`,
      footer: html`${extraFooter}<span class="spacer"></span><button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" form="${formId}" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>`,
      onClose: (r) => resolve(r ?? null),
    });
    const form = m.body.querySelector('form');
    const alertEl = form.querySelector('.form-alert');
    const submitBtn = m.dialog.querySelector('button[type=submit]');
    onOpen?.(form, m);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertEl.hidden = true;
      if (!validateForm(form)) return;
      submitBtn.disabled = true;
      submitBtn.classList.add('loading');
      try {
        const res = await onSubmit(readForm(form), form, m);
        if (res !== false) m.close(res === undefined ? true : res);
      } catch (err) {
        console.error(err);
        alertEl.textContent = err?.message || String(err);
        alertEl.hidden = false;
        alertEl.scrollIntoView({ block: 'nearest' });
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
      }
    });
  });
}

/** Native constraint validation with inline messages. */
export function validateForm(form) {
  let firstBad = null;
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'hidden') continue;
    const wrap = el.closest('.field');
    const msgEl = wrap?.querySelector('.field-error');
    if (el.type !== 'checkbox' && el.type !== 'file' && typeof el.value === 'string' && el.value !== el.value.trim() && el.tagName !== 'TEXTAREA') el.value = el.value.trim();
    const ok = el.checkValidity();
    wrap?.classList.toggle('invalid', !ok);
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (msgEl) msgEl.textContent = ok ? '' : el.validationMessage;
    if (!ok && !firstBad) firstBad = el;
  }
  firstBad?.focus();
  return !firstBad;
}

/** Reads a form into a plain object, coercing numbers and checkboxes. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number' || el.dataset.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type === 'file') out[el.name] = el.files;
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map(o => o.value);
    else out[el.name] = el.value;
  }
  return out;
}

let fieldSeq = 0;
/** Renders a labelled, accessible form field. */
export function field({ label, name, type = 'text', value = '', required = false, placeholder = '', hint = '', options = [], rows = 3, attrs = '', full = false, cls = '' }) {
  const id = `fld-${name}-${++fieldSeq}`;
  const req = required ? raw(' required') : '';
  const a = raw(attrs);
  const hintId = hint ? `${id}-hint` : '';
  const desc = hint ? raw(` aria-describedby="${hintId}"`) : '';
  let control;
  if (type === 'select') {
    control = html`<select id="${id}" name="${name}"${req}${desc} ${a}>${options.map(o => {
      const v = typeof o === 'object' ? o.value : o;
      const l = typeof o === 'object' ? o.label : o;
      return html`<option value="${v}" ${String(v) === String(value ?? '') ? raw('selected') : ''}>${l}</option>`;
    })}</select>`;
  } else if (type === 'textarea') {
    control = html`<textarea id="${id}" name="${name}" rows="${rows}" placeholder="${placeholder}"${req}${desc} ${a}>${value}</textarea>`;
  } else if (type === 'checkbox') {
    return html`<div class="field field-check ${full ? 'span-2' : ''} ${cls}"><label class="check"><input type="checkbox" id="${id}" name="${name}" ${value ? raw('checked') : ''} ${a}><span>${label}</span></label>${hint ? html`<p class="field-hint" id="${hintId}">${hint}</p>` : ''}</div>`;
  } else {
    const extra = type === 'number' ? raw(' inputmode="decimal" step="any"') : '';
    control = html`<input id="${id}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}"${req}${extra}${desc} ${a}>`;
  }
  return html`<div class="field ${full ? 'span-2' : ''} ${cls}">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
    ${control}
    ${hint ? html`<p class="field-hint" id="${hintId}">${hint}</p>` : ''}
    <p class="field-error" aria-live="polite"></p>
  </div>`;
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false, requireText = '' }) {
  return new Promise((resolve) => {
    const m = openModal({
      title, size: 'sm',
      body: html`<p class="confirm-msg">${message}</p>${requireText ? html`<div class="field"><label for="confirm-text">Type <strong>${requireText}</strong> to confirm</label><input id="confirm-text" autocomplete="off"></div>` : ''}`,
      footer: html`<span class="spacer"></span><button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok ${requireText ? raw('disabled') : ''}>${confirmLabel}</button>`,
      onClose: (r) => resolve(r === true),
    });
    const ok = m.dialog.querySelector('[data-ok]');
    if (requireText) {
      const inp = m.dialog.querySelector('#confirm-text');
      inp.focus();
      inp.addEventListener('input', () => { ok.disabled = inp.value.trim() !== requireText; });
    } else ok.focus();
    ok.addEventListener('click', () => m.close(true));
  });
}

// ---------- Display helpers ----------
export const badge = (text, tone = 'neutral') => html`<span class="badge badge-${tone}">${text}</span>`;

export function emptyState({ icon: ic = 'box', title, text = '', action = '' }) {
  return html`<div class="empty"><div class="empty-icon">${icon(ic, 28)}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}

export const skeleton = (rows = 4) => html`<div class="skeleton-wrap" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => html`<div class="skeleton skeleton-line"></div>`)}</div>`;

export function pageHeader({ title, subtitle = '', actions = '', back = '' }) {
  return html`<header class="page-header">
    <div class="page-title-wrap">
      ${back ? html`<a class="back-link" href="${back}">${icon('arrow-left', 16)} Back</a>` : ''}
      <h1 class="page-title">${title}</h1>
      ${subtitle ? html`<p class="page-subtitle">${subtitle}</p>` : ''}
    </div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

/**
 * Responsive table: a real <table> on wide screens that becomes stacked
 * cards on narrow screens (via data-label on cells).
 */
export function table({ columns, rows, rowAttrs = () => '', className = '' }) {
  return html`<div class="table-wrap"><table class="table ${className}">
    <thead><tr>${columns.map(c => html`<th scope="col" class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map(r => html`<tr ${raw(rowAttrs(r))}>${columns.map(c => html`<td data-label="${c.label}" class="${c.cls || ''}"><span class="cell">${c.cell(r)}</span></td>`)}</tr>`)}</tbody>
  </table></div>`;
}

export function stat({ label, value, icon: ic, tone = 'navy', sub = '', href = '' }) {
  const inner = html`<div class="stat-icon tone-${tone}">${icon(ic, 20)}</div><div class="stat-body"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
  return href ? html`<a class="stat card card-link" href="${href}">${inner}</a>` : html`<div class="stat card">${inner}</div>`;
}

export const avatar = (name, photo, size = 40) => photo
  ? html`<img class="avatar" src="${photo}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`
  : html`<span class="avatar avatar-initials" style="width:${size}px;height:${size}px" aria-hidden="true">${name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('')}</span>`;

export function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('loading', busy);
}
