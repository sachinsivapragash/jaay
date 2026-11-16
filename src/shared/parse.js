import { cleanText } from './text.js';

// Offline parser for short sale/credit notes in French or English, used when no AI key is set
// (and to check the AI's answer). Examples:
//   "Vendu 3 sacs de riz à 15000"          -> sale, 15000 XOF, "3 sacs de riz"
//   "Awa doit 2500 pour le poisson"         -> credit, Awa owes 2500 XOF
//   "Awa a payé 1000"                        -> repayment by Awa
//   "sold 2 bags of onions for 4 000 cfa"   -> sale, 4000 XOF
const NUM = /(\d[\d\s.,]*\d|\d)\s*(k|mille|f|fcfa|cfa|xof|francs?)?/gi;

function toNumber(raw, unit) {
  let n = Number(String(raw).replace(/[\s.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (/^(k|mille)$/i.test(unit || '')) n *= 1000;
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
function amountOf(text) {
  // Prefer a number after "à / a / pour / for / =" (the price), else the largest number.
  // (JS \b ignores accented letters such as "à", so word edges are matched with whitespace.)
  const priced = /(?:(?:^|\s)(?:à|a|pour|for)\s+|\s*[=:]\s*)(\d[\d\s.,]*\d|\d)\s*(k|mille)?/i.exec(text);
  if (priced) return toNumber(priced[1], priced[2]);
  let best = NaN;
  for (const m of text.matchAll(NUM)) { const v = toNumber(m[1], m[2]); if (!(best >= v)) best = v; }
  return best;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseNote(input) {
  const text = cleanText(input, 300);
  if (!text) return { ok: false, error: 'Empty note' };
  const amount = amountOf(text);
  if (!(amount > 0)) return { ok: false, error: 'No amount found. Try: "Vendu 2 sacs de riz à 10000".' };
  if (amount > 10_000_000) return { ok: false, error: 'Amount looks too large' };

  const repay = /^\s*([A-ZÀ-Ýa-zà-ÿ][\wÀ-ÿ'-]*)\s+(?:a\s+pay[ée]|a\s+rembours[ée]|paid|repaid)(?=\s|$)/i.exec(text);
  if (repay) return { ok: true, kind: 'repayment', customer: cap(repay[1]), amountXof: amount, note: text };

  const owes = /^\s*([A-ZÀ-Ýa-zà-ÿ][\wÀ-ÿ'-]*)\s+(?:doit|owes|me\s+doit)\b\s*(?:\d[\d\s.,]*\s*(?:k|mille|f|fcfa|cfa|xof|francs?)?)?\s*(?:pour|for)?\s*(.*)$/i.exec(text);
  if (owes) return { ok: true, kind: 'credit', customer: cap(owes[1]), amountXof: amount, item: owes[2].replace(/[.!]+$/, '').trim() || null, note: text };

  const sale = /(?:vendu|vente|sold|sell)\s+(.*?)(?:\s+(?:à|a|pour|for)\s+\d|\s*[=:]|$)/i.exec(text);
  return { ok: true, kind: 'sale', item: sale && sale[1] ? sale[1].trim() : null, amountXof: amount, note: text };
}
