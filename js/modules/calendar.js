// Calendar: appointments (measurement, fitting, delivery, collection) plus
// order deadlines, with month / week / day views and overlap detection.
import { html, icon, raw, field, formModal, toast, toastError, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog } from '../ui.js';
import { getAll } from '../database.js';
import { saveAppointment, deleteAppointment } from '../services.js';
import { findConflicts } from '../core/calc.js';
import { APPOINTMENT_TYPES } from '../core/defaults.js';
import { fmtDate, fmtTime, todayISO, byId } from '../utils.js';
import { getState } from '../state.js';
import { local } from '../storage.js';

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const typeLabel = (k) => APPOINTMENT_TYPES.find(t => t.key === k)?.label || 'Deadline';

export async function openAppointmentForm(existing = {}, { date, orderId } = {}) {
  const [customers, orders, appts] = await Promise.all([getAll('customers'), getAll('orders'), getAll('appointments')]);
  const order = orderId ? orders.find(o => o.id === orderId) : null;
  const start = existing.start ? new Date(existing.start) : null;
  const dur = existing.start && existing.end ? Math.round((new Date(existing.end) - new Date(existing.start)) / 60000) : 30;
  const res = await formModal({
    title: existing.id ? 'Edit appointment' : 'New appointment', submitLabel: 'Save',
    body: html`
      ${field({ label: 'Type', name: 'type', type: 'select', value: existing.type || (order ? 'fitting' : 'measurement'), options: APPOINTMENT_TYPES.map(t => ({ value: t.key, label: t.label })) })}
      ${field({ label: 'Customer', name: 'customerId', type: 'select', value: existing.customerId || order?.customerId || '', options: [{ value: '', label: '—' }, ...customers.filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }))] })}
      ${field({ label: 'Title', name: 'title', value: existing.title || (order ? `Fitting · ${order.title}` : ''), required: true, full: true, placeholder: 'e.g. Fitting for wedding agbada' })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: start ? isoDate(start) : (date || todayISO()), required: true })}
      ${field({ label: 'Start time', name: 'time', type: 'time', value: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '10:00', required: true })}
      ${field({ label: 'Duration (minutes)', name: 'duration', type: 'number', value: dur, attrs: 'min="5" max="720" step="5"', required: true })}
      ${field({ label: 'Related order', name: 'orderId', type: 'select', value: existing.orderId || orderId || '', options: [{ value: '', label: '—' }, ...orders.filter(o => !o.cancelled).map(o => ({ value: o.id, label: `${o.number} · ${o.title}` }))] })}
      ${existing.id ? field({ label: 'Status', name: 'status', type: 'select', value: existing.status || 'scheduled', options: [{ value: 'scheduled', label: 'Scheduled' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' }] }) : ''}
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: existing.notes, full: true })}`,
    onSubmit: async (d) => {
      const s = new Date(`${d.date}T${d.time}`);
      if (Number.isNaN(s.getTime())) throw new Error('Enter a valid date and time.');
      const rec = { ...existing, type: d.type, customerId: d.customerId, title: d.title, start: s.toISOString(), end: new Date(s.getTime() + d.duration * 60000).toISOString(), orderId: d.orderId, notes: d.notes, status: d.status || existing.status || 'scheduled' };
      if (rec.status !== 'cancelled') {
        const clash = findConflicts(rec, appts);
        if (clash.length) {
          const ok = await confirmDialog({ title: 'Time overlap', message: `This overlaps with:\n${clash.map(c => `• ${c.title} (${fmtTime(c.start)}–${fmtTime(c.end)})`).join('\n')}\n\nSave anyway?`, confirmLabel: 'Save anyway' });
          if (!ok) return false;
        }
      }
      return saveAppointment(rec);
    },
  });
  if (res && res !== true) toast('Appointment saved.', { type: 'success' });
  return res;
}

