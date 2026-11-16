import test from 'node:test';
import assert from 'node:assert';
import { makePayLink, readPayLink, whatsappUrl, reminderText, receiptText } from '../src/shared/paylink.js';
import { dayTotals, lastDays, toCsv } from '../src/shared/report.js';

const ADDR = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';

test('pay links round-trip and carry no secrets', () => {
  const url = makePayLink('https://jaay.example/', { address: ADDR, sats: 39116, xof: 15000, shop: 'Chez Awa', note: 'riz' });
  assert.match(url, /^https:\/\/jaay\.example\/pay\?/);
  const p = readPayLink(new URL(url).search);
  assert.deepStrictEqual([p.ok, p.address, p.sats, p.xof, p.shop, p.note], [true, ADDR, 39116, 15000, 'Chez Awa', 'riz']);
  assert.strictEqual(p.bip21, `bitcoin:${ADDR}?amount=0.00039116`);
});

test('pay links reject mainnet addresses, bad amounts and strip markup', () => {
  assert.strictEqual(readPayLink('?a=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq&s=1000').ok, false);
  assert.strictEqual(readPayLink(`?a=${ADDR}&s=10`).ok, false, 'below dust');
  assert.strictEqual(readPayLink(`?a=${ADDR}&s=abc`).ok, false);
  assert.strictEqual(readPayLink(`?a=${ADDR}&s=1000&m=<script>x</script>`).shop, 'scriptx/script');
});

test('WhatsApp messages: French text, encoded, phone digits only', () => {
  const r = reminderText({ name: 'Awa', xof: 2500, link: 'https://x/pay?a=1', shop: 'Chez Fatou' });
  assert.match(r, /Bonjour Awa, petit rappel de Chez Fatou : il reste 2 500 FCFA/);
  const u = whatsappUrl(r, '+221 77 123 45 67');
  assert.match(u, /^https:\/\/wa\.me\/221771234567\?text=Bonjour%20Awa/);
  assert.match(receiptText({ item: 'thiof', xof: 3000, sats: 0, method: 'Espèces', when: '16/11' }), /thiof — 3 000 FCFA, payé par Espèces/);
});

test('daily totals, 7-day series and payment-method split', () => {
  const sales = [
    { day: '2026-11-16', xof: 1000, sats: 2600, paid: true, method: 'Bitcoin' },
    { day: '2026-11-16', xof: 500, sats: 0, paid: true, method: 'Espèces' },
    { day: '2026-11-16', xof: 900, paid: false, method: 'Bitcoin' },
    { day: '2026-11-14', xof: 2000, sats: 5200, paid: true, method: 'Lightning' },
  ];
  const d = dayTotals(sales, '2026-11-16');
  assert.deepStrictEqual([d.count, d.total, d.sats, d.byMethod], [2, 1500, 2600, { Bitcoin: 1000, Espèces: 500 }]);
  const w = lastDays(sales, 7, new Date('2026-11-16T12:00:00Z'));
  assert.strictEqual(w.length, 7);
  assert.deepStrictEqual(w.map((x) => x.total), [0, 0, 0, 0, 2000, 0, 1500]);
});

test('CSV export neutralises spreadsheet formulas and quotes commas', () => {
  const csv = toCsv([{ day: '2026-11-16', at: Date.parse('2026-11-16T09:05:00Z'), item: 'riz, 2 sacs', customer: '=HYPERLINK("x")', xof: 1000, sats: 2600, method: 'Bitcoin' }]);
  const line = csv.split('\r\n')[1];
  assert.match(line, /^2026-11-16,09:05,"riz, 2 sacs","'=HYPERLINK\(""x""\)",1000,2600,Bitcoin$/);
});
