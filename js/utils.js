// Small shared helpers (formatting, dates, files). DOM-light.
import { getState } from './state.js';

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

const fmtCache = new Map();
export function money(amount, currency = getState().business?.currency || 'NGN') {
  const key = currency;
  if (!fmtCache.has(key)) {
    try {
      fmtCache.set(key, new Intl.NumberFormat(currency === 'NGN' ? 'en-NG' : undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }));
    } catch {
      fmtCache.set(key, { format: (n) => `${currency} ${Number(n).toFixed(2)}` });
    }
  }
  return fmtCache.get(key).format(Number(amount) || 0);
}
/** Plain-ASCII money for PDFs (jsPDF base fonts lack ₦ and other symbols). */
export function moneyPlain(amount, currency = getState().business?.currency || 'NGN') {
  const n = (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, opts);
};
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
export const fmtNum = (n, dp = 2) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: dp });

export function relDays(iso) {
  if (!iso) return '';
  const d = daysBetween(todayISO(), iso.slice(0, 10));
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
}

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';

export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** Validates and downsizes an image to a JPEG data URL for local storage. */
export async function readImage(file, { maxDim = 1280, quality = 0.82, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!file) throw new Error('No file selected.');
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Only JPEG, PNG, WebP or GIF images are allowed.');
  if (file.size > maxBytes) throw new Error(`Image is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file could not be read as an image.'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const scriptCache = new Map();
/** Loads a bundled (local) classic script once. */
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src, async: true });
      s.onload = resolve;
      s.onerror = () => { scriptCache.delete(src); reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
export const byId = (arr) => new Map(arr.map(x => [x.id, x]));
export const normalizePhone = (p = '') => p.replace(/[^\d+]/g, '');
export const waNumber = (p = '', countryCode = '234') => {
  let d = p.replace(/\D/g, '');
  if (d.startsWith('0')) d = countryCode + d.slice(1);
  return d;
};
