// Fabriqon bootstrap: database, workspace gate, PIN lock, app shell, router.
import { openDb, getSetting, getAll, onDbEvent } from './database.js';
import { loadState, getState } from './state.js';
import { startRouter, navigate, refresh } from './router.js';
import { html, icon, raw, toast, toastError, delegate, isModalOpen, esc } from './ui.js';
import { applyTheme, isDark, setThemePref, onThemeChange } from './theme.js';
import { requestPersistence, local } from './storage.js';
import { registerServiceWorker } from './pwa.js';
import { runOnboarding } from './onboarding.js';
import { showLock } from './lock.js';
import { computeAlerts } from './alerts.js';
import { debounce, initials } from './utils.js';

const root = document.getElementById('app');

const NAV = [
  { section: 'Overview' },
  { path: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { section: 'Clients' },
  { path: '/customers', label: 'Customers', icon: 'users' },
  { path: '/measurements', label: 'Measurements', icon: 'ruler' },
  { section: 'Workshop' },
  { path: '/orders', label: 'Orders', icon: 'clipboard-list' },
  { path: '/production', label: 'Production', icon: 'square-kanban' },
  { path: '/designs', label: 'Designs & Styles', icon: 'shirt' },
  { path: '/fabric', label: 'Fabric Calculator', icon: 'calculator' },
  { section: 'Business' },
  { path: '/inventory', label: 'Inventory', icon: 'package' },
  { path: '/finance', label: 'Payments & Finance', icon: 'wallet' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar-days' },
  { path: '/reports', label: 'Reports', icon: 'chart-column' },
  { section: 'Tools' },
  { path: '/notifications', label: 'Messages & Alerts', icon: 'message-square', badge: true },
  { path: '/assistant', label: 'Tailoring Assistant', icon: 'sparkles' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

const BOTTOM = [
  { path: '/dashboard', label: 'Home', icon: 'house' },
  { path: '/customers', label: 'Customers', icon: 'users' },
  { path: '/orders', label: 'Orders', icon: 'clipboard-list' },
  { path: '/production', label: 'Production', icon: 'square-kanban' },
];

const m = (file) => () => import(`./modules/${file}.js`);
const ROUTES = [
  { path: '/dashboard', load: m('dashboard'), title: 'Dashboard' },
  { path: '/customers', load: m('customers'), title: 'Customers' },
  { path: '/customers/:id', load: m('customers'), title: 'Customer' },
  { path: '/measurements', load: m('measurements'), title: 'Measurements' },
  { path: '/measurements/new', load: m('measurements'), title: 'New measurement' },
  { path: '/measurements/:id', load: m('measurements'), title: 'Measurement' },
  { path: '/designs', load: m('designs'), title: 'Designs & Styles' },
  { path: '/orders', load: m('orders'), title: 'Orders' },
  { path: '/orders/new', load: m('orders'), title: 'New order' },
  { path: '/orders/:id', load: m('orders'), title: 'Order' },
  { path: '/orders/:id/edit', load: m('orders'), title: 'Edit order' },
  { path: '/production', load: m('production'), title: 'Production' },
  { path: '/fabric', load: m('fabric-calculator'), title: 'Fabric Calculator' },
  { path: '/inventory', load: m('inventory'), title: 'Inventory' },
  { path: '/inventory/:id', load: m('inventory'), title: 'Inventory item' },
  { path: '/finance', load: m('finance'), title: 'Payments & Finance' },
  { path: '/calendar', load: m('calendar'), title: 'Calendar' },
  { path: '/reports', load: m('analytics'), title: 'Reports' },
  { path: '/notifications', load: m('notifications'), title: 'Messages & Alerts' },
  { path: '/assistant', load: m('assistant'), title: 'Tailoring Assistant' },
  { path: '/settings', load: m('settings'), title: 'Settings' },
];

function brandMark() {
  return raw('<img class="brand-mark" src="assets/icons/logo.svg" alt="">');
}

function shellHtml() {
  const b = getState().business;
  return html`
  <div class="app ${local.get('sidebarCollapsed') ? 'sidebar-collapsed' : ''}" id="shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <a class="brand" href="#/dashboard">${brandMark()}<span class="brand-name">FABRI<span>QON</span></span></a>
      <nav class="nav">
        ${NAV.map(n => n.section
          ? html`<div class="nav-section">${n.section}</div>`
          : html`<a class="nav-link" href="#${n.path}" data-path="${n.path}" title="${n.label}">${icon(n.icon, 19)}<span class="nav-label">${n.label}</span>${n.badge ? raw('<span class="nav-count" data-alert-count hidden></span>') : ''}</a>`)}
      </nav>
      <div class="sidebar-foot">
        <a class="biz-chip" href="#/settings" title="Business settings">
          ${b?.logo ? html`<img src="${b.logo}" alt="">` : html`<span class="avatar avatar-initials">${initials(b?.name || 'F')}</span>`}
          <span class="biz-meta"><strong>${b?.name || 'My business'}</strong><small>${b?.type || ''}</small></span>
        </a>
        <p class="credit">Developed by <strong>Abdullah</strong> · Esoft Dev</p>
      </div>
    </aside>
    <div class="scrim" data-action="close-nav"></div>
    <div class="main">
      <div id="banners"></div>
      <header class="topbar">
        <button class="icon-btn mobile-only" data-action="open-nav" aria-label="Open menu" id="menu-btn">${icon('menu', 22)}</button>
        <button class="icon-btn collapse-btn" data-action="collapse" aria-label="Collapse sidebar">${icon('panel-left-close', 20)}</button>
        <div class="topbar-title" id="topbar-title"></div>
        <div class="global-search" id="global-search" role="search">
          ${icon('search', 16)}
          <label class="sr-only" for="gs-input">Search customers and orders</label>
          <input id="gs-input" type="search" placeholder="Search customers, phone, orders…" autocomplete="off" aria-controls="gs-results" aria-expanded="false">
          <div class="search-results" id="gs-results" hidden role="listbox"></div>
        </div>
        <div class="topbar-actions">
          <span class="conn-pill" id="conn" role="status"><span class="dot"></span><span class="lbl">Online</span></span>
          <button class="icon-btn search-toggle" data-action="search" aria-label="Search">${icon('search', 20)}</button>
          <a class="icon-btn bell" href="#/notifications" aria-label="Alerts and messages">${icon('bell', 20)}<span class="badge-dot" data-alert-count hidden></span></a>
          <button class="icon-btn" data-action="theme" aria-label="Toggle dark mode" id="theme-btn">${icon(isDark() ? 'sun' : 'moon', 20)}</button>
          ${getState().pin ? html`<button class="icon-btn" data-action="lock" aria-label="Lock app">${icon('lock', 20)}</button>` : ''}
        </div>
      </header>
      <main class="content" id="content" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Quick navigation">
      ${BOTTOM.map(n => html`<a href="#${n.path}" data-path="${n.path}" aria-label="${n.label}">${icon(n.icon, 22)}<span>${n.label}</span></a>`)}
      <button data-action="open-nav" aria-label="More sections">${icon('layout-grid', 22)}<span>More</span></button>
    </nav>
    <button class="fab" data-action="quick-add" aria-label="Quick add">${icon('plus', 26)}</button>
  </div>`;
}

// ---------- Shell behaviours ----------
function setActiveNav(path) {
  const top = `/${path.split('/')[1] || 'dashboard'}`;
  document.querySelectorAll('[data-path]').forEach(a => {
    if (a.dataset.path === top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function updateConnection() {
  const el = document.getElementById('conn');
  if (!el) return;
  const on = navigator.onLine;
  el.classList.toggle('offline', !on);
  el.querySelector('.lbl').textContent = on ? 'Online' : 'Offline';
  el.title = on ? 'Online — everything is saved on this device' : 'Offline — Fabriqon keeps working; data is saved on this device';
}

let alertsTimer;
async function updateAlertBadge() {
  try {
    const [alerts, notes] = await Promise.all([computeAlerts(), getAll('notifications')]);
    const n = alerts.filter(a => a.level !== 'info').length + notes.filter(x => !x.read && x.kind === 'alert').length;
    document.querySelectorAll('[data-alert-count]').forEach(el => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
  } catch (err) { console.warn('alerts', err); }
}
const scheduleAlerts = debounce(updateAlertBadge, 600);

function showBanner(id, content, cls = '') {
  const host = document.getElementById('banners');
  if (!host || host.querySelector(`[data-banner="${id}"]`)) return;
  const div = document.createElement('div');
  div.className = `banner ${cls}`;
  div.dataset.banner = id;
  div.setAttribute('role', 'status');
  div.innerHTML = String(content);
  host.appendChild(div);
  return div;
}

function setupGlobalSearch(shell) {
  const wrap = shell.querySelector('#global-search');
  const input = shell.querySelector('#gs-input');
  const results = shell.querySelector('#gs-results');
  let data = null;
  let active = -1;
  const load = async () => {
    const [customers, orders] = await Promise.all([getAll('customers'), getAll('orders')]);
    const names = new Map(customers.map(c => [c.id, c.name]));
    data = { customers, orders: orders.map(o => ({ ...o, customerName: names.get(o.customerId) || '' })) };
  };
  const close = () => { results.hidden = true; input.setAttribute('aria-expanded', 'false'); wrap.classList.remove('open'); };
  const run = debounce(async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    if (!data) await load();
    const digits = q.replace(/\D/g, '');
    const cs = data.customers.filter(c => c.nameLower?.includes(q) || c.code?.toLowerCase().includes(q) || (digits.length >= 3 && c.phone?.replace(/\D/g, '').includes(digits))).slice(0, 6);
    const os = data.orders.filter(o => o.number.toLowerCase().includes(q) || o.title?.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q)).slice(0, 6);
    active = -1;
    results.innerHTML = cs.length || os.length ? String(html`
      ${cs.length ? html`<div class="group">Customers</div>${cs.map(c => html`<a href="#/customers/${c.id}" role="option">${icon('user', 16)}<span class="truncate">${c.name}</span><small class="subtle">${c.phone || c.code}</small></a>`)}` : ''}
      ${os.length ? html`<div class="group">Orders</div>${os.map(o => html`<a href="#/orders/${o.id}" role="option">${icon('clipboard-list', 16)}<span class="truncate">${o.number} · ${o.title}</span><small class="subtle">${o.customerName}</small></a>`)}` : ''}`)
      : String(html`<p class="small muted" style="padding:10px">No matches for “${input.value}”.</p>`);
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }, 120);
  input.addEventListener('focus', () => { data = null; });
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    const links = [...results.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('active', i === active));
    } else if (e.key === 'Enter' && links[Math.max(0, active)]) {
      e.preventDefault();
      location.hash = links[Math.max(0, active)].getAttribute('href');
      input.value = ''; close(); input.blur();
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  results.addEventListener('click', (e) => { if (e.target.closest('a')) { input.value = ''; close(); } });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target) && !e.target.closest('[data-action="search"]')) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
      if (isModalOpen()) return;
      e.preventDefault();
      wrap.classList.add('open');
      input.focus();
    }
  });
  return () => { wrap.classList.add('open'); input.focus(); };
}

let lastActivity = Date.now();
let locked = false;
async function lockNow() {
  const { pin, business } = getState();
  if (!pin || locked) return;
  locked = true;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:var(--bg)';
  document.body.appendChild(overlay);
  await showLock(overlay, pin, business?.name);
  overlay.remove();
  locked = false;
  lastActivity = Date.now();
}

function setupIdleLock() {
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    const mins = Number(getState().prefs.lockAfterMinutes) || 0;
    if (getState().pin && mins > 0 && Date.now() - lastActivity > mins * 60000) lockNow();
  }, 15000);
}

