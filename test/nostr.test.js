import test from 'node:test';
import assert from 'node:assert';
import { verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { nostrKey, sealLedger, openLedger, mergeLedger, packLedger, KIND, D_TAG } from '../src/client/nostr-backup.js';

test('NIP-06 test vector: key derived from the 12 words', () => {
  const { sk, pk } = nostrKey('leader monkey parrot ring guide accident before fence cannon height naive bean');
  assert.strictEqual(bytesToHex(sk), '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a');
  assert.strictEqual(pk, '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917');
});

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const state = { shop: 'Chez Fatou', next: 7, changeNext: 2, catalog: [{ name: 'Thiof', xof: 3000 }], sales: [{ id: 1, at: 10, day: '2026-11-16', xof: 3000, paid: true, method: 'Espèces' }], credits: { awa: { name: 'Awa', phone: '221771234567', entries: [{ at: 5, xof: 2500, note: 'poisson' }] } } };

test('backup event is signed, replaceable, and its content is ciphertext only', () => {
  const { sk, pk } = nostrKey(PHRASE);
  const ev = sealLedger(state, sk, pk);
  assert.ok(verifyEvent(ev));
  assert.strictEqual(ev.kind, KIND);
  assert.deepStrictEqual(ev.tags, [['d', D_TAG]]);
  for (const secret of ['Awa', 'Thiof', 'Chez Fatou', '2500', '221771234567']) assert.ok(!ev.content.includes(secret), `${secret} leaked`);
  const back = openLedger(ev, sk, pk);
  assert.deepStrictEqual([back.shop, back.next, back.credits.awa.entries[0].xof], ['Chez Fatou', 7, 2500]);
});

test('a backup cannot be opened with another seller\'s key', () => {
  const a = nostrKey(PHRASE);
  const b = nostrKey('leader monkey parrot ring guide accident before fence cannon height naive bean');
  const ev = sealLedger(state, a.sk, a.pk);
  assert.throws(() => openLedger(ev, b.sk, b.pk), /Not your backup/);
});

test('merge keeps both sides and never reuses receive addresses', () => {
  const local = { next: 3, changeNext: 5, catalog: [], sales: [{ id: 2, at: 20, xof: 500 }], credits: { awa: { name: 'Awa', entries: [{ at: 9, xof: -1000, note: 'cash' }] } } };
  const m = mergeLedger(local, JSON.parse(packLedger(state)));
  assert.deepStrictEqual(m.sales.map((s) => s.id), [2, 1]);
  assert.deepStrictEqual(m.credits.awa.entries.map((e) => e.xof), [-1000, 2500]);
  assert.deepStrictEqual([m.next, m.changeNext, m.shop, m.catalog.length], [7, 5, 'Chez Fatou', 1]);
});

test('huge ledgers are trimmed to fit one NIP-44 message', () => {
  const sales = Array.from({ length: 1500 }, (_, i) => ({ id: i, at: i, day: '2026-11-16', xof: 1000, item: 'x'.repeat(60), paid: true, method: 'Bitcoin' }));
  const json = packLedger({ ...state, sales });
  assert.ok(new TextEncoder().encode(json).length <= 60000);
  assert.ok(JSON.parse(json).sales.length > 100);
});
