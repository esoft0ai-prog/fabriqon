// Optional local PIN. This deters casual access on a shared device only: it is
// NOT encryption — data in IndexedDB remains readable to anyone with access to
// the browser profile and developer tools.
import { html, icon, raw } from './ui.js';

const ITERATIONS = 150000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4–8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(pin, salt, ITERATIONS)), iterations: ITERATIONS, length: pin.length };
}

export async function verifyPin(pin, rec) {
  if (!rec) return true;
  const bits = await derive(pin, unb64(rec.salt), rec.iterations);
  const a = new Uint8Array(bits), b = unb64(rec.hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Renders a full-screen lock and resolves once the correct PIN is entered. */
export function showLock(root, pinRec, businessName = 'Fabriqon') {
  return new Promise((resolve) => {
    let entry = '';
    let attempts = 0;
    let lockedUntil = 0;
    const len = pinRec.length || 4;
    root.innerHTML = String(html`
      <div class="gate"><div class="gate-card" style="max-width:380px;text-align:center">
        <img class="brand-mark" src="assets/icons/logo.svg" alt="" style="width:52px;height:52px;margin:0 auto 12px">
        <h1 style="font-size:1.2rem">${businessName}</h1>
        <p class="muted small mt-2">Enter your PIN to unlock</p>
        <div class="pin-dots" aria-hidden="true">${Array.from({ length: len }, () => raw('<span></span>'))}</div>
        <p class="small text-danger" id="pin-msg" role="alert" style="min-height:20px"></p>
        <label class="sr-only" for="pin-input">PIN</label>
        <input id="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" class="sr-only">
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => html`<button type="button" data-n="${n}">${n}</button>`)}
          <span></span><button type="button" data-n="0">0</button>
          <button type="button" data-del aria-label="Delete">${icon('arrow-left', 22)}</button>
        </div>
      </div></div>`);
    const dots = root.querySelector('.pin-dots');
    const msg = root.querySelector('#pin-msg');
    const input = root.querySelector('#pin-input');
    const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length));
    const check = async () => {
      if (Date.now() < lockedUntil) { msg.textContent = `Too many attempts. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`; entry = ''; paint(); return; }
      const ok = await verifyPin(entry, pinRec);
      if (ok) { resolve(); return; }
      attempts++;
      if (attempts % 5 === 0) lockedUntil = Date.now() + 30000;
      msg.textContent = attempts % 5 === 0 ? 'Too many attempts. Wait 30 seconds.' : 'Incorrect PIN';
      dots.classList.add('shake');
      setTimeout(() => dots.classList.remove('shake'), 400);
      entry = '';
      paint();
    };
    const press = (d) => {
      if (entry.length >= len) return;
      entry += d;
      paint();
      if (entry.length === len) check();
    };
    root.querySelector('.pin-pad').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-del')) { entry = entry.slice(0, -1); paint(); } else press(b.dataset.n);
    });
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') { entry = entry.slice(0, -1); paint(); }
    };
    document.addEventListener('keydown', onKey);
    input.focus({ preventScroll: true });
    const done = resolve;
    resolve = () => { document.removeEventListener('keydown', onKey); done(); };
  });
}
