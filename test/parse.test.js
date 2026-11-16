import test from 'node:test';
import assert from 'node:assert';
import { parseNote } from '../src/shared/parse.js';

test('French sale with price after "à"', () => {
  const r = parseNote('Vendu 3 sacs de riz à 15000');
  assert.deepStrictEqual([r.kind, r.amountXof, r.item], ['sale', 15000, '3 sacs de riz']);
});
test('English sale with spaced thousands and CFA', () => {
  const r = parseNote('sold 2 bags of onions for 4 000 cfa');
  assert.deepStrictEqual([r.kind, r.amountXof, r.item], ['sale', 4000, '2 bags of onions']);
});
test('"k" and "mille" multipliers', () => {
  assert.strictEqual(parseNote('Vendu poisson à 2k').amountXof, 2000);
  assert.strictEqual(parseNote('Vendu tissu pour 5 mille').amountXof, 5000);
});
test('credit: "Awa doit 2500 pour le poisson"', () => {
  const r = parseNote('Awa doit 2500 pour le poisson');
  assert.deepStrictEqual([r.kind, r.customer, r.amountXof, r.item], ['credit', 'Awa', 2500, 'le poisson']);
});
test('repayment: "moussa a payé 1000"', () => {
  const r = parseNote('moussa a payé 1000');
  assert.deepStrictEqual([r.kind, r.customer, r.amountXof], ['repayment', 'Moussa', 1000]);
});
test('rejects notes with no amount or absurd amounts', () => {
  assert.strictEqual(parseNote('bonjour').ok, false);
  assert.strictEqual(parseNote('Vendu maison à 999999999').ok, false);
  assert.strictEqual(parseNote('').ok, false);
});
