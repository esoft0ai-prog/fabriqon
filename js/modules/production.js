// Production board: kanban by workflow stage with drag-and-drop (desktop)
// and tap-to-move buttons (touch).
import { html, icon, raw, toast, toastError, emptyState, pageHeader, badge, delegate, skeleton } from '../ui.js';
import { loadOrderViews, changeStage } from '../services.js';
import { fmtDate, relDays, todayISO, addDays } from '../utils.js';
import { getState, stageLabel, staffName } from '../state.js';
import { local } from '../storage.js';
import { openNoteForm } from './orders.js';

export async function render(el) {
  el.innerHTML = String(html`${pageHeader({ title: 'Production' })}${skeleton(5)}`);
  let { orders } = await loadOrderViews();
  const stages = getState().stages;
  const last = stages.at(-1).key;
  const ui = { worker: local.get('prodWorker', ''), showDelivered: false };

  const paint = () => {
    const recentCut = addDays(todayISO(), -14);
    const live = orders.filter(o => !o.cancelled && (o.status !== last || (ui.showDelivered && (o.deliveredAt || '').slice(0, 10) >= recentCut)))
      .filter(o => !ui.worker || (ui.worker === 'none' ? !o.assignedTo : o.assignedTo === ui.worker));
    const cols = stages.filter(s => s.key !== last || ui.showDelivered);
    const overdue = live.filter(o => o.overdue).length;
    el.innerHTML = String(html`
      ${pageHeader({
        title: 'Production', subtitle: `${live.filter(o => o.status !== last).length} jobs in the workshop${overdue ? ` · ${overdue} overdue` : ''}`,
        actions: html`<a class="btn btn-primary" href="#/orders/new">${icon('plus', 16)} New order</a>`,
      })}
      <div class="toolbar">
        ${getState().staff.length ? html`<label class="sr-only" for="p-w">Tailor</label><select id="p-w" class="input"><option value="">All tailors</option>${getState().staff.map(s => html`<option value="${s.id}" ${ui.worker === s.id ? raw('selected') : ''}>${s.name}</option>`)}<option value="none" ${ui.worker === 'none' ? raw('selected') : ''}>Unassigned</option></select>` : ''}
        <label class="check small"><input type="checkbox" id="p-del" ${ui.showDelivered ? raw('checked') : ''}><span>Show delivered (last 14 days)</span></label>
        <span class="spacer"></span><span class="small subtle hide-sm">Drag cards between columns, or use the arrows.</span>
      </div>
      ${!orders.filter(o => !o.cancelled).length ? html`<div class="card">${emptyState({ icon: 'square-kanban', title: 'Nothing in production', text: 'Orders appear here as they move through your workflow.', action: html`<a class="btn btn-primary" href="#/orders/new">Create an order</a>` })}</div>` : html`
      <div class="kanban" role="list">
        ${cols.map(s => {
          const jobs = live.filter(o => o.status === s.key).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
          return html`<section class="kanban-col" data-stage="${s.key}" role="listitem" aria-label="${s.label}">
            <div class="kanban-head"><span>${s.label}</span><span class="count">${jobs.length}</span></div>
            <div class="kanban-list">${jobs.map(o => job(o)) }${jobs.length ? '' : html`<p class="small subtle center" style="padding:12px 0">Empty</p>`}</div>
          </section>`;
        })}
      </div>`}`);
  };

  const job = (o) => {
    const i = stages.findIndex(s => s.key === o.status);
    return html`<article class="job ${o.overdue ? 'overdue' : ''}" draggable="true" data-id="${o.id}" tabindex="0" aria-label="${o.number} ${o.title}">
      <div class="job-top"><span class="job-num">${o.number}</span>${o.overdue ? badge('Overdue', 'danger') : o.dueDate ? html`<span class="small ${o.dueDate <= addDays(todayISO(), 2) ? 'text-warning strong' : 'subtle'}">${o.status === last ? fmtDate(o.deliveredAt) : relDays(o.dueDate)}</span>` : ''}</div>
      <a href="#/orders/${o.id}" class="strong">${o.title}</a>
      <div class="small muted">${o.customerName}${o.assignedTo ? ` · ${staffName(o.assignedTo)}` : ''}</div>
      ${o.balance > 0 ? html`<div class="small text-danger">Balance due</div>` : ''}
      <div class="job-actions">
        <button class="icon-btn sm" data-move="-1" ${i <= 0 ? raw('disabled') : ''} aria-label="Move back to ${stages[i - 1]?.label || ''}" title="${stages[i - 1]?.label || ''}">${icon('chevron-left', 16)}</button>
        <button class="icon-btn sm" data-note aria-label="Add note or photo" title="Note / photo">${icon('camera', 16)}</button>
        <button class="icon-btn sm" data-move="1" ${i >= stages.length - 1 ? raw('disabled') : ''} aria-label="Move to ${stages[i + 1]?.label || ''}" title="${stages[i + 1]?.label || ''}">${icon('chevron-right', 16)}</button>
      </div>
    </article>`;
  };

  const move = async (id, stage) => {
    const o = orders.find(x => x.id === id);
    if (!o || o.status === stage) return;
    try {
      await changeStage(id, stage);
      o.status = stage;
      if (stage === last) o.deliveredAt = new Date().toISOString();
      toast(`${o.number} → ${stageLabel(stage)}`, { type: 'success', timeout: 2500 });
      paint();
    } catch (err) { toastError(err); }
  };

  paint();
  let dragId = null;
  const onDragStart = (e) => { const j = e.target.closest('.job'); if (!j) return; dragId = j.dataset.id; j.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); };
  const onDragEnd = (e) => { e.target.closest('.job')?.classList.remove('dragging'); el.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target')); };
  const onDragOver = (e) => { const col = e.target.closest('.kanban-col'); if (!col || !dragId) return; e.preventDefault(); el.querySelectorAll('.drop-target').forEach(c => c !== col && c.classList.remove('drop-target')); col.classList.add('drop-target'); };
  const onDrop = (e) => { const col = e.target.closest('.kanban-col'); if (!col || !dragId) return; e.preventDefault(); const id = dragId; dragId = null; move(id, col.dataset.stage); };
  el.addEventListener('dragstart', onDragStart);
  el.addEventListener('dragend', onDragEnd);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('drop', onDrop);

  const offs = [
    delegate(el, 'click', '[data-move]', (e, b) => {
      const id = b.closest('.job').dataset.id;
      const o = orders.find(x => x.id === id);
      const i = stages.findIndex(s => s.key === o.status) + Number(b.dataset.move);
      if (stages[i]) move(id, stages[i].key);
    }),
    delegate(el, 'click', '[data-note]', async (e, b) => {
      const o = orders.find(x => x.id === b.closest('.job').dataset.id);
      if (await openNoteForm(o)) toast('Update saved.', { type: 'success' });
    }),
    delegate(el, 'keydown', '.job', (e, j) => {
      if (e.key === 'Enter' && e.target === j) location.hash = `#/orders/${j.dataset.id}`;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target === j && e.shiftKey) {
        j.querySelector(`[data-move="${e.key === 'ArrowRight' ? 1 : -1}"]`)?.click();
      }
    }),
    delegate(el, 'change', '#p-w', (e, s) => { ui.worker = s.value; local.set('prodWorker', ui.worker); paint(); }),
    delegate(el, 'change', '#p-del', (e, c) => { ui.showDelivered = c.checked; paint(); }),
  ];
  return () => {
    offs.forEach(f => f());
    el.removeEventListener('dragstart', onDragStart); el.removeEventListener('dragend', onDragEnd);
    el.removeEventListener('dragover', onDragOver); el.removeEventListener('drop', onDrop);
  };
}
