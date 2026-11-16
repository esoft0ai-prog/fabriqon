// Service worker registration, update detection and install prompt.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canInstall = () => !!deferredPrompt;
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  notify();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome;
}

/**
 * Registers the service worker. onUpdate(applyFn) is called when a new
 * version has been downloaded and is waiting; applyFn activates it and reloads.
 */
export async function registerServiceWorker({ onUpdate, onReady } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js', { scope: './' });
    const apply = (worker) => () => {
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
    let refreshing = false;
    // Only reload when an existing worker is replaced (an update). On the very
    // first visit the worker claims the page and no reload is needed.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      location.reload();
    });
    if (reg.waiting && navigator.serviceWorker.controller) onUpdate?.(apply(reg.waiting));
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed') {
          if (navigator.serviceWorker.controller) onUpdate?.(apply(w));
          else onReady?.();
        }
      });
    });
    // Check for updates periodically while the app is open.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    return reg;
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return null;
  }
}

/** Shows a local (on-device) notification via the service worker. */
export async function showLocalNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) { await reg.showNotification(title, { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png' }); return true; }
  new Notification(title, { body, tag });
  return true;
}