async function mountShell() {
  root.innerHTML = String(shellHtml());
  const shell = document.getElementById('shell');
  const openSearch = setupGlobalSearch(shell);
  const closeNav = () => shell.classList.remove('nav-open');

  delegate(shell, 'click', '[data-action]', async (e, el) => {
    const a = el.dataset.action;
    if (a === 'open-nav') shell.classList.add('nav-open');
    else if (a === 'close-nav') closeNav();
    else if (a === 'collapse') {
      shell.classList.toggle('sidebar-collapsed');
      const c = shell.classList.contains('sidebar-collapsed');
      local.set('sidebarCollapsed', c);
      el.innerHTML = String(icon(c ? 'panel-left-open' : 'panel-left-close', 20));
    } else if (a === 'theme') {
      setThemePref(isDark() ? 'light' : 'dark');
      el.innerHTML = String(icon(isDark() ? 'sun' : 'moon', 20));
      refresh();
    } else if (a === 'lock') lockNow();
    else if (a === 'search') openSearch();
    else if (a === 'quick-add') (await import('./quick.js')).openQuickAdd();
  });
  shell.querySelector('.nav').addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

  window.addEventListener('online', () => { updateConnection(); toast('Back online.', { type: 'success' }); });
  window.addEventListener('offline', () => { updateConnection(); toast('You are offline. Fabriqon keeps working and saves to this device.', { type: 'warning' }); });
  updateConnection();
  onThemeChange((dark) => { const b = document.getElementById('theme-btn'); if (b) b.innerHTML = String(icon(dark ? 'sun' : 'moon', 20)); });

  onDbEvent('change', (e) => {
    scheduleAlerts();
    if (e.detail.stores.includes('settings')) loadState(getSetting).then(() => updateBusinessChip());
  });
  onDbEvent('versionchange', () => showBanner('ver', html`${icon('refresh-cw', 16)}<span>Fabriqon was updated in another tab.</span><button class="btn btn-sm btn-primary" data-reload>Reload</button>`, 'banner-warn'));

  const content = document.getElementById('content');
  await startRouter(ROUTES, content, {
    onNavigate: ({ path, route }) => {
      // Dialogs belong to the page that opened them; close them on navigation.
      document.querySelectorAll('dialog.modal[open]').forEach(d => d.dispatchEvent(new Event('cancel')));
      setActiveNav(path);
      document.getElementById('shell')?.classList.toggle('no-fab', /^\/(measurements\/new|orders\/new|orders\/[^/]+\/edit)/.test(path));
      document.getElementById('topbar-title').textContent = route.title;
      document.title = `${route.title} · Fabriqon`;
      window.scrollTo(0, 0);
    },
    onRendered: () => { if (document.activeElement === document.body) content.focus({ preventScroll: true }); },
    onError: (err, el) => {
      el.innerHTML = String(html`<div class="card card-pad"><div class="alert alert-danger">${icon('circle-alert', 18)}<div><strong>Something went wrong loading this page.</strong>${err.message}</div></div><button class="btn btn-secondary mt-4" data-reload>Reload</button></div>`);
    },
  });
  updateAlertBadge();
  alertsTimer = setInterval(updateAlertBadge, 5 * 60 * 1000);
}

