import test from 'node:test';
import assert from 'node:assert';
import { createApp, sanitize } from '../server.js';

async function start(opts) {
  const server = await new Promise((r) => { const s = createApp(opts).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

test('security headers are set on every response', async () => {
  const t = await start({ geminiKey: '' });
  try {
    const r = await fetch(t.base + '/health');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(r.headers.get('x-powered-by'), null);
  } finally { await t.close(); }
});

test('rate is cached and the last good value survives an outage', async () => {
  let calls = 0; let fail = false; let clock = 0;
  const fetchImpl = async () => { calls++; if (fail) throw new Error('down'); return { json: async () => ({ EUR: 60000 }) }; };
  const t = await start({ fetchImpl, now: () => clock, geminiKey: '' });
  try {
    const a = await (await fetch(t.base + '/api/rate')).json();
    await fetch(t.base + '/api/rate');
    assert.strictEqual(calls, 1, 'second call within 60 s is served from cache');
    assert.strictEqual(a.btcEur, 60000);
    clock = 120_000; fail = true;
    const b = await (await fetch(t.base + '/api/rate')).json();
    assert.strictEqual(b.stale, true);
    assert.strictEqual(b.btcEur, 60000);
  } finally { await t.close(); }
});

test('assist works offline without an AI key and validates input', async () => {
  const t = await start({ geminiKey: '' });
  try {
    const post = (body) => fetch(t.base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ok = await (await post({ note: 'Awa doit 2500 pour le poisson' })).json();
    assert.deepStrictEqual([ok.kind, ok.customer, ok.amountXof, ok.by], ['credit', 'Awa', 2500, 'offline-parser']);
    assert.strictEqual((await post({ note: '' })).status, 400);
    assert.strictEqual((await post({ note: 42 })).status, 400);
  } finally { await t.close(); }
});

test('AI output is validated: bad kinds, amounts or invented customers are rejected', () => {
  assert.strictEqual(sanitize({ kind: 'transfer', amountXof: 100 }, 'x').ok, false);
  assert.strictEqual(sanitize({ kind: 'sale', amountXof: -5 }, 'x').ok, false);
  assert.strictEqual(sanitize({ kind: 'credit', amountXof: 500 }, 'x').ok, false, 'credit needs a customer');
  const s = sanitize({ kind: 'sale', amountXof: 1500.4, item: '<b>riz</b>' }, 'x');
  assert.deepStrictEqual([s.ok, s.amountXof, s.item], [true, 1500, 'briz/b']);
});

test('AI failure falls back to the offline parser', async () => {
  const fetchImpl = async () => { throw new Error('AI down'); };
  const t = await start({ fetchImpl, geminiKey: 'test-key' });
  try {
    const r = await (await fetch(t.base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'Vendu 3 sacs de riz à 15000' }) })).json();
    assert.deepStrictEqual([r.kind, r.amountXof, r.by], ['sale', 15000, 'offline-parser']);
  } finally { await t.close(); }
});