export async function render(el, params, query) {
  el.innerHTML = String(html`${pageHeader({ title: 'Calendar' })}${skeleton(6)}`);
  const [appts, orders, customers] = await Promise.all([getAll('appointments'), getAll('orders'), getAll('customers')]);
  const custs = byId(customers);
  const last = getState().stages.at(-1).key;
  const ui = { view: local.get('calView', window.innerWidth < 700 ? 'list' : 'month'), cursor: new Date() };

  // Events: appointments + order delivery deadlines
  const events = [
    ...appts.filter(a => a.status !== 'cancelled').map(a => ({ ...a, kind: 'appt' })),
    ...orders.filter(o => o.dueDate && !o.cancelled && o.status !== last).map(o => ({ id: `due-${o.id}`, kind: 'deadline', type: 'deadline', title: `Due: ${o.number} ${o.title}`, start: `${o.dueDate}T00:00:00`, allDay: true, orderId: o.id, customerId: o.customerId })),
  ];
  const conflictIds = new Set();
  const live = events.filter(e => e.kind === 'appt');
  for (const a of live) if (findConflicts(a, live).length) conflictIds.add(a.id);
  const dayOf = (e) => (e.allDay ? e.start.slice(0, 10) : isoDate(new Date(e.start)));
  const onDay = (iso) => events.filter(e => dayOf(e) === iso).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.start.localeCompare(b.start));
  const evBtn = (e) => html`<button class="cal-ev t-${e.type} ${conflictIds.has(e.id) ? 'conflict' : ''}" data-ev="${e.id}" title="${e.title}${e.allDay ? '' : ` · ${fmtTime(e.start)}`}">${e.allDay ? '' : `${fmtTime(e.start)} `}${e.title}</button>`;

  const monthView = () => {
    const c = ui.cursor;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
    const today = todayISO();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return html`<div class="card" style="overflow:hidden"><div class="cal-grid">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<div class="cal-dow">${d}</div>`)}
      ${cells.map(d => {
        const iso = isoDate(d);
        const evs = onDay(iso);
        return html`<div class="cal-cell ${d.getMonth() !== c.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''}" data-day="${iso}" role="button" tabindex="0" aria-label="${fmtDate(iso)}, ${evs.length} event(s)">
          <span class="cal-day">${d.getDate()}</span>${evs.slice(0, 3).map(evBtn)}${evs.length > 3 ? html`<span class="cal-more">+${evs.length - 3} more</span>` : ''}</div>`;
      })}</div></div>`;
  };

  const weekView = (days) => {
    const c = new Date(ui.cursor);
    const start = days === 7 ? new Date(c.getFullYear(), c.getMonth(), c.getDate() - ((c.getDay() + 6) % 7)) : new Date(c.getFullYear(), c.getMonth(), c.getDate());
    const ds = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const H0 = 7, H1 = 21, PX = 52;
    return html`<div class="card" style="overflow:hidden"><div class="wk-scroll"><div class="week-grid ${days === 1 ? 'day-view' : ''}">
      <div class="wk-head"></div>${ds.map(d => html`<div class="wk-head ${isoDate(d) === todayISO() ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
        ${onDay(isoDate(d)).filter(e => e.allDay).map(e => html`<div style="margin-top:4px">${evBtn(e)}</div>`)}</div>`)}
      <div>${Array.from({ length: H1 - H0 }, (_, h) => html`<div class="wk-hour">${pad(H0 + h)}:00</div>`)}</div>
      ${ds.map(d => html`<div class="wk-col" data-day="${isoDate(d)}">${Array.from({ length: H1 - H0 }, () => raw('<div class="slot"></div>'))}
        ${onDay(isoDate(d)).filter(e => !e.allDay).map(e => {
          const s = new Date(e.start), en = new Date(e.end || e.start);
          const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - H0) * PX);
          const h = Math.max(22, ((en - s) / 3600000) * PX);
          return html`<button class="wk-ev t-${e.type} ${conflictIds.has(e.id) ? 'conflict' : ''}" style="top:${top}px;height:${h}px" data-ev="${e.id}">${fmtTime(e.start)} ${e.title}</button>`;
        })}</div>`)}
    </div></div></div>`;
  };

  const listView = () => {
    const from = todayISO();
    const up = events.filter(e => dayOf(e) >= from).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 60);
    if (!up.length) return html`<div class="card">${emptyState({ icon: 'calendar', title: 'Nothing scheduled', text: 'Book measurement sessions, fittings, deliveries and collections.', action: html`<button class="btn btn-primary" data-act="add">Book appointment</button>` })}</div>`;
    let lastDay = '';
    return html`<div class="card"><ul class="list">${up.map(e => {
      const day = dayOf(e);
      const head = day !== lastDay ? html`<li class="list-item" style="background:var(--surface-2);padding-top:8px;padding-bottom:8px"><strong class="small">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</strong></li>` : '';
      lastDay = day;
      return html`${head}<li><button class="list-item w-full" style="text-align:left" data-ev="${e.id}">
        <span class="list-icon">${icon(e.kind === 'deadline' ? 'flag' : e.type === 'fitting' ? 'scissors' : e.type === 'measurement' ? 'ruler' : 'truck', 16)}</span>
        <span class="list-main"><strong>${e.title}</strong><small>${e.allDay ? 'All day' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}${e.customerId && custs.get(e.customerId) ? ` · ${custs.get(e.customerId).name}` : ''}</small></span>
        ${conflictIds.has(e.id) ? badge('Overlap', 'danger') : badge(typeLabel(e.type), e.kind === 'deadline' ? 'danger' : 'neutral')}</button></li>`;
    })}</ul></div>`;
  };

  const title = () => ui.view === 'month' ? ui.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : ui.view === 'week' ? `Week of ${fmtDate(isoDate(new Date(ui.cursor.getFullYear(), ui.cursor.getMonth(), ui.cursor.getDate() - ((ui.cursor.getDay() + 6) % 7))))}`
      : ui.view === 'day' ? fmtDate(isoDate(ui.cursor), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Upcoming';

  const paint = () => {
    el.innerHTML = String(html`
      ${pageHeader({ title: 'Calendar', subtitle: `${appts.filter(a => a.status === 'scheduled' && a.start >= new Date().toISOString()).length} upcoming appointment(s)${conflictIds.size ? ` · ${conflictIds.size} overlapping` : ''}`, actions: html`<button class="btn btn-primary" data-act="add">${icon('calendar-plus', 16)} Book appointment</button>` })}
      <div class="toolbar">
        ${ui.view !== 'list' ? html`<button class="icon-btn" data-nav="-1" aria-label="Previous">${icon('chevron-left', 18)}</button><button class="btn btn-secondary btn-sm" data-nav="0">Today</button><button class="icon-btn" data-nav="1" aria-label="Next">${icon('chevron-right', 18)}</button>` : ''}
        <h2 style="font-size:var(--fs-lg)">${title()}</h2><span class="spacer"></span>
        <div class="btn-group" role="group" aria-label="Calendar view">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['list', 'Upcoming']].map(([k, l]) => html`<button data-view="${k}" aria-pressed="${ui.view === k}">${l}</button>`)}</div>
      </div>
      ${ui.view === 'month' ? monthView() : ui.view === 'week' ? weekView(7) : ui.view === 'day' ? weekView(1) : listView()}
      <div class="row-wrap mt-3 small muted">${[['measurement', 'Measurement'], ['fitting', 'Fitting'], ['delivery', 'Delivery / collection'], ['deadline', 'Order due']].map(([k, l]) => html`<span class="row"><span class="cal-ev t-${k}" style="width:12px;height:12px;padding:0"></span>${l}</span>`)}</div>`);
  };
  paint();

  if (query.new) openAppointmentForm({}, { orderId: query.order }).then(r => { history.replaceState(null, '', '#/calendar'); if (r) render(el, params, {}); });

  const showEvent = async (id) => {
    const e = events.find(x => x.id === id);
    if (!e) return;
    if (e.kind === 'deadline') { location.hash = `#/orders/${e.orderId}`; return; }
    const a = appts.find(x => x.id === id);
    const r = await formModal({
      title: a.title, submitLabel: 'Edit',
      body: html`<dl class="kv span-2"><dt>Type</dt><dd>${typeLabel(a.type)}</dd><dt>When</dt><dd>${fmtDate(a.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(a.start)} – ${fmtTime(a.end)}</dd>
        <dt>Customer</dt><dd>${custs.get(a.customerId)?.name || '—'}</dd><dt>Status</dt><dd>${a.status}</dd><dt>Notes</dt><dd>${a.notes || '—'}</dd></dl>
        ${conflictIds.has(a.id) ? html`<div class="alert alert-danger span-2">${icon('triangle-alert', 18)}<div>Overlaps with another appointment.</div></div>` : ''}`,
      extraFooter: html`<button type="button" class="btn btn-danger-ghost" data-del-appt>${icon('trash-2', 16)} Delete</button>${a.customerId ? html`<button type="button" class="btn btn-ghost" data-remind-appt>${icon('message-square', 16)} Remind</button>` : ''}`,
      onOpen: (form, m) => {
        m.dialog.querySelector('[data-del-appt]').addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Delete appointment?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
          try { await deleteAppointment(a.id); m.close('deleted'); toast('Appointment deleted.', { type: 'success' }); } catch (err) { toastError(err); }
        });
        m.dialog.querySelector('[data-remind-appt]')?.addEventListener('click', async () => {
          m.close(null);
          (await import('./notifications.js')).composeMessage({ customer: custs.get(a.customerId), appointment: a, templateKey: 'appointment_reminder' });
        });
      },
      onSubmit: () => 'edit',
    });
    if (r === 'edit') { if (await openAppointmentForm(a)) render(el, params, {}); }
    else if (r === 'deleted') render(el, params, {});
  };

  return delegate(el, 'click', '[data-act],[data-view],[data-nav],[data-ev],[data-day]', async (e, b) => {
    const d = b.dataset;
    if (d.ev) { e.stopPropagation(); showEvent(d.ev); return; }
    if (d.act === 'add') { if (await openAppointmentForm()) render(el, params, {}); }
    else if (d.view) { ui.view = d.view; local.set('calView', ui.view); paint(); }
    else if (d.nav !== undefined) {
      const n = Number(d.nav);
      const c = ui.cursor;
      ui.cursor = n === 0 ? new Date() : ui.view === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : new Date(c.getFullYear(), c.getMonth(), c.getDate() + n * (ui.view === 'week' ? 7 : 1));
      paint();
    } else if (d.day && !e.target.closest('[data-ev]')) {
      if (ui.view === 'month') { ui.cursor = new Date(`${d.day}T00:00:00`); ui.view = 'day'; paint(); }
      else if (await openAppointmentForm({}, { date: d.day })) render(el, params, {});
    }
  });
}

