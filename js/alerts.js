// Computes live reminders from current data (nothing is hardcoded).
import { getAll } from './database.js';
import { loadOrderViews } from './services.js';
import { isLowStock } from './core/calc.js';
import { todayISO, addDays, fmtDate, money, relDays } from './utils.js';
import { local } from './storage.js';
import { getState } from './state.js';

const localDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function computeAlerts() {
  const [{ orders }, inventory, appointments] = await Promise.all([loadOrderViews(), getAll('inventory'), getAll('appointments')]);
  const today = todayISO();
  const soon = addDays(today, 2);
  const last = getState().stages.at(-1).key;
  const alerts = [];
  for (const o of orders) {
    if (o.cancelled || o.status === last) continue;
    if (o.overdue) alerts.push({ id: `overdue:${o.id}`, level: 'danger', icon: 'triangle-alert', title: `${o.number} is overdue`, body: `${o.customerName} · was due ${fmtDate(o.dueDate)}`, href: `#/orders/${o.id}` });
    else if (o.dueDate && o.dueDate <= soon) alerts.push({ id: `due:${o.id}`, level: 'warning', icon: 'clock', title: `${o.number} due ${relDays(o.dueDate)}`, body: `${o.customerName} · ${o.title}`, href: `#/orders/${o.id}` });
    if (o.status === 'ready' && o.balance > 0) alerts.push({ id: `bal:${o.id}`, level: 'info', icon: 'wallet', title: `Collect ${money(o.balance)} on ${o.number}`, body: `${o.customerName} · ready for collection`, href: `#/orders/${o.id}` });
  }
  for (const i of inventory.filter(isLowStock)) {
    alerts.push({ id: `stock:${i.id}`, level: 'warning', icon: 'package-minus', title: `Low stock: ${i.name}`, body: `${i.quantity} ${i.unit} left (minimum ${i.minLevel})`, href: `#/inventory/${i.id}` });
  }
  for (const a of appointments) {
    if (a.status !== 'cancelled' && a.start && todayISO() === localDate(a.start)) {
      alerts.push({ id: `appt:${a.id}`, level: 'info', icon: 'calendar', title: `Today: ${a.title}`, body: new Date(a.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), href: '#/calendar' });
    }
  }
  const lastBackup = local.get('lastBackupAt');
  const days = getState().prefs.backupReminderDays || 7;
  if (!lastBackup || (Date.now() - Date.parse(lastBackup)) / 86400000 > days) {
    alerts.push({ id: 'backup', level: 'warning', icon: 'hard-drive', title: lastBackup ? `Last backup was ${fmtDate(lastBackup)}` : 'You have never downloaded a backup', body: 'Your data lives only in this browser. Download a backup now.', href: '#/settings?tab=data' });
  }
  const rank = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);
  return alerts;
}
