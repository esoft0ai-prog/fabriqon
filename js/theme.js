// Theme preference: 'light' | 'dark' | 'system'.
import { local } from './storage.js';

const listeners = new Set();
const mq = window.matchMedia('(prefers-color-scheme: dark)');

export const getThemePref = () => local.get('theme', 'system');
export const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

export function applyTheme(pref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  listeners.forEach(fn => fn(dark));
}

export function setThemePref(pref) {
  local.set('theme', pref);
  applyTheme(pref);
}

export const onThemeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
mq.addEventListener?.('change', () => { if (getThemePref() === 'system') applyTheme('system'); });
