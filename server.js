// Jaay server: serves the app, a cached BTC/EUR rate, and an optional AI note reader.
// It never sees keys, seed phrases or balances; sales and the credit book live on the phone.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNote } from './src/shared/parse.js';
import { cleanText } from './src/shared/text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export function createApp({ fetchImpl = fetch, now = () => Date.now(), geminiKey = GEMINI_KEY } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://mempool.space wss: ; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  // Source archive and demo video: public files, fetchable from any site (no cookies, no secrets).
  app.use('/downloads', (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h', setHeaders: (res, p) => { if (/sw\.js$|index\.html$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));

  app.get('/health', (req, res) => res.json({ ok: true, ai: geminiKey ? 'gemini' : 'offline-parser' }));

  // BTC/EUR from mempool.space (CFA franc is pegged to the euro), cached 60 s, last good value kept.
  let rate = null;
  app.get('/api/rate', async (req, res) => {
    if (rate && now() - rate.at < 60_000) return res.json(rate);
    try {
      const r = await fetchImpl('https://mempool.space/api/v1/prices');
      const j = await r.json();
      if (!(j.EUR > 0)) throw new Error('bad price');
      rate = { btcEur: j.EUR, xofPerEur: 655.957, at: now(), source: 'mempool.space' };
      res.json(rate);
    } catch {
      if (rate) return res.json({ ...rate, stale: true });
      res.status(503).json({ error: 'Rate unavailable, try again shortly' });
    }
  });

  // Small per-IP rate limit for the AI endpoint (no storage of the notes themselves).
  const hits = new Map();
  const limited = (ip) => { const t = now(); const h = (hits.get(ip) || []).filter((x) => t - x < 60_000); h.push(t); hits.set(ip, h); return h.length > 20; };

  app.post('/api/assist', async (req, res) => {
    const note = typeof req.body?.note === 'string' ? cleanText(req.body.note, 300) : '';
    if (!note) return res.status(400).json({ ok: false, error: 'Write what you sold, e.g. "Vendu 2 sacs de riz à 10000".' });
    if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests, wait a minute' });
    const offline = parseNote(note);
    if (!geminiKey) return res.json({ ...offline, by: 'offline-parser' });
    try {
      const ai = await askGemini(fetchImpl, geminiKey, note);
      const safe = sanitize(ai, note);
      return res.json(safe.ok ? { ...safe, by: 'gemini' } : { ...offline, by: 'offline-parser' });
    } catch {
      return res.json({ ...offline, by: 'offline-parser' });
    }
  });

  return app;
}

// The model only proposes; amounts and kinds are validated here before the app uses them.
export function sanitize(ai, note) {
  const kind = ['sale', 'credit', 'repayment'].includes(ai?.kind) ? ai.kind : null;
  const amountXof = Math.round(Number(ai?.amountXof));
  if (!kind || !(amountXof > 0 && amountXof <= 10_000_000)) return { ok: false };
  const clean = (s, n) => { const v = typeof s === 'string' ? cleanText(s, n).replace(/[<>]/g, '') : ''; return v || null; };
  const customer = clean(ai.customer, 40);
  if (kind !== 'sale' && !customer) return { ok: false };
  return { ok: true, kind, amountXof, item: clean(ai.item, 80), customer, note };
}

async function askGemini(fetchImpl, key, note) {
  const body = {
    systemInstruction: { parts: [{ text: 'You read short notes written by market sellers in Senegal (French, English or Wolof mixed in). Extract one record. kind: "sale" (sold something now), "credit" (a named customer owes money / took goods on credit) or "repayment" (a named customer paid back). amountXof is the amount in CFA francs as an integer ("2k" = 2000, "5 mille" = 5000). Use only what the note says; never invent a customer.' }] },
    contents: [{ role: 'user', parts: [{ text: note }] }],
    generationConfig: {
      temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['sale', 'credit', 'repayment'] }, amountXof: { type: 'INTEGER' }, item: { type: 'STRING' }, customer: { type: 'STRING' } }, required: ['kind', 'amountXof'] },
    },
  };
  const ctrl = AbortSignal.timeout(8000);
  const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctrl });
  if (!r.ok) throw new Error(`AI ${r.status}`);
  const j = await r.json();
  return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => console.log(`Jaay running on http://localhost:${PORT} (AI: ${GEMINI_KEY ? 'gemini' : 'offline parser'})`));
}
