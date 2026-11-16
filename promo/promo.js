// Time-scripted promo. seek(t) puts the whole stage (and the real app in the
// phone) into the state for time t, so the renderer can capture frames
// deterministically. Open promo.html?play to watch it in real time.
const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
/** 0→1 fade/slide in over [a, a+d], 1→0 out over [b-d2, b]. */
const inOut = (t, a, b, d = 0.45, d2 = 0.3) => Math.min(ease(prog(t, a, a + d)), 1 - prog(t, b - d2, b));

export const DURATION = 40;

const app = $('#app');
const appDoc = () => app.contentDocument;
const appWin = () => app.contentWindow;
let ids = {};

async function lookupIds() {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('fabriqon'); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const all = (s) => new Promise(res => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
  const [customers, orders] = await Promise.all([all('customers'), all('orders')]);
  ids.measureCustomer = customers.find(c => c.name.startsWith('Adebayo'))?.id;
  ids.order = orders.find(o => o.title.startsWith('Bridesmaid'))?.id || orders[0]?.id;
}

function injectAppCss() {
  const d = appDoc();
  if (!d || d.getElementById('promo-css')) return;
  const s = d.createElement('style');
  s.id = 'promo-css';
  s.textContent = '#banners,.fab,#toasts{display:none!important} html{scrollbar-width:none} ::-webkit-scrollbar{display:none} *{caret-color:transparent}';
  d.head.appendChild(s);
}

const typeInto = (value) => {
  const inp = appDoc()?.querySelector('#mf-input');
  if (!inp) return;
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (sel) => appDoc()?.querySelector(sel)?.click();
const centerFocus = () => {
  const el = appDoc()?.querySelector('.measure-focus');
  if (el) appWin().scrollTo(0, el.getBoundingClientRect().top + appWin().scrollY - 150);
};

/** Scenes that show the app in the phone. Actions fire once at local progress p. */
const SCENES = [
  {
    from: 6.4, to: 11.6, route: '/dashboard',
    title: 'Your whole business, <em>at a glance</em>', sub: 'Orders, balances & deadlines — calculated for you',
    update: (p) => appWin().scrollTo(0, ease(prog(p, 0.22, 1)) * 1250),
  },
  {
    from: 11.6, to: 17.2, route: () => `/measurements/new?customer=${ids.measureCustomer}`,
    title: 'Take measurements <em>in seconds</em>', sub: 'One field at a time — every version saved',
    setup: () => centerFocus(),
    actions: [
      [0.16, () => typeInto('1')], [0.22, () => typeInto('10')], [0.28, () => typeInto('104')],
      [0.42, () => { click('[data-nav="1"]'); centerFocus(); }],
      [0.52, () => typeInto('4')], [0.58, () => typeInto('47')],
      [0.7, () => { click('[data-nav="1"]'); centerFocus(); }],
      [0.82, () => { click('[data-same]'); centerFocus(); }],
    ],
  },
  {
    from: 17.2, to: 22.2, route: '/production',
    title: 'Track every garment', sub: 'From cutting to sewing to collection',
    setup: () => { const k = appDoc().querySelector('.kanban'); if (k) appWin().scrollTo(0, k.getBoundingClientRect().top + appWin().scrollY - 80); },
    update: (p) => {
      const k = appDoc().querySelector('.kanban');
      if (!k) return;
      const stops = [...k.querySelectorAll('.kanban-col')].filter(c => c.querySelector('.job')).map(c => Math.min(c.offsetLeft - k.offsetLeft - 4, k.scrollWidth - k.clientWidth));
      if (!stops.length) return;
      // Hold on each column, then glide to the next.
      const seg = 1 / stops.length;
      const i = Math.min(stops.length - 1, Math.floor(p / seg));
      const local = (p - i * seg) / seg;
      const next = stops[Math.min(stops.length - 1, i + 1)];
      k.scrollLeft = stops[i] + (next - stops[i]) * ease(prog(local, 0.55, 1));
    },
  },
  {
    from: 22.2, to: 27.6, route: () => `/orders/${ids.order}`,
    title: 'Never forget <em>who owes you</em>', sub: 'Deposits, balances, invoices & receipts',
    update: (p) => appWin().scrollTo(0, ease(prog(p, 0.1, 0.5)) * 520),
  },
  {
    from: 27.6, to: 31.6, route: '/fabric',
    title: 'Know how many <em>yards to buy</em>', sub: 'Fabric estimates from real measurements',
    setup: async () => {
      const sel = appDoc().querySelector('[name=customerId]');
      if (sel && ids.measureCustomer) { sel.value = ids.measureCustomer; sel.dispatchEvent(new Event('input', { bubbles: true })); await wait(700); }
      const r = appDoc().querySelector('#fc-result');
      if (r) appWin().scrollTo(0, r.getBoundingClientRect().top + appWin().scrollY - 120);
    },
  },
  {
    from: 31.6, to: 35.0, route: '/customers',
    title: 'Works <em>without internet</em>', sub: 'Built for real workshops, real conditions',
    update: (p) => appWin().scrollTo(0, ease(prog(p, 0.1, 0.9)) * 300),
  },
];

let current = null;
const fired = new Set();

async function enterScene(s) {
  current = s;
  fired.clear();
  $('#wipe').style.opacity = 1;
  const route = typeof s.route === 'function' ? s.route() : s.route;
  appWin().location.hash = `#${route}`;
  await wait(1300);
  injectAppCss();
  appWin().scrollTo(0, 0);
  if (s.setup) await s.setup();
  await wait(150);
}

export async function seek(t) {
  // Background motion
  $('#ring1').style.transform = `rotate(${t * 4}deg)`;
  $('#ring2').style.transform = `rotate(${-t * 3}deg)`;
  $('#progress').style.width = `${(t / DURATION) * 100}%`;

  // Hook
  const hook = 1 - prog(t, 3.1, 3.4);
  $('#hook').style.opacity = hook;
  $('#hook').style.display = hook > 0 ? 'flex' : 'none';
  $('#hook .note').style.transform = `rotate(-7deg) translateY(${(1 - ease(prog(t, 0, 0.5))) * -500}px)`;
  $('#hook .strike').style.transform = `rotate(-12deg) scaleX(${ease(prog(t, 1.1, 1.6))})`;
  const big = ease(prog(t, 0.25, 0.75));
  $('#hook .big').style.cssText = `opacity:${big};transform:translateY(${(1 - big) * 60}px)`;
  const then = ease(prog(t, 1.8, 2.3));
  $('#hook .then').style.cssText = `opacity:${then};transform:translateY(${(1 - then) * 40}px)`;

  // Logo
  const lo = inOut(t, 3.4, 6.5, 0.5, 0.35);
  $('#logo').style.display = lo > 0 ? 'flex' : 'none';
  $('#logo').style.opacity = lo;
  const lp = ease(prog(t, 3.4, 4.0));
  $('#logo img').style.transform = `scale(${0.55 + 0.45 * lp}) rotate(${(1 - lp) * -20}deg)`;
  const w = ease(prog(t, 3.85, 4.35));
  $('#logo .word').style.cssText = `opacity:${w};transform:translateY(${(1 - w) * 50}px);letter-spacing:${0.3 - 0.22 * w}em`;
  const tg = ease(prog(t, 4.35, 4.85));
  $('#logo .tag').style.cssText = `opacity:${tg};transform:translateY(${(1 - tg) * 30}px)`;

  // Phone in/out
  const ph = Math.min(ease(prog(t, 6.15, 6.9)), 1 - ease(prog(t, 34.7, 35.25)));
  $('#phone').style.display = ph > 0 ? 'block' : 'none';
  $('#phone').style.transform = `translateY(${(1 - ph) * 1500}px) scale(${0.98 + 0.02 * Math.sin(t * 0.8)})`;

  // Phone scenes
  const scene = SCENES.find(s => t >= s.from && t < s.to) || null;
  if (scene && scene !== current) await enterScene(scene);
  if (!scene) current = null;
  if (scene) {
    const p = prog(t, scene.from, scene.to);
    for (const [at, fn] of scene.actions || []) if (p >= at && !fired.has(at)) { fired.add(at); fn(); }
    scene.update?.(p);
    // Wipe covers the first moment of each scene while the route loads.
    $('#wipe').style.opacity = scene === SCENES[0] ? 0 : 1 - ease(prog(t, scene.from, scene.from + 0.25));
    const c = inOut(t, scene.from, scene.to, 0.4, 0.25);
    $('#title').innerHTML = scene.title;
    $('#sub').textContent = scene.sub;
    $('#caption').style.cssText = `opacity:${c};transform:translateY(${(1 - c) * 40}px)`;
  } else {
    $('#caption').style.opacity = 0;
  }

  // Invoice card over the orders scene
  const pdf = inOut(t, 24.6, 27.5, 0.45, 0.3);
  $('#pdf').style.display = pdf > 0 ? 'block' : 'none';
  Object.assign($('#pdf').style, { opacity: pdf, transform: `translateY(${(1 - pdf) * 120}px) rotate(${(1 - pdf) * 6 - 2}deg)` });

  // Offline badge
  const b = inOut(t, 32.0, 35.0, 0.45, 0.3);
  $('#badge').style.display = b > 0 ? 'flex' : 'none';
  Object.assign($('#badge').style, { opacity: b, transform: `translateY(${(1 - b) * 80}px) scale(${0.94 + 0.06 * b})` });

  // Call to action
  const c2 = ease(prog(t, 35.2, 35.8));
  $('#cta').style.display = c2 > 0 ? 'flex' : 'none';
  $('#cta').style.opacity = c2;
  $('#cta img').style.transform = `scale(${0.6 + 0.4 * ease(prog(t, 35.2, 35.9))})`;
  [...document.querySelectorAll('.chips span')].forEach((el, i) => {
    const k = ease(prog(t, 36.0 + i * 0.12, 36.4 + i * 0.12));
    el.style.cssText = `opacity:${k};transform:translateY(${(1 - k) * 30}px)`;
  });
  const ask = ease(prog(t, 37.2, 37.7));
  $('.ask').style.cssText = `opacity:${ask};transform:scale(${0.85 + 0.15 * ask + 0.02 * Math.sin(t * 6) * ask})`;
}

export async function ready() {
  await new Promise(r => (app.contentDocument?.readyState === 'complete' ? r() : app.addEventListener('load', r, { once: true })));
  await wait(1500);
  injectAppCss();
  await lookupIds();
  await document.fonts.ready;
}

window.promo = { seek, ready, DURATION };

if (new URLSearchParams(location.search).has('play')) {
  await ready();
  const start = performance.now();
  const loop = async () => {
    const t = ((performance.now() - start) / 1000) % DURATION;
    await seek(t);
    requestAnimationFrame(loop);
  };
  loop();
}
