// Jaay phone app. Everything (keys, sales, credit book) stays on the device.
import qrcode from 'qrcode-generator';
import * as W from './wallet.js';
import * as E from './esplora.js';
import { nwcClient } from './nwc.js';
import { STRINGS } from './i18n.js';

// ---------- state & storage ----------
const KEY = 'jaay.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let S = Object.assign({ lang: (navigator.language || 'fr').startsWith('en') ? 'en' : 'fr', box: null, next: 0, sales: [], credits: {}, nwc: null }, load());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage full or blocked */ } };
let acct = null; // unlocked account (in memory only)
let mnemonic = null;
let view = 'sell';
let rate = null;
let pay = null; // active payment request
let lockTimer = null;
const GAP = 5;

const t = (k, vars = {}) => (STRINGS[S.lang][k] || STRINGS.en[k] || k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'en-US');
const $ = (s) => document.querySelector(s);
const app = $('#app');
const today = () => new Date().toISOString().slice(0, 10);

// ---------- rate ----------
async function loadRate() {
  try { const r = await fetch('/api/rate'); if (r.ok) rate = await r.json(); } catch { /* offline */ }
  return rate;
}

// ---------- auto-lock after 5 minutes without touches ----------
function touch() { clearTimeout(lockTimer); if (acct) lockTimer = setTimeout(lock, 5 * 60_000); }
['pointerdown', 'keydown'].forEach((e) => addEventListener(e, touch, { passive: true }));
function lock() { acct = null; mnemonic = null; pay?.stop?.(); pay = null; render(); }

// ---------- render ----------
function render() {
  if (!S.box) return renderOnboarding();
  if (!acct) return renderUnlock();
  const tabs = [['sell', '🛒', t('tabSell')], ['book', '📒', t('tabBook')], ['wallet', '₿', t('tabWallet')], ['settings', '⚙️', t('tabSettings')]];
  app.innerHTML = `
    <header class="top"><b>Jaay</b><span class="net">${esc(t('testnet'))}</span></header>
    <main id="view"></main>
    <nav class="tabs">${tabs.map(([k, ic, l]) => `<button data-act="tab" data-v="${k}" class="${view === k ? 'on' : ''}"><span>${ic}</span>${esc(l)}</button>`).join('')}</nav>`;
  ({ sell: viewSell, book: viewBook, wallet: viewWallet, settings: viewSettings })[view]();
}
const V = () => $('#view');

// ---------- onboarding ----------
let ob = { step: 'start', words: null, check: null, restore: false };
function renderOnboarding() {
  if (ob.step === 'start') {
    app.innerHTML = `<section class="hero"><h1>Jaay</h1><p>${esc(t('tagline'))}</p><p class="muted">${esc(t('testnet'))}</p>
      <button class="pri big" data-act="ob-create">${esc(t('create'))}</button>
      <button class="link" data-act="ob-restore">${esc(t('restore'))}</button>${langSwitch()}</section>`;
  } else if (ob.step === 'words') {
    app.innerHTML = `<section class="card"><h2>${esc(t('phraseTitle'))}</h2><p class="warn">${esc(t('phraseHelp'))}</p>
      <ol class="words">${ob.words.split(' ').map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <button class="pri big" data-act="ob-check">${esc(t('next'))}</button></section>`;
  } else if (ob.step === 'check') {
    app.innerHTML = `<section class="card"><h2>${esc(t('phraseCheck'))} ${ob.check + 1} ?</h2>
      <input id="w" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text">
      <p id="err" class="err"></p><button class="pri big" data-act="ob-checked">${esc(t('next'))}</button>
      <button class="link" data-act="ob-back">${esc(t('back'))}</button></section>`;
  } else if (ob.step === 'restore') {
    app.innerHTML = `<section class="card"><h2>${esc(t('restore'))}</h2><p>${esc(t('restoreHelp'))}</p>
      <textarea id="phrase" rows="3" autocomplete="off" autocapitalize="none" spellcheck="false"></textarea>
      <p id="err" class="err"></p><button class="pri big" data-act="ob-restored">${esc(t('next'))}</button>
      <button class="link" data-act="ob-start">${esc(t('back'))}</button></section>`;
  } else if (ob.step === 'pin') {
    app.innerHTML = `<section class="card"><h2>${esc(t('pinTitle'))}</h2><p>${esc(t('pinHelp'))}</p>
      <input id="p1" type="password" inputmode="numeric" autocomplete="new-password" placeholder="••••••">
      <input id="p2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="${esc(t('pinAgain'))}">
      <p id="err" class="err"></p><button class="pri big" data-act="ob-pin">${esc(t('next'))}</button></section>`;
  }
}
const langSwitch = () => `<div class="lang"><button data-act="lang" data-v="fr" class="${S.lang === 'fr' ? 'on' : ''}">Français</button><button data-act="lang" data-v="en" class="${S.lang === 'en' ? 'on' : ''}">English</button></div>`;

