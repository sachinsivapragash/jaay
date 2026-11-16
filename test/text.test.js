import test from 'node:test';
import assert from 'node:assert';
import { cleanText, hasHidden } from '../src/shared/text.js';
import { parseNote } from '../src/shared/parse.js';
import { readPayLink } from '../src/shared/paylink.js';
import { sanitize } from '../server.js';

const RLO = '‮', ZWSP = '​', BOM = '﻿';

test('invisible and bidi characters are stripped, normal accents kept', () => {
  assert.strictEqual(cleanText(`A${ZWSP}wa ${RLO}evil`), 'Awa evil');
  assert.strictEqual(cleanText(`${BOM}Ndèye   Fatou\n`), 'Ndèye Fatou');
  assert.strictEqual(cleanText('Thiéboudienne à 1 500'), 'Thiéboudienne à 1 500');
  assert.ok(hasHidden(`x${RLO}y`)); assert.ok(!hasHidden('Moussa'));
});

test('a hidden character cannot change who owes money or the amount', () => {
  const r = parseNote(`Aw${ZWSP}a doit 2${ZWSP}500 pour le poisson`);
  assert.deepStrictEqual([r.kind, r.customer, r.amountXof], ['credit', 'Awa', 2500]);
});

test('pay links and AI output are cleaned too', () => {
  const p = readPayLink(`?a=tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl&s=1000&m=${encodeURIComponent('Chez' + RLO + ' Fatou')}`);
  assert.strictEqual(p.shop, 'Chez Fatou');
  const s = sanitize({ kind: 'credit', amountXof: 500, customer: `M${ZWSP}oussa` }, 'x');
  assert.strictEqual(s.customer, 'Moussa');
});
