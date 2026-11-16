// Records a captioned demo of Jaay: the phone app on the left, captions on the right (dev tool).
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

const STAGE_PAY = `
  html{background:linear-gradient(135deg,#0b2e21,#0e7a4b) !important;height:100%;overflow:hidden}
  body{position:absolute !important;left:110px;top:22px;width:372px;height:676px;overflow-y:auto;margin:0 !important;border:11px solid #0d0d0d;border-radius:38px;
       background:#f6f3ec !important;box-shadow:0 30px 80px rgba(0,0,0,.45);scrollbar-width:none}
  #cap,#brand,#step{position:fixed}
  #cap{left:560px;top:150px;width:640px;color:#fff;font:700 36px/1.25 system-ui}
  #cap small{display:block;font:400 23px/1.45 system-ui;opacity:.9;margin-top:16px}
  #brand{left:560px;top:52px;color:#f0b43a;font:800 46px system-ui}
  #brand span{font:500 20px system-ui;color:#d8efe3;margin-left:12px}
  #step{left:560px;bottom:40px;color:#d8efe3;font:500 18px system-ui;opacity:.85}`;
const STAGE = `
  html,body{background:linear-gradient(135deg,#0b2e21,#0e7a4b) !important;height:100%;overflow:hidden}
  #app{position:absolute !important;left:110px;top:22px;width:372px !important;max-width:none !important;height:676px;min-height:0 !important;overflow-y:auto;overflow-x:hidden;
       border:11px solid #0d0d0d;border-radius:38px;background:#f6f3ec;padding-bottom:0 !important;box-shadow:0 30px 80px rgba(0,0,0,.45);scrollbar-width:none;margin:0 !important}
  #app::-webkit-scrollbar{display:none}
  #app .tabs{position:sticky !important;bottom:0;left:auto;right:auto;z-index:3}
  #cap{position:fixed;left:560px;top:150px;width:640px;color:#fff;font:700 36px/1.25 system-ui}
  #cap small{display:block;font:400 23px/1.45 system-ui;opacity:.9;margin-top:16px}
  #brand{position:fixed;left:560px;top:52px;color:#f0b43a;font:800 46px system-ui;letter-spacing:.5px}
  #brand span{font:500 20px system-ui;color:#d8efe3;margin-left:12px}
  #step{position:fixed;left:560px;bottom:40px;color:#d8efe3;font:500 18px system-ui;opacity:.85}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, bypassCSP: true, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }, locale: 'fr-FR', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('dialog', (d) => d.accept());
  const stage = async () => {
    await page.addStyleTag({ content: page.url().includes('/pay?') ? STAGE_PAY : STAGE });
    await page.evaluate(() => {
      for (const [id, html] of [['brand', 'Jaay<span>Bitcoin POS &amp; credit book · Dakar Bitcoin Hack</span>'], ['cap', ''], ['step', '']]) {
        if (!document.getElementById(id)) { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); }
      }
    });
  };
  const t0 = Date.now();
  await page.goto(APP + '/');
  await page.evaluate(async () => { localStorage.clear(); for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister(); });
  await page.reload();
  await stage();
  const lead = (Date.now() - t0) / 1000;
  const cap = (h, s = '', step = '') => page.evaluate(([h, s, step]) => { document.getElementById('cap').innerHTML = h + (s ? `<small>${s}</small>` : ''); document.getElementById('step').textContent = step; }, [h, s, step]);
  const click = async (sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.click(sel); };
  const type = async (sel, text, delay = 55) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.click(sel); await page.keyboard.type(text, { delay }); };
  const scrollApp = (y) => page.evaluate((y) => document.getElementById('app').scrollTo({ top: y, behavior: 'smooth' }), y);

  // 1. Problem
  await cap('A market seller in Dakar sells on credit every day.', 'Debts live in a paper notebook. Customers increasingly want to pay from their phones, but bitcoin apps price in BTC, not CFA francs, and assume fast data.', 'The problem');
  await sleep(7000);
  await cap('Jaay is a point of sale, a credit book and a bitcoin wallet in one phone app.', '"Jaay" means "sell" in Wolof. French first, light enough for a cheap phone, and it runs on the signet test network.', 'The solution');
  await sleep(6000);

  // 2. Non-custodial wallet
  await cap('Your money stays on your phone.', 'A real HD wallet (BIP39 / BIP84, audited @scure libraries). The 12 words are shown once, then checked.', '1 · Create the wallet');
  await click('[data-act=ob-create]'); await sleep(3800);
  const words = await page.$$eval('.words li', (l) => l.map((x) => x.textContent));
  await click('[data-act=ob-check]'); await sleep(700);
  const n = parseInt((await page.textContent('h2')).match(/(\d+)/)[1], 10);
  await type('#w', words[n - 1]); await sleep(400); await click('[data-act=ob-checked]'); await sleep(800);
  await cap('A PIN encrypts the 12 words on the device.', 'PBKDF2 with 310,000 rounds plus AES-256-GCM, and an auto-lock after 5 minutes. The server never sees keys, balances, the credit book or phone numbers.', '1 · Create the wallet');
  await type('#p1', '482913', 90); await type('#p2', '482913', 90); await click('[data-act=ob-pin]'); await sleep(2500);
  await click('[data-act=tab][data-v=settings]'); await sleep(500);
  await type('#shop', 'Chez Fatou'); await click('[data-act=shop]'); await sleep(900);

  // 3. Sell in CFA
  await click('[data-act=tab][data-v=sell]'); await sleep(500);
  await cap('Sell in CFA francs.', 'Type the price and Jaay converts it to sats at the live rate. The CFA franc is pegged to the euro, so only BTC/EUR is needed.', '2 · Sell');
  for (const k of ['3', '000']) { await click(`[data-act=key][data-v="${k}"]`); await sleep(350); }
  await type('#item', 'Thiof'); await sleep(300);
  await click('[data-act=save-item]'); await sleep(1300);
  await cap('Frequent items become one-tap buttons.', 'The catalogue lives on the phone.', '2 · Sell');
  await sleep(1500);
  await click('[data-act=cat]'); await sleep(2600);
  await cap('The customer scans and pays.', 'A fresh signet address with the amount (BIP21), or a Lightning invoice from the seller’s own wallet through Nostr Wallet Connect. Only a NEW payment of at least 98% counts, so there is never a false "paid".', '3 · Get paid');
  await sleep(5500);
  const pay = await page.evaluate(() => ({ address: document.querySelector('.pay .mono')?.textContent, sats: parseInt(document.querySelector('.pay .muted').textContent.replace(/\D/g, ''), 10) }));
  const paidForReal = await customerPays(pay.address, pay.sats).catch((e) => { console.log('customer payment failed:', e.message); return false; });
  if (paidForReal) { await page.waitForSelector('.big-ok', { timeout: 60000 }).catch(() => {}); }
  else {
    await cap('Cash is one tap too.', 'Most sales are still cash, so the ledger records every sale, not only the bitcoin ones.', '3 · Get paid');
    await scrollApp(200); await sleep(1500);
    await click('[data-act=cash]'); await sleep(1200);
  }
  await cap('Paid. A receipt goes out on WhatsApp.', 'The message is pre-written in French, ready to send. WhatsApp is how the market already talks.', '3 · Get paid');
  await sleep(4500);
  await click('[data-act=new-sale]'); await sleep(700);

  // 4. Notes and credit book
  await cap('Or just write what happened, in French or English.', 'An AI reads the note and its answer is validated in code. Without AI, an offline parser does the same job. Voice dictation works too.', '4 · Credit book');
  await scrollApp(560); await sleep(800);
  await type('#note', 'Awa doit 2500 pour le poisson', 45); await sleep(300); await click('[data-act=note]');
  await page.waitForSelector('[data-act=remind]', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  await type('#cname', 'Awa'); await type('#camt', '1500'); await type('#citem', 'oignons'); await type('#cphone', '+221 77 123 45 67');
  await click('[data-act=add-credit]'); await sleep(1200);
  await scrollApp(0); await sleep(600);
  await cap('The credit book: who owes what, with history.', 'Awa owes 4,000 FCFA. One tap sends her a polite WhatsApp reminder with a payment link.', '4 · Credit book');
  await click('[data-act=hist]'); await sleep(2500);
  const link = await page.evaluate(() => new Promise((res) => { const o = window.open; window.open = (u) => { window.open = o; res(u); return null; }; document.querySelector('[data-act=remind]').click(); }));
  const text = decodeURIComponent(new URL(link).searchParams.get('text') || '');
  const payUrl = (text.match(/https?:\/\/\S+\/pay\?\S+/) || [])[0];
  await cap('The reminder Awa receives:', `“${text.replace(/https?:\/\/\S+/, '[payment link]')}”`, '4 · Credit book');
  await sleep(6000);

  // 5. The customer's side
  if (payUrl) {
    await page.goto(payUrl.replace(/^https?:\/\/[^/]+/, APP)); await stage();
    await cap('Awa opens the link: no app, no account.', 'The page builds the QR from the link alone, and the server stores nothing. It says thank you as soon as the payment arrives.', '5 · The customer’s side');
    await sleep(6500);
    await page.goBack(); await stage();
    await page.fill('#pin', '482913'); await page.click('[data-act=unlock]'); await sleep(2200);
  }

  // 6. Reports
  await click('[data-act=tab][data-v=report]'); await sleep(600);
  await cap('Daily totals, a 7-day chart and a CSV export.', 'For the seller, a savings group (tontine) or an accountant. Spreadsheet formula injection is neutralised.', '6 · Reports');
  await sleep(5500);

  // 7. Encrypted Nostr backup
  await click('[data-act=tab][data-v=settings]'); await sleep(500);
  await page.locator('[data-act=backup-now]').scrollIntoViewIfNeeded();
  await cap('Lose the phone, keep the credit book.', 'The ledger is encrypted (NIP-44) to a Nostr key derived from the same 12 words (NIP-06) and published to several relays. Restoring the words brings back the money and the debts.', '7 · Encrypted backup over Nostr');
  await sleep(1500);
  await click('[data-act=backup-now]');
  await page.waitForFunction(() => /✔|✗/.test(document.getElementById('cloudOut')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
  await sleep(4000);

  // 8. Wallet
  await click('[data-act=tab][data-v=wallet]'); await sleep(600);
  await cap('A real signet wallet.', 'Balance, receive and send. Transactions are built and signed on the phone, then broadcast. Mainnet addresses are refused.', '8 · Wallet');
  await sleep(5500);

  // 9. Close
  await click('[data-act=tab][data-v=sell]'); await sleep(400);
  await cap('Built for the market, secure by design.', '30 automated tests (BIP84 and NIP-06 vectors, encryption, signing, parsing, pay links, CSV, hidden-Unicode stripping, server security). One-command setup with npm or Docker.', 'Jaay');
  await sleep(6500);
  await cap('Next: Wolof voice notes, reminders over Nostr DMs, and a mainnet pilot with a local partner.', 'github.com/sachinsivapragash/jaay · jaay-r9za.onrender.com · signet test network, no real money', 'Thank you');
  await sleep(7000);

  console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)}s, real payment: ${paidForReal}`);
  const video = page.video(); await ctx.close();
  const raw = path.join(OUT, 'jaay-raw.webm'); fs.rmSync(raw, { force: true }); fs.renameSync(await video.path(), raw); await browser.close();
  execFileSync(FF, ['-y', '-ss', lead.toFixed(2), '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-r', '30', '-movflags', '+faststart', MP4], { stdio: 'ignore' });
  console.log('wrote', MP4);
})().catch((e) => { console.error(e); process.exit(1); });
