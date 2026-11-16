import test from 'node:test';
import assert from 'node:assert';

const load = () => import('../src/client/wallet.js');
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('BIP84 test vector: first testnet/signet receive and change addresses', async () => {
  const w = await load();
  const a = w.account(ABANDON);
  // From BIP84 (m/84'/1'/0'/0/0 and /1/0 for the "abandon … about" mnemonic)
  assert.strictEqual(a.address(0, 0), 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  assert.strictEqual(a.address(0, 1), 'tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97');
  assert.strictEqual(a.address(1, 0), 'tb1q9u62588spffmq4dzjxsr5l297znf3z6j5p2688');
});

test('rejects bad phrases and normalises spacing/case', async () => {
  const w = await load();
  assert.throws(() => w.account('abandon abandon'), /Invalid recovery phrase/);
  assert.strictEqual(w.account(`  ${ABANDON.toUpperCase()}  `).address(0, 0), 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  assert.strictEqual(w.newMnemonic().split(' ').length, 12);
});

test('PIN encryption round-trips and rejects a wrong PIN or short PIN', async () => {
  const w = await load();
  const box = await w.encryptSecret(ABANDON, '482913');
  assert.ok(!JSON.stringify(box).includes('abandon'), 'ciphertext must not contain the phrase');
  assert.strictEqual(await w.decryptSecret(box, '482913'), ABANDON);
  await assert.rejects(w.decryptSecret(box, '000000'), /Wrong PIN/);
  await assert.rejects(w.encryptSecret(ABANDON, '123'), /at least 6 digits/);
});

test('CFA franc <-> sats conversion uses the euro peg', async () => {
  const w = await load();
  // 655.957 XOF = 1 EUR; at 50,000 EUR/BTC, 1 EUR = 2,000 sats
  assert.strictEqual(w.xofToSats(655.957, 50000), 2000);
  assert.strictEqual(w.satsToXof(2000, 50000), 656);
  assert.throws(() => w.xofToSats(-5, 50000));
});

test('builds and signs a valid signet transaction with change', async () => {
  const w = await load();
  const a = w.account(ABANDON);
  const utxos = [
    { txid: '11'.repeat(32), vout: 0, value: 30000, chain: 0, index: 0 },
    { txid: '22'.repeat(32), vout: 1, value: 5000, chain: 0, index: 1 },
  ];
  const r = w.buildSend(a, utxos, { to: 'tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97', amount: 20000, feeRate: 2, changeAddress: a.address(1, 0) });
  assert.strictEqual(r.inputs, 1, 'largest-first picks one input');
  assert.ok(r.change > 0 && r.fee > 0);
  assert.strictEqual(30000, 20000 + r.fee + r.change);
  assert.match(r.hex, /^02000000/);
  assert.match(r.txid, /^[0-9a-f]{64}$/);
});

test('refuses invalid sends', async () => {
  const w = await load();
  const a = w.account(ABANDON);
  const utxos = [{ txid: '11'.repeat(32), vout: 0, value: 1000, chain: 0, index: 0 }];
  assert.throws(() => w.buildSend(a, utxos, { to: 'not-an-address', amount: 600, feeRate: 1, changeAddress: a.address(1, 0) }), /valid signet address/);
  assert.throws(() => w.buildSend(a, utxos, { to: a.address(0, 1), amount: 100, feeRate: 1, changeAddress: a.address(1, 0) }), /at least 546/);
  assert.throws(() => w.buildSend(a, utxos, { to: a.address(0, 1), amount: 5000, feeRate: 1, changeAddress: a.address(1, 0) }), /Not enough funds/);
  assert.strictEqual(w.isAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), false, 'mainnet addresses are rejected on signet');
});
