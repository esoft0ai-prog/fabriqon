// Alerts (computed reminders + on-device notifications) and customer
// messages. Fabriqon has no messaging provider: it prepares the text and
// hands it to WhatsApp / SMS / email on the device. It never claims to send.
import { html, icon, raw, field, openModal, formModal, toast, toastError, emptyState, pageHeader, badge, delegate, skeleton } from '../ui.js';
import { getAll, get, setSetting } from '../database.js';
import { addNotification, loadOrderViews, markNotificationsRead } from '../services.js';
import { computeAlerts } from '../alerts.js';
import { MESSAGE_TEMPLATES } from '../core/defaults.js';
import { money, fmtDate, fmtTime, copyText, waNumber, timeAgo } from '../utils.js';
import { getState } from '../state.js';
import { showLocalNotification } from '../pwa.js';

export function fillTemplate(text, { customer, order, appointment } = {}) {
  const b = getState().business || {};
  const map = {
    customer: customer?.name?.split(' ')[0] || 'there', business: b.name || '', phone: b.phone || '',
    order: order?.number || '', garment: order?.title || 'outfit', due: order?.dueDate ? fmtDate(order.dueDate) : 'the agreed date',
    balance: order ? money(order.balance || 0) : '', date: appointment ? fmtDate(appointment.start) : '', time: appointment ? fmtTime(appointment.start) : '',
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

export async function composeMessage({ order = null, customer = null, appointment = null, templateKey = '' } = {}) {
  if (order && !customer) customer = await get('customers', order.customerId);
  if (order && order.balance === undefined) order = (await loadOrderViews()).orders.find(o => o.id === order.id) || order;
  const customers = customer ? [customer] : (await getAll('customers')).filter(c => !c.archived);
  const templates = getState().messageTemplates;
  const tpl = templates.find(t => t.key === templateKey) || (order ? templates.find(t => t.key === 'order_received') : templates[0]);
  const m = openModal({
    title: 'Message customer', size: 'md',
    body: html`<div class="form form-1">
      <div class="alert">${icon('info', 18)}<div>No messaging service is connected, so Fabriqon does not send messages itself. Choose WhatsApp, SMS or email to open that app with this message ready, or copy it.</div></div>
      ${customer ? html`<p class="small"><strong>To:</strong> ${customer.name} ${customer.phone ? html`<span class="subtle">· ${customer.phone}</span>` : html`<span class="text-warning">· no phone number saved</span>`}</p>`
        : field({ label: 'Customer', name: 'cust', type: 'select', options: [{ value: '', label: 'Choose…' }, ...customers.map(c => ({ value: c.id, label: c.name }))] })}
      ${field({ label: 'Template', name: 'tpl', type: 'select', value: tpl?.key, options: templates.map(t => ({ value: t.key, label: t.label })) })}
      ${field({ label: 'Message', name: 'text', type: 'textarea', rows: 6, value: fillTemplate(tpl?.text || '', { customer, order, appointment }) })}
    </div>`,
    footer: html`<button class="btn btn-ghost" data-ch="copy">${icon('copy', 16)} Copy</button><span class="spacer"></span>
      <button class="btn btn-secondary" data-ch="sms">${icon('smartphone', 16)} SMS</button>
      <button class="btn btn-secondary" data-ch="email">${icon('mail', 16)} Email</button>
      <button class="btn btn-primary" data-ch="whatsapp">${icon('send', 16)} WhatsApp</button>`,
  });
  const q = (s) => m.dialog.querySelector(s);
  const current = () => customer || customers.find(c => c.id === q('[name=cust]')?.value) || null;
  m.dialog.addEventListener('change', (e) => {
    if (e.target.name === 'tpl' || e.target.name === 'cust') {
      const t = templates.find(x => x.key === q('[name=tpl]').value);
      q('[name=text]').value = fillTemplate(t?.text || '', { customer: current(), order, appointment });
    }
  });
  m.dialog.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    const ch = b.dataset.ch;
    const text = q('[name=text]').value.trim();
    const c = current();
    if (!text) { toast('The message is empty.', { type: 'warning' }); return; }
    if (ch !== 'copy' && !c) { toast('Choose a customer first.', { type: 'warning' }); return; }
    if ((ch === 'whatsapp' || ch === 'sms') && !c.phone) { toast('This customer has no phone number. Copy the message instead.', { type: 'warning' }); return; }
    if (ch === 'email' && !c.email) { toast('This customer has no email address.', { type: 'warning' }); return; }
    if (ch === 'copy') {
      const ok = await copyText(text);
      toast(ok ? 'Message copied — paste it into any chat.' : 'Could not copy. Select the text and copy manually.', { type: ok ? 'success' : 'error' });
    } else {
      const url = ch === 'whatsapp' ? `https://wa.me/${waNumber(c.phone, getState().business?.countryCode || '234')}?text=${encodeURIComponent(text)}`
        : ch === 'sms' ? `sms:${c.phone}?body=${encodeURIComponent(text)}`
          : `mailto:${c.email}?subject=${encodeURIComponent(`${getState().business?.name || ''} – ${order?.number || 'update'}`)}&body=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener');
      toast(`Opened ${ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'your SMS app' : 'your email app'}. Press send there to deliver it.`, { type: 'info', timeout: 6000 });
    }
    try {
      await addNotification({ kind: 'message', title: templates.find(x => x.key === q('[name=tpl]').value)?.label || 'Message', body: text, channel: ch, status: 'prepared', customerId: c?.id || '', orderId: order?.id || '', read: true });
    } catch (err) { console.warn(err); }
    if (ch !== 'copy') m.close();
  });
}

export async function render(el, params, query) {
  el.innerHTML = String(html`${pageHeader({ title: 'Messages & Alerts' })}${skeleton(6)}`);
  const [alerts, notes, customers] = await Promise.all([computeAlerts(), getAll('notifications'), getAll('customers')]);
  const custName = new Map(customers.map(c => [c.id, c.name]));
  const messages = notes.filter(n => n.kind === 'message').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tab = query.tab || 'alerts';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';

  el.innerHTML = String(html`
    ${pageHeader({ title: 'Messages & Alerts', subtitle: 'Reminders worked out from your data, and messages you have prepared for customers', actions: html`<button class="btn btn-primary" data-act="compose">${icon('send', 16)} New message</button>` })}
    <div class="tabs" role="tablist">
      ${[['alerts', 'Alerts', alerts.length], ['messages', 'Message log', messages.length], ['templates', 'Templates']].map(([k, l, n]) => html`<a class="tab" role="tab" href="#/notifications?tab=${k}" aria-selected="${tab === k}">${l}${n !== undefined ? html`<span class="count">${n}</span>` : ''}</a>`)}
    </div>
    ${tab === 'alerts' ? html`
      <div class="card card-pad mb-4 between" style="flex-wrap:wrap">
        <div class="row">${icon('bell', 18)}<div><strong class="small">Device notifications</strong><p class="small muted">${perm === 'granted' ? 'On — Fabriqon can show reminders on this device while the app is open.' : perm === 'denied' ? 'Blocked in your browser settings.' : perm === 'unsupported' ? 'Not supported in this browser.' : 'Get overdue and low-stock reminders as device notifications.'}</p></div></div>
        ${perm === 'default' ? html`<button class="btn btn-secondary btn-sm" data-act="perm">Enable</button>` : perm === 'granted' ? html`<button class="btn btn-ghost btn-sm" data-act="test">Send test</button>` : ''}
      </div>
      <div class="card">${alerts.length ? html`<ul class="list">${alerts.map(a => html`<li><a class="list-item" href="${a.href}">
        <span class="list-icon" style="color:var(--${a.level === 'danger' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'})">${icon(a.icon, 16)}</span>
        <span class="list-main"><strong>${a.title}</strong><small>${a.body}</small></span>${icon('chevron-right', 16)}</a></li>`)}</ul>`
        : emptyState({ icon: 'circle-check', title: 'All clear', text: 'No overdue orders, low stock or reminders right now.' })}</div>`
    : tab === 'messages' ? html`<div class="card">${messages.length ? html`<ul class="list">${messages.map(n => html`<li class="list-item" style="align-items:flex-start">
        <span class="list-icon">${icon(n.channel === 'whatsapp' ? 'message-square' : n.channel === 'email' ? 'mail' : n.channel === 'sms' ? 'smartphone' : 'copy', 16)}</span>
        <span class="list-main"><strong>${n.title} · ${custName.get(n.customerId) || 'customer'}</strong><small>${timeAgo(n.createdAt)} · ${n.channel === 'copy' ? 'copied' : `opened in ${n.channel}`} — delivery is not confirmed</small><p class="small mt-2" style="white-space:pre-wrap;color:var(--text-2)">${n.body}</p></span>
        ${badge('Prepared', 'neutral')}</li>`)}</ul>` : emptyState({ icon: 'message-square', title: 'No messages yet', text: 'Messages you prepare from orders, payments or appointments are logged here.' })}</div>`
    : html`<div class="card"><ul class="list">${getState().messageTemplates.map(t => html`<li class="list-item" style="align-items:flex-start"><span class="list-main"><strong>${t.label}</strong><p class="small muted mt-2" style="white-space:pre-wrap">${t.text}</p></span><button class="icon-btn" data-edit-tpl="${t.key}" aria-label="Edit ${t.label}">${icon('pencil', 16)}</button></li>`)}</ul>
        <div class="card-foot between"><span class="small subtle">Placeholders: {customer} {business} {order} {garment} {due} {balance} {date} {time} {phone}</span><button class="btn btn-ghost btn-sm" data-act="reset-tpl">Reset</button></div></div>`}`);

  const unread = notes.filter(n => !n.read).map(n => n.id);
  if (unread.length) markNotificationsRead(unread).catch(() => {});

  return delegate(el, 'click', '[data-act],[data-edit-tpl]', async (e, b) => {
    try {
      const a = b.dataset.act;
      if (a === 'compose') composeMessage();
      else if (a === 'perm') { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Device notifications enabled.' : 'Permission not granted.', { type: r === 'granted' ? 'success' : 'warning' }); render(el, params, query); }
      else if (a === 'test') {
        const top = alerts[0];
        const ok = await showLocalNotification(top ? top.title : 'Fabriqon', top ? top.body : 'Notifications are working.', 'fabriqon-test');
        toast(ok ? 'Notification shown.' : 'Could not show a notification.', { type: ok ? 'success' : 'warning' });
      } else if (a === 'reset-tpl') { await setSetting('messageTemplates', MESSAGE_TEMPLATES); getState().messageTemplates = MESSAGE_TEMPLATES; render(el, params, query); }
      else if (b.dataset.editTpl) {
        const t = getState().messageTemplates.find(x => x.key === b.dataset.editTpl);
        const r = await formModal({
          title: `Edit template · ${t.label}`,
          body: html`${field({ label: 'Message', name: 'text', type: 'textarea', rows: 6, value: t.text, full: true, required: true, hint: 'Placeholders: {customer} {business} {order} {garment} {due} {balance} {date} {time} {phone}' })}`,
          onSubmit: async (d) => {
            const list = getState().messageTemplates.map(x => (x.key === t.key ? { ...x, text: d.text } : x));
            await setSetting('messageTemplates', list);
            getState().messageTemplates = list;
          },
        });
        if (r) { toast('Template saved.', { type: 'success' }); render(el, params, query); }
      }
    } catch (err) { toastError(err); }
  });
}

