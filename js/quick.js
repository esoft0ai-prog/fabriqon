// Quick-add launcher used by the dashboard and the mobile FAB.
import { openModal, html, icon } from './ui.js';
import { navigate } from './router.js';

export const QUICK_ACTIONS = [
  { key: 'customer', label: 'Add customer', icon: 'user-plus' },
  { key: 'measurement', label: 'Add measurement', icon: 'ruler' },
  { key: 'order', label: 'Create order', icon: 'clipboard-list' },
  { key: 'payment', label: 'Record payment', icon: 'banknote' },
  { key: 'fabric', label: 'Add fabric', icon: 'package-plus' },
  { key: 'invoice', label: 'Generate invoice', icon: 'file-text' },
  { key: 'expense', label: 'Record expense', icon: 'receipt' },
  { key: 'appointment', label: 'Book appointment', icon: 'calendar-plus' },
];

export async function runQuickAction(key) {
  switch (key) {
    case 'customer': {
      const rec = await (await import('./modules/customers.js')).openCustomerForm();
      if (rec) navigate(`/customers/${rec.id}`);
      break;
    }
    case 'measurement': navigate('/measurements/new'); break;
    case 'order': navigate('/orders/new'); break;
    case 'payment': (await import('./modules/finance.js')).openPaymentForm(); break;
    case 'fabric': (await import('./modules/inventory.js')).openItemForm({ category: 'Fabric', unit: 'yards' }); break;
    case 'invoice': (await import('./modules/finance.js')).pickOrderForInvoice(); break;
    case 'expense': (await import('./modules/finance.js')).openExpenseForm(); break;
    case 'appointment': (await import('./modules/calendar.js')).openAppointmentForm(); break;
    default: break;
  }
}

export function openQuickAdd() {
  const m = openModal({
    title: 'Quick add',
    size: 'sm',
    body: html`<div class="quick-actions" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      ${QUICK_ACTIONS.map(a => html`<button class="qa card card-link" data-qa="${a.key}"><span class="qa-icon">${icon(a.icon, 20)}</span>${a.label}</button>`)}
    </div>`,
  });
  m.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qa]');
    if (!b) return;
    m.close();
    runQuickAction(b.dataset.qa);
  });
}
