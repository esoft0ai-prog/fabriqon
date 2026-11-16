// Optional AI proxy for Fabriqon. Run this on a server YOU control; it holds
// the Anthropic API key so the browser app never sees it.
//
//   cd server && npm install && ANTHROPIC_API_KEY=... ALLOWED_ORIGIN=https://your-app.example.com npm start
//
// Contract (what js/ai.js sends):
//   POST /api/assistant  { task: 'chat'|'design'|'ping', messages: [{role, content}], context: {...} }
//   -> 200 { reply: string, images: [] }
import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const MODEL = process.env.FABRIQON_MODEL || 'claude-opus-5-5';
const MAX_BODY = 64 * 1024;
const RATE = { windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN || 20) };

const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile)

const SYSTEM = `You are the tailoring assistant inside Fabriqon, a workshop management app used by professional tailors and fashion designers (many in Nigeria and West Africa).
Help with garment construction, sewing-machine troubleshooting, measurement terminology, fabric choices, pricing, scheduling and customer quotations.
Rules:
- Never invent a customer's measurements. If you need them, ask, or say which ones matter.
- Fabric quantities are estimates that depend on pattern, fabric width and layout; say so and suggest the app's Fabric Calculator.
- Present possible causes of sewing problems as likely causes to check, not a guaranteed diagnosis.
- Be practical and concise. Use plain language and short lists. Money is in the business currency given in the context.`;

const DESIGN = `\nFor design requests: describe 2–3 distinct outfit concepts (silhouette, neckline, sleeves, fabric and colour pairing, embellishment, construction notes, rough fabric needs). You cannot produce images; describe clearly enough for the tailor to sketch.`;

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE.max;
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (out.length && out[0].role !== 'user') out.shift(); // first message must be from the user
  return out.length ? out : null;
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' || !req.url.startsWith('/api/assistant')) return send(res, 404, { error: 'Not found' });
  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) return send(res, 403, { error: 'Origin not allowed' });
  if (rateLimited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many requests' });

  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (err) { return send(res, err.status || 400, { error: err.status ? err.message : 'Invalid JSON' }); }
  if (payload.task === 'ping') return send(res, 200, { reply: 'pong', images: [] });
  const messages = cleanMessages(payload.messages);
  if (!messages) return send(res, 400, { error: 'No messages' });

  const ctx = payload.context || {};
  const context = `Business: ${String(ctx.business || '').slice(0, 100)}. Currency: ${String(ctx.currency || 'NGN').slice(0, 5)}.`;

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: payload.task === 'design' ? 'medium' : 'low' },
      // If the model declines on a policy check, the API retries on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM + (payload.task === 'design' ? DESIGN : '') + `\n${context}`,
      messages,
    });
    if (response.stop_reason === 'refusal') {
      return send(res, 200, { reply: "I can't help with that request. Try asking about garment construction, fabrics, fit or pricing.", images: [] });
    }
    const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return send(res, 200, { reply: reply || 'No answer was returned. Please rephrase your question.', images: [] });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'AI provider is busy. Try again shortly.' });
    if (err instanceof Anthropic.AuthenticationError) { console.error('Check ANTHROPIC_API_KEY'); return send(res, 502, { error: 'AI provider authentication failed.' }); }
    if (err instanceof Anthropic.APIError) { console.error(`Anthropic API error ${err.status}:`, err.message); return send(res, 502, { error: 'AI provider error.' }); }
    console.error(err);
    return send(res, 500, { error: 'Proxy error.' });
  }
}).listen(PORT, () => console.log(`Fabriqon AI proxy on http://localhost:${PORT}/api/assistant (allowed origin: ${ALLOWED_ORIGIN}, model: ${MODEL})`));
