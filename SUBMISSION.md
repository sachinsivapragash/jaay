# Dakar Bitcoin Hack 2026: submission text for Jaay

**Deadline:** November 21, 2026, 1:30 AM IST.

## Project name
Jaay

## Tagline
A bitcoin point of sale, credit book and non-custodial wallet for market sellers in Dakar: prices in CFA, payments on-chain or over Lightning, reminders on WhatsApp, and an encrypted backup on Nostr.

## Links
- Live app: https://jaay-r9za.onrender.com (signet test network)
- Code (MIT): https://github.com/sachinsivapragash/jaay
- Demo video: https://www.youtube.com/watch?v=PeiF-Q9WGiY

## Inspiration
Walk through Sandaga or Tilène market and you will see the same thing at almost every stall: a small notebook of debts. *Awa doit 2 500 pour le poisson.* Credit is how the market works, but debts get forgotten, disputes are common, and chasing a customer is awkward. Customers increasingly want to pay from their phones, but bitcoin wallets show prices in BTC or USD, assume fast data, and know nothing about credit. We wanted a tool that fits how a seller already works: price in CFA, take payment however the customer can pay, remember who owes what, and remind them politely on WhatsApp.

## What it does
- **Sell in CFA francs.** A keypad in FCFA, converted to sats at the live rate. The CFA franc is pegged to the euro, so only BTC/EUR is needed. Frequent items become one-tap buttons.
- **Get paid however the customer can pay:**
  - a QR code for a fresh signet address (BIP21)
  - a **Lightning** invoice created by the seller's own wallet through **Nostr Wallet Connect (NIP-47)**
  - **cash**, with one tap

  Jaay detects the payment, shows "Payé !", and offers a WhatsApp receipt.
- **A non-custodial wallet.** 12-word BIP39 phrase and BIP84 native segwit, built with the audited `@scure` libraries. The phrase is encrypted on the phone with the seller's PIN (PBKDF2 310k + AES-256-GCM). Balance, receive and send; transactions are signed on the device.
- **Credit book.** Who owes what, with history per customer. One tap turns a debt into a payment request, or sends a **WhatsApp reminder** with a payment link. The link opens a QR page on the customer's phone, with no app and no account, and the server stores nothing.
- **Write or say what happened.** *"Vendu 3 sacs de riz à 15000"*, *"Moussa a payé 1000"*. An AI reads the note and its answer is validated in code. An offline parser does the same job when there is no AI or no data.
- **Encrypted backup over Nostr.** A Nostr key is derived from the same 12 words (NIP-06). The ledger is encrypted to it (NIP-44) and published to several relays as a replaceable app-data event (kind 30078). Lose the phone, restore the 12 words, and both the money and the credit book come back.
- **Reports.** Today's totals, a split by payment method, a 7-day chart, and a CSV export for a savings group (tontine) or an accountant.
- **Made for cheap phones.** Installs from the browser (PWA), opens offline, keeps the last exchange rate for offline pricing, French first with English available, big touch targets, screen-reader labels, light and dark mode.

## How we built it
- **Client:** vanilla JavaScript bundled with esbuild into a small PWA.
  - Libraries: `@scure/bip39`, `@scure/bip32`, `@scure/btc-signer` and `@noble/hashes` for the wallet; `nostr-tools` for NWC and the backup; `qrcode-generator` for QR codes.
  - Network: an Esplora API (mempool.space signet) for balances, payment detection and broadcasting.
- **Server:** a small Node/Express service. It serves the app, a cached BTC/EUR rate, and an optional AI note reader (Gemini with structured JSON output, validated in code). It never sees keys, balances, the ledger or phone numbers.
- **Security by design:**
  - a threat model in the README
  - a strict Content-Security-Policy with no inline scripts, a per-IP rate limit and a 4 KB body limit
  - mainnet addresses refused
  - a payment counts only if it is a *new* transaction paying at least 98% of the amount
  - invisible and direction-reversing Unicode stripped from names, notes and pay links, so a customer name can't be spoofed in a WhatsApp message
  - CSV formula injection neutralised
- **Tests:** 30 automated tests, including the BIP84 and NIP-06 test vectors, PIN encryption, coin selection and signing, the note parser, pay links, WhatsApp text, reports, the encrypted backup (no plaintext leaks, wrong key rejected, merge without address reuse) and server security.
- **Setup:** `npm install && npm start`, or `docker build -t jaay . && docker run -p 3000:3000 jaay`.

## Challenges
- Detecting payments without a false "paid". Addresses can already have history, so Jaay snapshots existing transactions and only counts new ones.
- Making the ledger survive a lost phone without a server account: a key derived from the seed (NIP-06) plus NIP-44 encryption to oneself, with a merge that never reuses a receive address.
- Public relays vary a lot: some rate-limit or refuse app-data events. We tested relays and publish to several.
- Keeping everything understandable for a seller: CFA everywhere, French first, and no jargon on screen.

## Accomplishments
A complete daily loop on a phone:
1. sell in CFA
2. get paid in bitcoin, Lightning or cash
3. record credit
4. remind on WhatsApp
5. the customer pays from a link
6. back up the ledger to Nostr

All of it non-custodial, and the server knows nothing about the seller's business.

## What we learned
NIP-47, NIP-06 and NIP-44 in practice; how relay policies differ; how much a single local detail matters (the CFA peg, WhatsApp, cash sales) compared with generic crypto features.

## What's next
- Wolof voice notes, and reminders over Nostr DMs for customers who use Nostr.
- Shared credit books for family businesses.
- A mainnet pilot with a local partner, after an external security review.
- **Impact metrics for the pilot:** sales recorded per seller per week, the share of credit repaid within 30 days, time to complete a payment, and failed or timed-out payments.

## Built with
javascript, node.js, express, bitcoin, signet, lightning, nostr, nostr-wallet-connect, nip-44, nip-06, scure-btc-signer, esbuild, pwa, gemini, docker, render

## Testing instructions
1. Open https://jaay-r9za.onrender.com on a phone. The first load after a quiet period can take up to about 50 seconds while the free server wakes.
2. Tap **Créer mon portefeuille**, write down the 12 words, confirm one, and choose a 6-digit PIN. **English** is one tap away on the first screen.
3. Sell: type an amount, tap **Encaisser**, and see the QR code. Tap **💵 Espèces** to record a cash sale and see the WhatsApp receipt.
4. In the note box, type `Awa doit 2500 pour le poisson`, then open **Carnet** and tap **Relancer sur WhatsApp**.
5. **Réglages → Sauvegarde chiffrée (Nostr) → Sauvegarder maintenant**.
6. Optional: get signet coins from a signet faucet, send them to the address in **Portefeuille**, then sell and pay the QR from another signet wallet.