function renderUnlock() {
  app.innerHTML = `<section class="hero"><h1>Jaay</h1><p>${esc(t('locked'))}</p>
    <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="${esc(t('pinEnter'))}">
    <p id="err" class="err"></p><button class="pri big" data-act="unlock">${esc(t('unlock'))}</button>${langSwitch()}</section>`;
  setTimeout(() => $('#pin')?.focus(), 50);
}

// ---------- sell ----------
function viewSell() {
  if (pay) return viewPay();
  const sum = S.sales.filter((s) => s.day === today() && s.paid).reduce((a, s) => a + s.xof, 0);
  const sats1000 = rate ? W.xofToSats(1000, rate.btcEur) : null;
  V().innerHTML = `
    <section class="card">
      <label>${esc(t('amountCfa'))}<input id="amt" inputmode="numeric" placeholder="0" autocomplete="off"></label>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '000', 0, '⌫'].map((k) => `<button data-act="key" data-v="${k}">${k}</button>`).join('')}</div>
      <label>${esc(t('item'))}<input id="item" maxlength="60" autocomplete="off"></label>
      <p class="muted small">${sats1000 ? esc(t('rate', { sats: fmt(sats1000) })) : ''}</p>
      <button class="pri big" data-act="charge">${esc(t('charge'))}</button>
      <p id="err" class="err"></p>
    </section>
    <section class="card">
      <label>${esc(t('orWrite'))}<input id="note" maxlength="300" placeholder="${esc(t('writeExample'))}" autocomplete="off"></label>
      <button data-act="note">${esc(t('read'))}</button><p id="noteOut" class="small"></p>
    </section>
    <section class="card"><h3>${esc(t('todaySales'))} · ${fmt(sum)} FCFA</h3>${salesList()}</section>`;
}
function salesList() {
  const list = S.sales.filter((s) => s.day === today()).slice(0, 20);
  if (!list.length) return `<p class="muted">${esc(t('noSales'))}</p>`;
  return `<ul class="list">${list.map((s) => `<li><span>${esc(s.item || '—')}</span><b>${fmt(s.xof)} F</b><span class="tag ${s.paid ? 'ok' : ''}">${s.paid ? '✔ ' + esc(s.method) : '…'}</span></li>`).join('')}</ul>`;
}

async function startPayment({ xof, item, customer = null }) {
  if (!(xof > 0)) return showErr(t('errorAmount'));
  if (!rate) await loadRate();
  if (!rate) return showErr('Rate unavailable — check the connection');
  const sats = W.xofToSats(xof, rate.btcEur);
  const index = S.next++; save();
  const address = acct.address(0, index);
  pay = { xof, sats, item, customer, address, index, method: S.nwc ? 'lightning' : 'onchain', status: 'waiting', invoice: null, id: Date.now() };
  render();
  watchPayment(pay);
}

