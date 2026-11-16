// Optional AI provider layer. The browser never holds an API key: it talks
// to a backend proxy YOU host (see server/ai-proxy.mjs), which holds the key.
// If no proxy is configured, or the device is offline, AI is unavailable and
// the app uses its local, rule-based guidance instead.
import { getState } from './state.js';

export const aiStatus = () => {
  const ep = getState().aiEndpoint;
  if (!ep) return { available: false, reason: 'not-configured' };
  if (!navigator.onLine) return { available: false, reason: 'offline' };
  return { available: true, endpoint: ep };
};

export function validateEndpoint(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Enter a full URL, e.g. https://your-server.example.com/api/assistant'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('Use https:// (http:// is only allowed for localhost).');
  if (/[?&](key|api_key|apikey|token)=/i.test(u.search)) throw new Error('Do not put API keys in the URL. Keep the key on your server.');
  return u.toString();
}

/**
 * Sends a conversation to the configured proxy.
 * Contract: POST { task, messages:[{role,content}], context } -> { reply, images?: [url] }
 */
export async function askAI({ task = 'chat', messages, context = {} }) {
  const s = aiStatus();
  if (!s.available) throw new Error(s.reason === 'offline' ? 'You are offline. AI needs an internet connection.' : 'No AI service is configured.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(s.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ task, messages: messages.slice(-12), context: { business: getState().business?.name || '', currency: getState().business?.currency || 'NGN', ...context } }),
    });
    if (!res.ok) throw new Error(`AI service error (${res.status}).`);
    const data = await res.json();
    if (typeof data.reply !== 'string') throw new Error('AI service returned an unexpected response.');
    return { reply: data.reply, images: Array.isArray(data.images) ? data.images.filter(u => typeof u === 'string' && /^(https:|data:image\/)/.test(u)) : [] };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The AI service took too long to respond.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
