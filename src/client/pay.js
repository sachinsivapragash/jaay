// Customer-facing pay page: shows the QR from the link only (no account, no server data).
import qrcode from 'qrcode-generator';
import { readPayLink, fmtXof } from '../shared/paylink.js';
import * as E from './esplora.js';

const el = document.getElementById('pay');
const p = readPayLink(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!p.ok) {
  el.innerHTML = `<section class="card"><h2>Lien invalide</h2><p class="muted">${esc(p.error)}</p></section>`;
} else {
  const qr = qrcode(0, 'M'); qr.addData(p.bip21); qr.make();
  el.innerHTML = `<section class="card pay">
    <p class="muted">${p.shop ? esc(p.shop) + ' · ' : ''}${esc(p.note || 'Paiement')}</p>
    <p class="amount">${p.xof ? fmtXof(p.xof) + ' FCFA' : ''}</p>
    <p class="muted">${fmtXof(p.sats)} sats · Bitcoin signet (test)</p>
    <div class="qr">${qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}</div>
    <a class="btnlink pri big" href="${esc(p.bip21)}">Ouvrir dans mon portefeuille</a>
    <p class="mono small">${esc(p.address)}</p>
    <button id="copy">Copier l'adresse</button>
    <p id="st" class="wait">En attente du paiement…</p></section>`;
  document.getElementById('copy').onclick = (e) => { navigator.clipboard?.writeText(p.address); e.target.textContent = 'Copié'; };
  const st = document.getElementById('st');
  const seen = new Set();
  let first = true;
  (async function poll() {
    try {
      const txs = await E.addressTxs(p.address);
      if (first) { txs.forEach((t) => seen.add(t.txid)); first = false; }
      const got = txs.filter((t) => !seen.has(t.txid)).reduce((s, t) => s + E.receivedIn(t, p.address), 0);
      if (got >= p.sats * 0.98) { st.className = 'ok'; st.textContent = '✔ Paiement reçu. Merci !'; return; }
    } catch { /* retry */ }
    setTimeout(poll, 6000);
  })();
}