async function watchPayment(p) {
  let stopped = false; p.stop = () => { stopped = true; };
  if (p.method === 'lightning') {
    try {
      const c = nwcClient(S.nwc);
      const inv = await c.makeInvoice(p.sats, `Jaay: ${p.item || 'sale'} (${p.xof} FCFA)`);
      p.invoice = inv.invoice; p.hash = inv.payment_hash; if (pay === p) viewPay();
      while (!stopped) {
        await sleep(3000);
        const r = await c.lookupInvoice(p.hash).catch(() => null);
        if (r && (r.settled_at || r.state === 'settled' || r.preimage)) return paid(p, 'Lightning');
      }
    } catch (e) { p.error = e.message; p.method = 'onchain'; if (pay === p) viewPay(); }
  }
  // On-chain: watch the address for a NEW transaction paying at least 98% of the amount.
  // Transactions already on the address when the request was made never count (no false "paid").
  if (!p.seen) {
    p.seen = new Set();
    for (let i = 0; i < 5 && !stopped; i++) {
      try { (await E.addressTxs(p.address)).forEach((x) => p.seen.add(x.txid)); break; } catch { await sleep(2000); }
    }
  }
  while (!stopped && pay === p) {
    await sleep(5000);
    if (!navigator.onLine) continue;
    try {
      const txs = (await E.addressTxs(p.address)).filter((x) => !p.seen.has(x.txid));
      const got = txs.reduce((s, tx) => s + E.receivedIn(tx, p.address), 0);
      if (got >= p.sats * 0.98) return paid(p, txs.some((x) => x.status.confirmed) ? 'Bitcoin ✓' : 'Bitcoin');
    } catch { /* retry */ }
  }
}
function paid(p, method) {
  if (pay !== p) return;
  p.status = 'paid'; p.method_done = method;
  S.sales.unshift({ id: p.id, day: today(), at: Date.now(), xof: p.xof, sats: p.sats, item: p.item, customer: p.customer, paid: true, method });
  if (p.customer) addCreditEntry(p.customer, -p.xof, `${method}`);
  S.sales = S.sales.slice(0, 500); save();
  navigator.vibrate?.([80, 40, 160]);
  viewPay();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function viewPay() {
  if (view !== 'sell') return;
  const p = pay;
  if (p.status === 'paid') {
    V().innerHTML = `<section class="card paid"><div class="big-ok">✔</div><h2>${esc(t('paid'))}</h2><p><b>${fmt(p.xof)} FCFA</b> · ${fmt(p.sats)} sats · ${esc(p.method_done)}</p>
      <button class="pri big" data-act="new-sale">${esc(t('newSale'))}</button></section>`;
    return;
  }
  const uri = p.method === 'lightning' && p.invoice ? `lightning:${p.invoice}` : `bitcoin:${p.address}?amount=${(p.sats / 1e8).toFixed(8)}&label=Jaay`;
  const qr = qrcode(0, 'M'); qr.addData(uri.toUpperCase().startsWith('LIGHTNING:') ? uri.toUpperCase() : uri); qr.make();
  const ready = p.method === 'onchain' || p.invoice;
  V().innerHTML = `<section class="card pay">
      <p class="amount">${fmt(p.xof)} FCFA</p><p class="muted">${fmt(p.sats)} sats${p.item ? ' · ' + esc(p.item) : ''}${p.customer ? ' · ' + esc(p.customer) : ''}</p>
      <div class="seg"><span>${esc(t('payWith'))}</span>
        <button data-act="method" data-v="lightning" class="${p.method === 'lightning' ? 'on' : ''}">⚡ ${esc(t('lightning'))}</button>
        <button data-act="method" data-v="onchain" class="${p.method === 'onchain' ? 'on' : ''}">₿ ${esc(t('onchain'))}</button></div>
      ${p.error ? `<p class="err">${esc(p.error)}</p>` : ''}
      <div class="qr">${ready ? qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) : '<p class="muted">…</p>'}</div>
      <p class="muted small">${esc(t('scan'))}</p>
      <p class="mono small">${esc(p.method === 'lightning' ? (p.invoice || '').slice(0, 32) + '…' : p.address)}</p>
      <button data-act="copy" data-v="${esc(uri)}">${esc(t('copy'))}</button>
      <p class="wait">${navigator.onLine ? esc(t('waiting')) : esc(t('offline'))}</p>
      <button class="link" data-act="cancel-pay">${esc(t('cancel'))}</button></section>`;
}

// ---------- credit book ----------
function addCreditEntry(name, xof, note) {
  const key = name.trim().toLowerCase();
  const c = S.credits[key] || (S.credits[key] = { name: name.trim(), entries: [] });
  c.entries.unshift({ at: Date.now(), xof, note: String(note || '').slice(0, 80) });
  c.entries = c.entries.slice(0, 200);
}
const owed = (c) => c.entries.reduce((s, e) => s + e.xof, 0);
function viewBook() {
  const list = Object.values(S.credits).map((c) => ({ ...c, owed: owed(c) })).sort((a, b) => b.owed - a.owed);
  const total = list.reduce((s, c) => s + Math.max(0, c.owed), 0);
  V().innerHTML = `
    <section class="card"><h3>${esc(t('book'))} · ${fmt(total)} FCFA</h3>
      ${list.length ? `<ul class="list">${list.map((c) => `<li><span>${esc(c.name)}</span><b>${c.owed > 0 ? fmt(c.owed) + ' F' : esc(t('settled'))}</b>
        ${c.owed > 0 ? `<button data-act="askpay" data-v="${esc(c.name)}">${esc(t('askPay'))}</button><button data-act="repay" data-v="${esc(c.name)}">${esc(t('recordRepay'))}</button>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('nobodyOwes'))}</p>`}
    </section>
    <section class="card"><h3>${esc(t('addCredit'))}</h3>
      <label>${esc(t('customer'))}<input id="cname" maxlength="40" autocomplete="off"></label>
      <label>${esc(t('amountCfa'))}<input id="camt" inputmode="numeric" autocomplete="off"></label>
      <label>${esc(t('item'))}<input id="citem" maxlength="60" autocomplete="off"></label>
      <button class="pri" data-act="add-credit">${esc(t('addCredit'))}</button><p id="err" class="err"></p></section>`;
}

// ---------- wallet ----------
let walletCache = null;
async function scanWallet() {
  const used = [];
  for (const chain of [0, 1]) {
    const limit = chain === 0 ? S.next + GAP : (S.changeNext || 0) + GAP;
    for (let i = 0; i < limit; i++) {
      const address = acct.address(chain, i);
      const st = await E.addressStats(address);
      const b = E.balanceOf(st);
      if (b.used) used.push({ chain, index: i, address, ...b });
    }
  }
  const utxos = [];
  for (const u of used.filter((x) => x.confirmed + x.pending > 0)) {
    for (const o of await E.utxos(u.address)) utxos.push({ txid: o.txid, vout: o.vout, value: o.value, chain: u.chain, index: u.index, confirmed: o.status.confirmed });
  }
  const confirmed = utxos.filter((u) => u.confirmed).reduce((s, u) => s + u.value, 0);
  const pending = utxos.filter((u) => !u.confirmed).reduce((s, u) => s + u.value, 0);
  walletCache = { utxos, confirmed, pending, at: Date.now() };
  return walletCache;
}
function viewWallet() {
  const w = walletCache;
  const recv = acct.address(0, S.next);
  const qr = qrcode(0, 'M'); qr.addData(`bitcoin:${recv}`); qr.make();
  V().innerHTML = `
    <section class="card"><h3>${esc(t('balance'))}</h3>
      <p class="amount">${w ? fmt(w.confirmed) : '…'} sats</p>
      <p class="muted">${w && rate ? '≈ ' + fmt(W.satsToXof(w.confirmed, rate.btcEur)) + ' FCFA' : ''}${w && w.pending ? ` · +${fmt(w.pending)} ${esc(t('pending'))}` : ''}</p>
      <button data-act="refresh">${esc(t('refresh'))}</button></section>
    <section class="card"><h3>${esc(t('receive'))}</h3><div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <p class="mono small">${esc(recv)}</p><button data-act="copy" data-v="${esc(recv)}">${esc(t('copy'))}</button>
      <p class="small"><a href="https://signetfaucet.com/" target="_blank" rel="noopener noreferrer">${esc(t('faucet'))}</a></p></section>
    <section class="card"><h3>${esc(t('send'))}</h3>
      <label>${esc(t('to'))}<input id="to" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="tb1…"></label>
      <label>${esc(t('amountSats'))}<input id="sats" inputmode="numeric" autocomplete="off"></label>
      <button class="pri" data-act="send">${esc(t('sendNow'))}</button><p id="err" class="err"></p><p id="sendOut" class="small"></p></section>`;
  if (!w || Date.now() - w.at > 60_000) scanWallet().then(() => { if (view === 'wallet') viewWallet(); }).catch(() => {});
}
async function doSend() {
  const to = $('#to').value.trim(); const amount = parseInt($('#sats').value, 10);
  try {
    const w = await scanWallet();
    const feeRate = await E.feeRate();
    const change = acct.address(1, S.changeNext || 0);
    const tx = W.buildSend(acct, w.utxos.filter((u) => u.confirmed), { to, amount, feeRate, changeAddress: change });
    if (!confirm(`${t('confirmSend')} ${fmt(amount)} sats → ${to.slice(0, 14)}…\n${t('fee')}: ${fmt(tx.fee)} sats`)) return;
    const txid = await E.broadcast(tx.hex);
    if (tx.change) { S.changeNext = (S.changeNext || 0) + 1; save(); }
    $('#sendOut').innerHTML = `${esc(t('sent'))} ✔ <a href="${E.EXPLORER}/tx/${esc(txid)}" target="_blank" rel="noopener noreferrer">${esc(txid.slice(0, 16))}…</a>`;
    walletCache = null;
  } catch (e) { showErr(e.message); }
}

// ---------- settings ----------
function viewSettings() {
  V().innerHTML = `
    <section class="card"><h3>${esc(t('language'))}</h3>${langSwitch()}</section>
    <section class="card"><h3>⚡ ${esc(t('nwc'))}</h3><p class="small muted">${esc(t('nwcHelp'))}</p>
      ${S.nwc ? `<p class="ok">✔ ${esc(t('connected'))}</p><button data-act="nwc-off">${esc(t('disconnect'))}</button>`
              : `<textarea id="nwc" rows="3" autocomplete="off" spellcheck="false" placeholder="nostr+walletconnect://…"></textarea><button class="pri" data-act="nwc-on">${esc(t('connect'))}</button>`}
      <p id="err" class="err"></p></section>
    <section class="card"><button data-act="backup">${esc(t('backup'))}</button><p id="phraseOut" class="mono small"></p>
      <button data-act="lock">${esc(t('lock'))}</button><button class="danger" data-act="reset">${esc(t('reset'))}</button></section>`;
}

// ---------- events ----------
function showErr(m) { const e = $('#err'); if (e) e.textContent = m; }
app.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  try {
    switch (act) {
      case 'lang': S.lang = v; save(); render(); break;
      case 'tab': view = v; render(); break;
      case 'ob-create': ob = { step: 'words', words: W.newMnemonic() }; render(); break;
      case 'ob-restore': ob = { step: 'restore' }; render(); break;
      case 'ob-start': ob = { step: 'start' }; render(); break;
      case 'ob-back': ob.step = 'words'; render(); break;
      case 'ob-check': ob.check = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 12; ob.step = 'check'; render(); break;
      case 'ob-checked':
        if ($('#w').value.trim().toLowerCase() !== ob.words.split(' ')[ob.check]) return showErr('✗');
        ob.step = 'pin'; render(); break;
      case 'ob-restored': {
        const phrase = $('#phrase').value;
        if (!W.isValidMnemonic(phrase)) return showErr('✗ ' + t('restoreHelp'));
        ob = { step: 'pin', words: phrase.trim().toLowerCase().split(/\s+/).join(' ') }; render(); break;
      }
      case 'ob-pin': {
        const p1 = $('#p1').value, p2 = $('#p2').value;
        if (!W.validPin(p1)) return showErr(t('pinHelp'));
        if (p1 !== p2) return showErr(t('pinMismatch'));
        S.box = await W.encryptSecret(ob.words, p1); S.next = S.next || 0; save();
        mnemonic = ob.words; acct = W.account(mnemonic); ob = { step: 'start' }; touch(); render(); loadRate().then(() => view === 'sell' && !pay && render()); break;
      }
      case 'unlock': {
        b.disabled = true;
        try { mnemonic = await W.decryptSecret(S.box, $('#pin').value); acct = W.account(mnemonic); touch(); loadRate().then(() => view === 'sell' && !pay && render()); render(); }
        catch (e) { showErr(e.message); b.disabled = false; }
        break;
      }
      case 'key': {
        const i = $('#amt'); i.value = v === '⌫' ? i.value.slice(0, -1) : (i.value + v).replace(/^0+/, '').slice(0, 9); break;
      }
      case 'charge': await startPayment({ xof: parseInt($('#amt').value, 10), item: $('#item').value.trim() }); break;
      case 'note': {
        const note = $('#note').value.trim(); if (!note) return;
        b.disabled = true;
        const r = await (await fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })).json().catch(() => ({ ok: false, error: 'Offline' }));
        b.disabled = false;
        if (!r.ok) { $('#noteOut').textContent = r.error || '✗'; return; }
        $('#noteOut').textContent = `${r.kind} · ${fmt(r.amountXof)} FCFA${r.item ? ' · ' + r.item : ''}${r.customer ? ' · ' + r.customer : ''} (${t('aiBy')} ${r.by})`;
        if (r.kind === 'sale') await startPayment({ xof: r.amountXof, item: r.item || '' });
        else if (r.kind === 'credit') { addCreditEntry(r.customer, r.amountXof, r.item || r.note); save(); view = 'book'; render(); }
        else if (r.kind === 'repayment') { addCreditEntry(r.customer, -r.amountXof, 'cash'); save(); view = 'book'; render(); }
        break;
      }
      case 'method': pay.stop?.(); pay.method = v; pay.error = null; pay.invoice = null; if (v === 'lightning' && !S.nwc) { pay.method = 'onchain'; pay.error = t('noLightning'); } viewPay(); watchPayment(pay); break;
      case 'cancel-pay': pay?.stop?.(); pay = null; render(); break;
      case 'new-sale': pay = null; render(); break;
      case 'copy': await navigator.clipboard?.writeText(v); b.textContent = t('copied'); break;
      case 'add-credit': {
        const name = $('#cname').value.trim(), xof = parseInt($('#camt').value, 10);
        if (!name || !(xof > 0)) return showErr(t('errorAmount'));
        addCreditEntry(name, xof, $('#citem').value.trim()); save(); render(); break;
      }
      case 'repay': {
        const amt = parseInt(prompt(`${t('recordRepay')} — ${v} (FCFA)`) || '', 10);
        if (amt > 0) { addCreditEntry(v, -amt, 'cash'); save(); render(); }
        break;
      }
      case 'askpay': { const c = S.credits[v.toLowerCase()]; view = 'sell'; await startPayment({ xof: owed(c), item: `${t('book')}`, customer: c.name }); break; }
      case 'refresh': walletCache = null; viewWallet(); break;
      case 'send': await doSend(); break;
      case 'nwc-on': {
        const uri = $('#nwc').value.trim();
        b.disabled = true;
        try { const c = nwcClient(uri, { timeoutMs: 15000 }); await c.getInfo(); c.close(); S.nwc = uri; save(); render(); }
        catch (e) { showErr(e.message); b.disabled = false; }
        break;
      }
      case 'nwc-off': S.nwc = null; save(); render(); break;
      case 'backup': $('#phraseOut').textContent = mnemonic; setTimeout(() => { const o = $('#phraseOut'); if (o) o.textContent = ''; }, 30_000); break;
      case 'lock': lock(); break;
      case 'reset': if (confirm(t('resetConfirm'))) { localStorage.removeItem(KEY); location.reload(); } break;
      default: break;
    }
  } catch (e) { showErr(e.message); }
});
app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pin') $('[data-act=unlock]')?.click(); });
addEventListener('online', () => pay && viewPay());
addEventListener('offline', () => pay && viewPay());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