function updateBusinessChip() {
  const b = getState().business;
  const chip = document.querySelector('.biz-chip');
  if (!chip || !b) return;
  chip.innerHTML = String(html`${b.logo ? html`<img src="${b.logo}" alt="">` : html`<span class="avatar avatar-initials">${initials(b.name)}</span>`}<span class="biz-meta"><strong>${b.name}</strong><small>${b.type || ''}</small></span>`);
}

function wireServiceWorker() {
  registerServiceWorker({
    onUpdate: (apply) => {
      const el = showBanner('update', html`${icon('refresh-cw', 16)}<span><strong>A new version of Fabriqon is ready.</strong> Your data is not affected.</span><button class="btn btn-sm btn-primary" data-apply>Update now</button>`);
      el?.querySelector('[data-apply]').addEventListener('click', apply);
    },
    onReady: () => toast('Fabriqon is ready to work offline.', { type: 'success' }),
  });
}

async function storageCheck() {
  const p = await requestPersistence();
  local.set('persisted', p.persisted);
  if (p.supported && !p.persisted && !local.get('persistBannerDismissed')) {
    const el = showBanner('persist', html`${icon('triangle-alert', 16)}<span>Storage isn't permanent in this browser yet. Install the app and back up regularly to protect your records.</span><button class="btn btn-sm btn-ghost" data-dismiss>Dismiss</button>`, 'banner-warn');
    el?.querySelector('[data-dismiss]').addEventListener('click', () => { local.set('persistBannerDismissed', true); el.remove(); });
  }
}

