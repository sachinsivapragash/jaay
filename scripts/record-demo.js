// Records a captioned demo of Jaay on a phone-sized screen (dev tool; not part of the app).
//   node scripts/record-demo.js [appUrl] [out.mp4]
// If video/customer.txt holds a funded signet wallet, it really pays the sale's QR code on camera.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as W from '../src/client/wallet.js';
import * as E from '../src/client/esplora.js';

const req = createRequire(path.resolve('../duepilot/package.json')); // reuse playwright + ffmpeg from the sibling project
const { chromium } = req('playwright');
const FF = req('ffmpeg-static');
const APP = (process.argv[2] || 'http://localhost:3010').replace(/\/$/, '');
const OUT = path.resolve('video');
const MP4 = process.argv[3] || path.join(OUT, 'jaay-demo.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function customerPays(address, sats) {
  const file = path.join(OUT, 'customer.txt');
  if (!fs.existsSync(file)) return false;
  const acct = W.account(fs.readFileSync(file, 'utf8').trim());
  const from = acct.address(0, 0);
  const utxos = (await E.utxos(from)).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, chain: 0, index: 0 }));
  if (!utxos.length) return false;
  const tx = W.buildSend(acct, utxos, { to: address, amount: sats, feeRate: 2, changeAddress: from });
  console.log('customer paid', await E.broadcast(tx.hex));
  return true;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, bypassCSP: true, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('dialog', (d) => d.accept());
  const t0 = Date.now();
  await page.goto(APP + '/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: `
    body{background:linear-gradient(135deg,#0e3b2a,#0e7a4b)}
    #app{position:absolute;left:120px;top:24px;width:360px;height:672px;overflow:auto;border:10px solid #111;border-radius:36px;background:var(--bg);transform:translateZ(0);padding-bottom:84px;scrollbar-width:none}
    #cap{position:fixed;left:560px;top:180px;width:620px;color:#fff;font:600 34px/1.3 system-ui}
    #cap small{display:block;font:400 22px/1.4 system-ui;opacity:.85;margin-top:14px}
    #brand{position:fixed;left:560px;top:60px;color:#e8a317;font:800 44px system-ui}` });
  await page.evaluate(() => { const b = document.createElement('div'); b.id = 'brand'; b.textContent = 'Jaay'; document.body.appendChild(b); const c = document.createElement('div'); c.id = 'cap'; document.body.appendChild(c); });
  const lead = (Date.now() - t0) / 1000;
  const cap = (h, s = '') => page.evaluate(([h, s]) => { document.getElementById('cap').innerHTML = h + (s ? `<small>${s}</small>` : ''); }, [h, s]);
  const click = (sel) => page.click(sel);
  const type = async (sel, text) => { await page.click(sel); await page.keyboard.type(text, { delay: 55 }); };

  await cap('Market sellers in Dakar sell on credit every day.', 'Debts live in a paper notebook. Customers want to pay from their phones. Bitcoin apps show prices in BTC, not CFA.');
  await sleep(6500);
  await cap('Jaay: a point of sale and wallet for the market.', 'Prices in CFA francs · paid in bitcoin or Lightning · a credit book · French first · works on cheap phones.');
  await sleep(5000);

  await cap('Your money, on your phone.', 'A real HD wallet (BIP39/BIP84, audited @scure libraries). The 12 words are shown once and checked.');
  await click('[data-act=ob-create]'); await sleep(3500);
  const words = (await page.$$eval('.words li', (l) => l.map((x) => x.textContent)));
  await click('[data-act=ob-check]'); await sleep(800);
  const n = parseInt((await page.textContent('h2')).match(/(\d+)/)[1], 10);
  await type('#w', words[n - 1]); await sleep(500); await click('[data-act=ob-checked]'); await sleep(900);
  await cap('A PIN encrypts the phrase on the device.', 'PBKDF2 (310,000 rounds) + AES-256-GCM. The server never sees keys, balances or the credit book.');
  await type('#p1', '482913'); await type('#p2', '482913'); await click('[data-act=ob-pin]'); await sleep(3000);

  await cap('Sell in CFA francs.', 'Type the price, Jaay converts it to sats with the live rate (XOF is pegged to the euro).');
  for (const k of ['1', '5', '000']) { await click(`[data-act=key][data-v="${k}"]`); await sleep(350); }
  await type('#item', 'Thiof (poisson)'); await sleep(600);
  await click('[data-act=charge]'); await sleep(2500);
  await cap('The customer scans and pays.', 'A fresh signet address with the amount (BIP21), or a Lightning invoice from the seller’s own wallet via Nostr Wallet Connect.');
  await sleep(4000);
  const pay = await page.evaluate(() => ({ address: document.querySelector('.pay .mono')?.textContent, sats: parseInt(document.querySelector('.pay .muted').textContent.replace(/\D/g, ''), 10) }));
  const paidForReal = await customerPays(pay.address, pay.sats).catch((e) => { console.log('customer payment failed:', e.message); return false; });
  if (paidForReal) {
    await cap('Payment detected.', 'Jaay watches for a NEW transaction paying at least 98% of the amount: no false “paid”.');
    await page.waitForSelector('.big-ok', { timeout: 60000 }).catch(() => {});
    await sleep(4000);
  } else {
    await cap('Jaay waits for a new transaction to this address.', 'Only a payment of at least 98% of the amount counts. Old transactions are ignored, so there is no false “paid”.');
    await sleep(5000);
  }
  await page.click('[data-act=cancel-pay], [data-act=new-sale]').catch(() => {});
  await sleep(800);

  await cap('Or just write what happened.', 'In French or English. An AI reads it and the result is validated in code. Without AI, an offline parser does the same.');
  await type('#note', 'Awa doit 2500 pour le poisson'); await sleep(400); await click('[data-act=note]');
  await page.waitForSelector('[data-act=askpay]', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  await cap('The credit book: who owes what.', 'One tap turns a debt into a payment request. Cash repayments are recorded too.');
  await click('[data-act=tab][data-v=sell]'); await sleep(600);
  await type('#note', 'Moussa doit 4000 pour 2 sacs de riz'); await click('[data-act=note]');
  await page.waitForSelector('[data-act=askpay]', { timeout: 15000 }).catch(() => {});
  await sleep(3000);
  await click('[data-act=askpay]'); await sleep(3500);
  await page.click('[data-act=cancel-pay]').catch(() => {});

  await cap('A real signet wallet.', 'Balance, receive and send. Transactions are built and signed on the phone, then broadcast.');
  await click('[data-act=tab][data-v=wallet]'); await sleep(6000);
  await page.evaluate(() => document.getElementById('app').scrollTo({ top: 600, behavior: 'smooth' })); await sleep(2500);

  await cap('Lightning, without custody.', 'Connect any NWC wallet (Alby Hub, Coinos…). Jaay only asks it to create and check invoices.');
  await click('[data-act=tab][data-v=settings]'); await sleep(4500);

  await cap('Built for the market.', 'Installs as an app, opens offline, about 280 KB, French and English. 17 tests: BIP84 vectors, encryption, signing, parsing, server security.');
  await click('[data-act=tab][data-v=sell]'); await sleep(5000);
  await cap('Next: Wolof voice notes, customer reminders over Nostr, and a mainnet pilot with a local partner.', 'github.com/sachinsivapragash/jaay · jaay-r9za.onrender.com · signet test network, no real money');
  await sleep(6500);

  console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)}s, real payment: ${paidForReal}`);
  const video = page.video(); await ctx.close();
  const raw = path.join(OUT, 'jaay-raw.webm'); fs.rmSync(raw, { force: true }); fs.renameSync(await video.path(), raw); await browser.close();
  execFileSync(FF, ['-y', '-ss', lead.toFixed(2), '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-r', '30', '-movflags', '+faststart', MP4], { stdio: 'ignore' });
  console.log('wrote', MP4);
})().catch((e) => { console.error(e); process.exit(1); });
