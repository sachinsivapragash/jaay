import { cleanText } from './text.js';

// Payment links that a seller can send by WhatsApp/SMS. Everything is in the URL fragment-free
// query string, so the server stores nothing: /pay?a=<signet address>&s=<sats>&x=<FCFA>&m=<shop>&n=<note>
const ADDR = /^tb1[02-9ac-hj-np-z]{8,87}$/; // bech32 charset, signet/testnet only

export function makePayLink(origin, { address, sats, xof, shop, note }) {
  const q = new URLSearchParams({ a: address, s: String(Math.round(sats)), x: String(Math.round(xof)) });
  if (shop) q.set('m', String(shop).slice(0, 40));
  if (note) q.set('n', String(note).slice(0, 60));
  return `${origin.replace(/\/$/, '')}/pay?${q}`;
}

export function readPayLink(search) {
  const q = new URLSearchParams(search);
  const address = (q.get('a') || '').trim().toLowerCase();
  const sats = parseInt(q.get('s'), 10);
  const xof = parseInt(q.get('x'), 10);
  if (!ADDR.test(address)) return { ok: false, error: 'Invalid address' };
  if (!(sats >= 546 && sats <= 100_000_000)) return { ok: false, error: 'Invalid amount' };
  const clean = (s) => (s ? cleanText(s, 60).replace(/[<>"'`]/g, '') : '');
  return { ok: true, address, sats, xof: xof > 0 ? xof : null, shop: clean(q.get('m')), note: clean(q.get('n')), bip21: `bitcoin:${address}?amount=${(sats / 1e8).toFixed(8)}` };
}

// Pre-filled WhatsApp messages (French). wa.me works without the seller's number being stored anywhere.
export function whatsappUrl(text, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
export const fmtXof = (n) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
export const reminderText = ({ name, xof, link, shop }) =>
  `Bonjour ${name}, petit rappel${shop ? ` de ${shop}` : ''} : il reste ${fmtXof(xof)} FCFA à régler. Vous pouvez payer en bitcoin ici : ${link} Merci !`;
export const receiptText = ({ item, xof, sats, method, shop, when }) =>
  `Reçu${shop ? ` ${shop}` : ''} : ${item || 'achat'} — ${fmtXof(xof)} FCFA${sats ? ` (${sats} sats)` : ''}, payé par ${method}, le ${when}. Merci !`;