document.addEventListener('click', (e) => { if (e.target.closest('[data-reload]')) location.reload(); });

async function boot() {
  applyTheme();
  try {
    await openDb();
    await loadState(getSetting);
  } catch (err) {
    root.innerHTML = String(html`<div class="gate"><div class="gate-card"><div class="alert alert-danger">${icon('circle-alert', 18)}<div><strong>Fabriqon could not open its database.</strong>${err.message}<br><br>Private/incognito windows and some browser settings block local storage. Try a normal window in Chrome, Edge, Safari or Firefox.</div></div></div></div>`);
    return;
  }
  wireServiceWorker();
  if (!getState().business) {
    const { seed } = await runOnboarding(root);
    if (seed) {
      try { await (await import('./seed.js')).seedSampleData(); } catch (err) { toastError(err); }
    }
    await loadState(getSetting);
    if (!location.hash || location.hash === '#/') history.replaceState(null, '', '#/dashboard');
    toast(`Welcome to Fabriqon, ${getState().business.owner || ''}!`.replace(', !', '!'), { type: 'success' });
  } else if (getState().pin) {
    await showLock(root, getState().pin, getState().business.name);
  }
  await mountShell();
  setupIdleLock();
  storageCheck();
}

boot().catch((err) => {
  console.error(err);
  root.innerHTML = `<div style="padding:24px">Fabriqon failed to start: ${esc(err.message)}</div>`;
});

export { navigate };
