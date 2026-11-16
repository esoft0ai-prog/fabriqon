// Minimal hash router: "#/orders/abc?tab=x" -> route "/orders/:id".
let routes = [];
let outlet = null;
let cleanup = null;
let current = null;
let hooks = {};
let renderToken = 0;

const compile = (pattern) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })}/?$`);
  return { re, keys };
};

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/dashboard';
  const [path, qs = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function startRouter(routeTable, el, opts = {}) {
  routes = routeTable.map(r => ({ ...r, ...compile(r.path) }));
  outlet = el;
  hooks = opts;
  window.addEventListener('hashchange', () => render());
  return render();
}

export async function render() {
  const { path, query } = parseHash();
  let match = null, params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (!match) { navigate('/dashboard', { replace: true }); return; }
  const token = ++renderToken;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  current = { route: match, params, query, path };
  hooks.onNavigate?.(current);
  try {
    const mod = await match.load();
    if (token !== renderToken) return; // a newer navigation won
    const res = await mod.render(outlet, params, query);
    if (token !== renderToken) { if (typeof res === 'function') res(); return; }
    cleanup = res;
    hooks.onRendered?.(current);
  } catch (err) {
    console.error(err);
    hooks.onError?.(err, outlet);
  }
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { render(); return; }
  if (replace) { history.replaceState(null, '', target); render(); } else location.hash = target;
}

export const refresh = () => render();
export const currentRoute = () => current;
